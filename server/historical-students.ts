import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, makeStudentId, now, transaction } from './database.js';
import { audit, certificateRecords } from './academy-data.js';
import { accessPackage } from './admissions.js';
import { portalOrigin } from './microsoft.js';
import { hashPassword, temporaryPassword } from './passwords.js';
import { badRequest, conflict, emailAddress, field, notFound, route } from './http.js';
import { phoneNumber } from './inputs.js';
import { fileDownloadLocation } from './learning-files.js';

export async function historicalTraining(db:Database, accountId?:string) {
  return db.prepare(`SELECT h.id,h.account_id AS accountId,a.name,a.email,a.phone,h.course_id AS courseId,c.course_title AS courseTitle,
    h.certificate_id AS certificateId,h.qualification,h.completed_at AS completedAt,h.mode,h.original_number AS originalNumber,
    h.file_id AS fileId,h.note,h.created_at AS createdAt FROM legacy_training h JOIN accounts a ON a.id=h.account_id JOIN certificates c ON c.id=h.certificate_id
    ${accountId?'WHERE h.account_id=?':''} ORDER BY h.created_at DESC`).all(...(accountId?[accountId]:[]));
}
export function mountHistoricalStudents(app:Express,db:WritableDatabase) {
  app.get('/api/admin/past-students',route(async(req,res)=>{await requireAccount(db,req,'admin');res.json({records:await historicalTraining(db)});}));
  app.get('/api/student/past-training',route(async(req,res)=>{const account=await requireAccount(db,req,'student');const records=await historicalTraining(db,account.id);res.json({records:records.map(({note: _note,...row})=>row)});}));
  app.post('/api/admin/past-students',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin'), email=emailAddress(req.body?.email), name=field(req.body?.name,'student name',120),phone=phoneNumber(req.body?.phone);
    const courseId=field(req.body?.courseId,'course',80),qualification=field(req.body?.qualification,'qualification',200,false), mode=field(req.body?.mode,'training mode',20);
    if (!['offline','online','hybrid'].includes(mode)) throw badRequest('Choose offline, online or hybrid training.');
    if (req.body?.verified!==true) throw badRequest('Verify the past training and certificate details before importing this record.');
    const date=(key:string)=>{const input=field(req.body?.[key],key,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(input)||!Number.isFinite(Date.parse(input+'T12:00:00Z'))||new Date(input+'T12:00:00Z').toISOString().slice(0,10)!==input||Date.parse(input+'T00:00:00Z')>Date.now())throw badRequest('Use a valid completion and issue date, no later than today.');return input;};
    const completedAt=date('completedAt'),issuedAt=date('issuedAt');if(issuedAt<completedAt)throw badRequest('The issue date must be on or after training completion.');
    const originalNumber=field(req.body?.originalNumber,'original certificate reference',100,false), note=field(req.body?.note,'internal note',3000,false),fileId=field(req.body?.fileId,'original certificate file',80,false);
    const rawScore=req.body?.score, scoreRecorded=rawScore!==''&&rawScore!==undefined&&rawScore!==null,score=scoreRecorded?Number(rawScore):0;
    if(!Number.isInteger(score)||score<0||score>100)throw badRequest('Enter a score from 0 to 100, or leave it blank when not recorded.');
    const requestKey=field(req.body?.requestKey,'import reference',80);if(!/^[\w-]{16,80}$/.test(requestKey))throw badRequest('Open a fresh import form.');
    const password=temporaryPassword(),passwordHash=await hashPassword(password);
    const result=await transaction(db,async tx=>{
      const prior=await tx.prepare('SELECT h.account_id,h.course_id,a.email FROM legacy_import_requests r JOIN legacy_training h ON h.id=r.record_id JOIN accounts a ON a.id=h.account_id WHERE r.request_key=?').get(requestKey);
      if(prior){if(prior.email!==email||prior.course_id!==courseId)throw conflict('This import reference belongs to another student.');return {studentId:String(prior.account_id),created:false};}
      const course=await tx.prepare('SELECT title FROM courses WHERE id=?').get(courseId);if(!course)throw notFound('Create or select the historical course first. A draft course may be used.');
      const existing=await tx.prepare('SELECT a.id,a.role,COALESCE(c.status,\'active\') AS status FROM accounts a LEFT JOIN account_controls c ON c.account_id=a.id WHERE email=? COLLATE NOCASE').get(email);
      if(existing&&(existing.role!=='student'||existing.status!=='active'))throw conflict('This email belongs to an administrator or an inactive account. Use its existing account controls.');
      const studentId=String(existing?.id||makeStudentId());
      if(await tx.prepare('SELECT 1 FROM certificates WHERE account_id=? AND course_id=?').get(studentId,courseId))throw conflict('This student already has a certificate for this course. Review that record before importing another.');
      if(fileId&&!await tx.prepare("SELECT 1 FROM academy_files WHERE id=? AND kind='certificate' AND course_id=? AND completed_at<>''").get(fileId,courseId))throw badRequest('Upload the original certificate PDF for this course first.');
      if(fileId&&await tx.prepare('SELECT 1 FROM legacy_training WHERE file_id=?').get(fileId))throw conflict('This original PDF is already assigned to another historical record.');
      if(!existing){
        await tx.prepare('INSERT INTO accounts(id,role,name,email,phone,roll_number,password_hash,must_change,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(studentId,'student',name,email,phone,studentId,passwordHash,1,now());
        await tx.prepare('INSERT INTO student_admissions VALUES (?,?)').run(studentId,now());
        await tx.prepare('INSERT INTO student_profiles(account_id,headline) VALUES (?,?)').run(studentId,qualification.slice(0,160));
        await tx.prepare('INSERT INTO portfolios VALUES (?,?,?,?,?)').run(studentId,qualification.slice(0,160),'','',0);
      }
      await tx.prepare('INSERT INTO student_admissions VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET approved_at=excluded.approved_at').run(studentId,now());
      const certificateId=`PBS-CERT-${randomBytes(6).toString('hex').toUpperCase()}`,id=makeId();
      await tx.prepare('INSERT INTO certificates(id,account_id,course_id,student_name,course_title,score,issued_at,public_token) VALUES (?,?,?,?,?,?,?,?)').run(certificateId,studentId,courseId,name,String(course.title),score,issuedAt+'T12:00:00Z',randomBytes(24).toString('base64url'));
      await tx.prepare(`INSERT INTO legacy_training(id,account_id,course_id,certificate_id,qualification,completed_at,mode,original_number,score_recorded,file_id,note,imported_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,studentId,courseId,certificateId,qualification,completedAt,mode,originalNumber,Number(scoreRecorded),fileId||null,note,admin.id,now());
      await tx.prepare('INSERT INTO legacy_import_requests VALUES (?,?)').run(requestKey,id);
      await audit(tx,admin.id,'Past student credential imported',studentId,`${String(course.title)} · ${mode} · ${completedAt}`);
      return {studentId,created:!existing};
    });
    res.status(201).json({access:await accessPackage(db,result.studentId,portalOrigin(req),result.created?password:undefined),created:result.created});
  }));
  app.get('/api/certificates/:id/original',route(async(req,res)=>{
    const account=await requireAccount(db,req),row=await db.prepare('SELECT h.account_id,h.file_id,c.revoked_at FROM legacy_training h JOIN certificates c ON c.id=h.certificate_id WHERE h.certificate_id=?').get(req.params.id);
    if(!row||!row.file_id||row.revoked_at||account.role!=='admin'&&row.account_id!==account.id)throw notFound('This original certificate is unavailable.');
    res.redirect(302,(await fileDownloadLocation(db,String(row.file_id))).url);
  }));
  app.get('/api/admin/past-students/:id/certificates',route(async(req,res)=>{await requireAccount(db,req,'admin');res.json({certificates:await certificateRecords(db,req.params.id)});}));
}
