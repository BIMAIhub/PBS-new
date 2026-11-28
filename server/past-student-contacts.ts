import { createHash } from 'node:crypto';
import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database,type WritableDatabase,makeStudentId,now,transaction } from './database.js';
import { audit } from './academy-data.js';
import { accessPackage } from './admissions.js';
import { portalOrigin } from './microsoft.js';
import { hashPassword,validPassword,verifyPassword } from './passwords.js';
import { badRequest,conflict,field,route } from './http.js';
import { parsePastStudentCsv,type PastStudentContactInput } from '../src/live/past-student-csv.js';

export async function pendingPastStudentContacts(db:Database) {
  return db.prepare(`SELECT a.id AS accountId,a.name,a.email,a.phone,a.created_at AS createdAt,
    COALESCE(c.status,'active') AS accountStatus FROM past_student_contacts p JOIN accounts a ON a.id=p.account_id
    LEFT JOIN account_controls c ON c.account_id=a.id WHERE COALESCE(c.status,'active')<>'deleted' AND NOT EXISTS(SELECT 1 FROM legacy_training h WHERE h.account_id=a.id) ORDER BY a.name`).all();
}
async function existingStudent(db:Database,email:string) {
  return db.prepare(`SELECT a.id,a.role,COALESCE(c.status,'active') AS status FROM accounts a LEFT JOIN account_controls c ON c.account_id=a.id WHERE a.email=? COLLATE NOCASE`).get(email);
}
function input(body:Record<string,unknown>) {
  const csv=field(body.csv,'student CSV',200_000),source=field(body.source,'CSV filename',120,false);
  try{return {contacts:parsePastStudentCsv(csv),source,hash:createHash('sha256').update(csv).digest('hex')};}
  catch(error){throw badRequest(error instanceof Error?error.message:'Choose a valid student CSV.');}
}
export function mountPastStudentContacts(app:Express,db:WritableDatabase) {
  app.post('/api/admin/past-students/contacts/preview',route(async(req,res)=>{
    await requireAccount(db,req,'admin');const parsed=input(req.body||{}),rows=[];
    for(const contact of parsed.contacts) {
      const existing=await existingStudent(db,contact.email);
      rows.push({...contact,status:!existing?'new':existing.role!=='student'||existing.status!=='active'?'blocked':'existing',reason:!existing?'New login; training details pending':existing.role!=='student'?'Administrator email — cannot import':existing.status!=='active'?'Inactive account — review its existing controls':'Existing account and password will be preserved'});
    }
    res.json({rows,total:rows.length,created:rows.filter(r=>r.status==='new').length,existing:rows.filter(r=>r.status==='existing').length,blocked:rows.filter(r=>r.status==='blocked').length});
  }));
  app.post('/api/admin/past-students/contacts/import',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin'),parsed=input(req.body||{}),key=field(req.body?.requestKey,'import reference',80);
    if(!/^[\w-]{16,80}$/.test(key))throw badRequest('Open a fresh CSV import.');
    if(req.body?.confirmed!==true)throw badRequest('Review the contact preview before creating accounts.');
    const passwords=req.body?.passwords;
    if(!passwords||typeof passwords!=='object'||Array.isArray(passwords))throw badRequest('Prepare a temporary login for each CSV row.');
    const prepared=new Map<string,{password:string;hash:string}>();
    const previous=await db.prepare('SELECT content_hash,actor_id FROM past_contact_imports WHERE request_key=?').get(key);
    if(previous&&(previous.content_hash!==parsed.hash||previous.actor_id!==admin.id))throw conflict('This import reference belongs to another file.');
    for(const contact of parsed.contacts) {
      const existing=await existingStudent(db,contact.email);
      if(existing&&(existing.role!=='student'||existing.status!=='active'))throw conflict('One CSV email belongs to an administrator or an inactive account. Review the preview.');
      const password=passwords[contact.email];
      if(typeof password!=='string'||!validPassword(password,20))throw badRequest('Prepare a secure temporary password for every row.');
      if(!existing)prepared.set(contact.email,{password,hash:await hashPassword(password)});
    }
    const result=await transaction(db,async tx=>{
      const prior=await tx.prepare('SELECT content_hash,actor_id FROM past_contact_imports WHERE request_key=?').get(key);
      if(prior){if(prior.content_hash!==parsed.hash||prior.actor_id!==admin.id)throw conflict('This import reference belongs to another file.');return {repeated:true,rows:await tx.prepare('SELECT account_id AS studentId,created FROM past_contact_import_rows WHERE request_key=? ORDER BY position').all(key)};}
      await tx.prepare('INSERT INTO past_contact_imports(request_key,content_hash,actor_id,source,created_at) VALUES (?,?,?,?,?)').run(key,parsed.hash,admin.id,parsed.source,now());
      const rows=[];
      for(const [position,contact] of parsed.contacts.entries()) {
        const existing=await existingStudent(tx,contact.email);
        if(existing&&(existing.role!=='student'||existing.status!=='active'))throw conflict('An account changed. Review the contact preview again.');
        const studentId=String(existing?.id||makeStudentId()),secret=prepared.get(contact.email);
        if(!existing) {
          if(!secret)throw conflict('An account changed during import. Review the latest preview.');
          await tx.prepare('INSERT INTO accounts(id,role,name,email,phone,roll_number,password_hash,must_change,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(studentId,'student',contact.name,contact.email,contact.phone,studentId,secret.hash,1,now());
          await tx.prepare('INSERT INTO student_admissions VALUES (?,?)').run(studentId,now());
          await tx.prepare('INSERT INTO student_profiles(account_id) VALUES (?)').run(studentId);
          await tx.prepare('INSERT INTO portfolios VALUES (?,?,?,?,?)').run(studentId,'','','',0);
        }
        await tx.prepare('INSERT OR IGNORE INTO past_student_contacts(account_id,imported_by,created_at) VALUES (?,?,?)').run(studentId,admin.id,now());
        await tx.prepare('INSERT INTO past_contact_import_rows VALUES (?,?,?,?)').run(key,studentId,Number(!existing),position);
        rows.push({studentId,created:Number(!existing)});
      }
      await audit(tx,admin.id,'Past student contacts imported',key,`${rows.length} contacts; ${rows.filter(r=>r.created).length} new logins; no certificates or emails created.`);
      return {repeated:false,rows};
    });
    const rows=[];
    for(const [index,row] of result.rows.entries()) {
      const contact=parsed.contacts[index] as PastStudentContactInput,studentId=String(row.studentId);
      const account=await db.prepare('SELECT email,password_hash,must_change FROM accounts WHERE id=?').get(studentId);
      if(!account||account.email!==contact.email)throw conflict('An imported account changed. Review its existing record.');
      const password=Number(row.created)&&account.must_change&&await verifyPassword(String(passwords[contact.email]),String(account.password_hash))?String(passwords[contact.email]):undefined;
      const pending=await db.prepare("SELECT 1 FROM student_admissions WHERE account_id=? AND approved_at=''").get(studentId);
      rows.push({studentId,name:contact.name,email:contact.email,created:Boolean(row.created),access:pending?undefined:await accessPackage(db,studentId,portalOrigin(req),password),note:pending?'Existing admission approval is pending; account settings are unchanged.':password?'Temporary login ready. Student sets a new password at first sign-in.':'Existing password and profile retained.'});
    }
    res.status(201).json({rows,total:rows.length,created:rows.filter(r=>r.created).length,existing:rows.filter(r=>!r.created).length,repeated:result.repeated,emailsSent:0,certificatesIssued:0});
  }));
}
