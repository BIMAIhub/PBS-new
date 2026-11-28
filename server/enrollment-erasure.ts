import {createHash} from 'node:crypto';
import type {Express} from 'express';
import {requireAccount} from './auth.js';
import {audit} from './academy-data.js';
import {type Database,type WritableDatabase,transaction} from './database.js';
import {badRequest,conflict,notFound,route} from './http.js';
import {verifyPassword} from './passwords.js';
import {releaseExpiredMailLocks} from './mail-history.js';
import {queueStudentStorageCleanup,cleanupStudentStorage} from './student-storage-cleanup.js';
import type {graph} from './microsoft.js';

function enrollmentIds(input:unknown){
  if(!Array.isArray(input)||!input.length||input.length>25||input.some(id=>typeof id!=='string'||!id||id.length>80))throw badRequest('Select between 1 and 25 enrollments.');
  const ids=[...new Set(input as string[])].sort();if(ids.length!==input.length)throw badRequest('Choose each enrollment only once.');return ids;
}
async function removalSnapshot(db:Database,ids:string[]){
  await releaseExpiredMailLocks(db);const slots=ids.map(()=>'?').join(',');
  const enrollments=await db.prepare(`SELECT e.*,a.name,a.email,c.title AS courseTitle FROM enrollments e JOIN accounts a ON a.id=e.account_id JOIN courses c ON c.id=e.course_id WHERE e.id IN (${slots}) ORDER BY e.id`).all(...ids);
  if(enrollments.length!==ids.length)throw notFound('An enrollment was removed. Refresh the ledger and select the current records.');
  const linked:Record<string,Record<string,any>[]>={};
  for(const table of ['receipts','enrollment_details','enrollment_prices','enrollment_batches','enrollment_controls','course_access_grants','payment_reminders','referrals'])linked[table]=await db.prepare(`SELECT * FROM ${table} WHERE enrollment_id IN (${slots}) ORDER BY enrollment_id`).all(...ids);
  linked.receipt_balances=await db.prepare(`SELECT b.* FROM receipt_balances b JOIN receipts r ON r.id=b.receipt_id WHERE r.enrollment_id IN (${slots}) ORDER BY r.id`).all(...ids);
  const mail=[];for(const id of ids)mail.push(...await db.prepare('SELECT id,event_key,status FROM mail_outbox WHERE instr(event_key,?)=1 ORDER BY id').all(`welcome:${id}:`));
  const wallet=await db.prepare(`SELECT id,account_id,amount,kind,note,referral_id FROM referral_wallet WHERE (kind='course_payment' AND note IN (${slots})) OR referral_id IN(SELECT id FROM referrals WHERE enrollment_id IN (${slots})) ORDER BY id`).all(...ids,...ids);
  const activeDirect=await db.prepare(`SELECT d.id,d.status FROM access_deliveries d WHERE d.account_id IN(SELECT account_id FROM enrollments WHERE id IN (${slots})) AND d.status='pending' AND d.created_at>? ORDER BY d.id`).all(...ids,new Date(Date.now()-120000).toISOString());
  const storages=await db.prepare(`SELECT s.* FROM course_storage s WHERE s.course_id IN(SELECT course_id FROM enrollments WHERE id IN (${slots})) ORDER BY s.course_id`).all(...ids);
  const recent=(r:Record<string,any>,key:string)=>Date.parse(String(r[key]||''))>Date.now()-120000;
  const blocked=wallet.length||linked.receipts.some(r=>r.method==='PBS wallet')?'A selected enrollment has wallet payments or credited referral rewards. Reconcile those wallet entries before removal.':
    mail.some(m=>m.status==='sending')||activeDirect.length||linked.payment_reminders.some(r=>r.status==='pending'&&recent(r,'sent_at'))?'An enrollment-related email is currently sending. Wait for its result before removal.':
    linked.course_access_grants.some(r=>r.status==='granting'&&recent(r,'updated_at'))?'OneDrive access is currently being granted. Wait for it to finish before removal.':'';
  const summary={enrollments:enrollments.map(e=>({id:String(e.id),studentId:String(e.account_id),name:String(e.name),email:String(e.email),courseTitle:String(e.courseTitle),status:String(e.status),total:Number(e.total),paid:linked.receipts.filter(r=>r.enrollment_id===e.id).reduce((n,r)=>n+Number(r.amount),0)})),receipts:linked.receipts.length,paid:linked.receipts.reduce((n,r)=>n+Number(r.amount),0),reminders:linked.payment_reminders.length,courseGrants:linked.course_access_grants.filter(r=>r.status==='granted').length,blocked};
  return {ids,enrollments,linked,mail,storages,preview:{...summary,reviewToken:createHash('sha256').update(JSON.stringify({enrollments,linked,mail,wallet,activeDirect,storages})).digest('hex')}};
}

export function mountEnrollmentErasure(app:Express,db:WritableDatabase,options:{defer?:(task:Promise<unknown>)=>void;request?:typeof graph}={}){
  app.post('/api/admin/enrollments/removal-preview',route(async(req,res)=>{await requireAccount(db,req,'admin');res.json((await removalSnapshot(db,enrollmentIds(req.body?.ids))).preview);}));
  app.delete('/api/admin/enrollments',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');if(!await verifyPassword(String(req.body?.current||''),admin.passwordHash))throw badRequest('The current admin password is incorrect.');
    if(req.body?.confirmation!=='REMOVE ENROLLMENTS')throw badRequest('Type REMOVE ENROLLMENTS to confirm permanent removal.');
    const ids=enrollmentIds(req.body?.ids),slots=ids.map(()=>'?').join(',');
    const removed=await transaction(db,async tx=>{
      const latest=await requireAccount(tx,req,'admin');if(latest.passwordHash!==admin.passwordHash)throw conflict('Your sign-in changed. Sign in again.');
      const snapshot=await removalSnapshot(tx,ids),{preview,linked}=snapshot;
      if(preview.reviewToken!==req.body?.reviewToken)throw conflict('Enrollment or payment records changed. Refresh the review before removing them.');if(preview.blocked)throw conflict(preview.blocked);
      for(const grant of linked.course_access_grants){const e=snapshot.enrollments.find(e=>e.id===grant.enrollment_id),storage=snapshot.storages.find(s=>s.course_id===e?.course_id);if(!storage)continue;let permissions:unknown=[];try{permissions=JSON.parse(String(grant.permission_ids||'[]'));}catch{}if(Array.isArray(permissions))for(const permission of permissions)if(typeof permission==='string'&&permission)await queueStudentStorageCleanup(tx,{adminId:String(storage.admin_id),operation:'permission',driveId:String(storage.drive_id),itemId:String(storage.item_id),permissionId:permission});}
      for(const mail of snapshot.mail){await tx.prepare('DELETE FROM mail_delivery_locks WHERE outbox_id=?').run(mail.id);await tx.prepare('DELETE FROM mail_outbox WHERE id=?').run(mail.id);}
      for(const reminder of linked.payment_reminders){const e=snapshot.enrollments.find(e=>e.id===reminder.enrollment_id);await tx.prepare("DELETE FROM messages WHERE account_id=? AND sender='admin' AND subject='Course fee reminder' AND body=? AND sent_at=?").run(e!.account_id,reminder.body,reminder.sent_at);}
      for(const receipt of linked.receipts)await tx.prepare('DELETE FROM notifications WHERE id=?').run(`receipt:${receipt.id}`);
      for(const id of ids)await tx.prepare('DELETE FROM notifications WHERE instr(id,?)=1 OR instr(id,?)=1').run(`payment:${id}:`,`application:${id}:`);
      await tx.prepare(`DELETE FROM academy_events WHERE target_id IN (${slots}) OR target_id IN(SELECT id FROM receipts WHERE enrollment_id IN (${slots}))`).run(...ids,...ids);
      await tx.prepare(`DELETE FROM receipt_balances WHERE receipt_id IN(SELECT id FROM receipts WHERE enrollment_id IN (${slots}))`).run(...ids);
      for(const table of ['receipts','payment_reminders','enrollment_details','enrollment_prices','enrollment_batches','enrollment_controls','course_access_grants','referrals'])await tx.prepare(`DELETE FROM ${table} WHERE enrollment_id IN (${slots})`).run(...ids);
      await tx.prepare(`DELETE FROM enrollments WHERE id IN (${slots})`).run(...ids);
      await audit(tx,admin.id,'Enrollments and payment history removed','',`${ids.length} enrollments and ${preview.receipts} receipts removed. Student accounts and learning records retained.`);
      return {enrollments:ids.length,receipts:preview.receipts,paid:preview.paid};
    });
    const work=cleanupStudentStorage(db,options.request).catch(()=>undefined);if(options.defer)options.defer(work);else await work;
    res.json({removed,permissionCleanupPending:Number((await db.prepare('SELECT COUNT(*) AS n FROM student_storage_cleanup').get())?.n||0)});
  }));
}
