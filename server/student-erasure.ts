import {createHash} from 'node:crypto';
import type {Express} from 'express';
import {findAccount,requireAccount} from './auth.js';
import {type Database,type WritableDatabase,now,transaction} from './database.js';
import {audit} from './academy-data.js';
import {badRequest,conflict,notFound,route} from './http.js';
import {verifyPassword} from './passwords.js';
import {forgetStudentCertificateFiles} from './certificate-documents.js';
import {queueStudentStorageCleanup,cleanupAllPrivateFiles} from './student-storage-cleanup.js';
import {releaseExpiredMailLocks} from './mail-history.js';
import type {graph} from './microsoft.js';

export async function studentDeletionPreview(db:Database,id:string){
  const student=await findAccount(db,id);if(!student||student.role!=='student')throw notFound('This student is unavailable.');
  await releaseExpiredMailLocks(db);
  const enrollments=await db.prepare('SELECT id,total,status,requested_payment,reference FROM enrollments WHERE account_id=? ORDER BY id').all(id);
  const receipts=await db.prepare('SELECT r.id,r.amount,r.reference FROM receipts r JOIN enrollments e ON e.id=r.enrollment_id WHERE e.account_id=? ORDER BY r.id').all(id);
  const certificates=await db.prepare('SELECT id FROM certificates WHERE account_id=? ORDER BY id').all(id);
  const files=await db.prepare('SELECT id,item_id,parent_id,upload_url FROM drive_uploads WHERE account_id=? ORDER BY id').all(id);
  const mail=await db.prepare('SELECT id,status,created_at FROM mail_outbox WHERE account_id=? OR email=? COLLATE NOCASE ORDER BY id').all(id,student.email);
  const counts=await db.prepare(`WITH target AS (SELECT ? AS id,? AS email)
    SELECT (SELECT COUNT(*) FROM completions WHERE account_id=(SELECT id FROM target)) AS lessonCompletions,
    (SELECT COUNT(*) FROM task_submissions WHERE account_id=(SELECT id FROM target)) AS assignments,
    (SELECT COUNT(*) FROM live_attendance WHERE account_id=(SELECT id FROM target)) AS liveAttendance,
    (SELECT COUNT(*) FROM messages WHERE account_id=(SELECT id FROM target)) AS messages,
    (SELECT COUNT(*) FROM course_feedback WHERE account_id=(SELECT id FROM target)) AS feedback,
    (SELECT COUNT(*) FROM assignment_drive_files WHERE account_id=(SELECT id FROM target)) AS assignmentFiles,
    (SELECT COUNT(*) FROM legacy_training WHERE account_id=(SELECT id FROM target) AND file_id IS NOT NULL) AS originalCertificates,
    (SELECT COUNT(*) FROM push_devices WHERE account_id=(SELECT id FROM target)) AS devices,
    (SELECT COUNT(*) FROM referral_payouts WHERE account_id=(SELECT id FROM target) AND status IN ('requested','processing')) AS activePayouts,
    (SELECT COUNT(*) FROM access_deliveries WHERE account_id=(SELECT id FROM target) AND status='pending' AND created_at>?) +
    (SELECT COUNT(*) FROM certificate_mail_deliveries WHERE account_id=(SELECT id FROM target) AND status='pending' AND created_at>?) AS activeDirectMail`).get(id,student.email,new Date(Date.now()-120000).toISOString(),new Date(Date.now()-120000).toISOString());
  const summary={studentId:id,name:student.name,email:student.email,accountStatus:student.accountStatus,enrollments:enrollments.length,receipts:receipts.length,paid:receipts.reduce((n,r)=>n+Number(r.amount),0),certificates:certificates.length,mailRecords:mail.length,uploadSessions:files.length,...counts};
  const sending=mail.filter(m=>m.status==='sending').length+Number(counts?.activeDirectMail||0);
  const blocked=Number(counts?.activePayouts)>0?'Finalize or reject the student’s pending referral payout before deletion.':sending?'A student email is currently sending. Wait for its result before deletion.':'';
  return {...summary,blocked,reviewToken:createHash('sha256').update(JSON.stringify({student,enrollments,receipts,certificates,files:files.map(f=>({id:f.id,item_id:f.item_id,parent_id:f.parent_id})),mail,counts})).digest('hex')};
}

async function eraseStudent(db:Database,id:string,email:string){
  const uploads=await db.prepare('SELECT * FROM drive_uploads WHERE account_id=?').all(id);
  const assignmentFiles=await db.prepare('SELECT f.*,u.admin_id FROM assignment_drive_files f JOIN drive_uploads u ON u.id=f.upload_id WHERE f.account_id=?').all(id);
  const privateCertificates=await db.prepare(`SELECT f.* FROM academy_files f JOIN legacy_training h ON h.file_id=f.id WHERE h.account_id=? AND f.kind='certificate' AND NOT EXISTS(SELECT 1 FROM learning_resources r WHERE r.file_id=f.id)`).all(id);
  const grants=await db.prepare(`SELECT g.permission_ids,s.admin_id,s.drive_id,s.item_id FROM course_access_grants g JOIN enrollments e ON e.id=g.enrollment_id JOIN course_storage s ON s.course_id=e.course_id WHERE e.account_id=?`).all(id);
  for(const upload of uploads){if(upload.upload_url&&!upload.attached_id)await queueStudentStorageCleanup(db,{adminId:String(upload.admin_id),operation:'upload',uploadUrl:String(upload.upload_url)});if(upload.item_id)await queueStudentStorageCleanup(db,{adminId:String(upload.admin_id),operation:'item',driveId:String(upload.drive_id),itemId:String(upload.item_id)});}
  for(const file of [...assignmentFiles,...privateCertificates])if(file.item_id)await queueStudentStorageCleanup(db,{adminId:String(file.admin_id),operation:'item',driveId:String(file.drive_id),itemId:String(file.item_id)});
  for(const grant of grants){let ids:unknown=[];try{ids=JSON.parse(String(grant.permission_ids||'[]'));}catch{}if(Array.isArray(ids))for(const permission of ids)if(typeof permission==='string'&&permission)await queueStudentStorageCleanup(db,{adminId:String(grant.admin_id),operation:'permission',driveId:String(grant.drive_id),itemId:String(grant.item_id),permissionId:permission});}
  const cv=await db.prepare('SELECT cv_path FROM student_profiles WHERE account_id=?').get(id);if(cv?.cv_path)await db.prepare('INSERT OR IGNORE INTO private_file_cleanup(location,created_at) VALUES (?,?)').run(cv.cv_path,now());
  const administrative=await db.prepare('SELECT 1 FROM course_storage WHERE admin_id=? UNION ALL SELECT 1 FROM notice_board WHERE author_id=? UNION ALL SELECT 1 FROM receipts WHERE issued_by=? UNION ALL SELECT 1 FROM class_completion WHERE completed_by=? UNION ALL SELECT 1 FROM legacy_training WHERE imported_by=? AND account_id<>? LIMIT 1').get(id,id,id,id,id,id);
  if(administrative)throw conflict('This student owns administrative records. Reassign those records before permanent deletion.');
  // Preserve other learners’ earned money while removing their link to the erased identity.
  await db.prepare("UPDATE referral_wallet SET referral_id=NULL,note='Referral reward — source record removed' WHERE account_id<>? AND referral_id IN (SELECT id FROM referrals WHERE referrer_id=? OR referred_id=?)").run(id,id,id);
  await db.prepare("UPDATE enrollment_prices SET referrer_id='',code='',promotion_id='',promotion_title='Referral offer — referrer record removed' WHERE referrer_id=? AND enrollment_id NOT IN (SELECT id FROM enrollments WHERE account_id=?)").run(id,id);
  await db.prepare('DELETE FROM referral_wallet WHERE account_id=?').run(id);
  await db.prepare('DELETE FROM referrals WHERE referrer_id=? OR referred_id=? OR enrollment_id IN (SELECT id FROM enrollments WHERE account_id=?)').run(id,id,id);
  await db.prepare('DELETE FROM promotions WHERE owner_id=? OR assigned_email=? COLLATE NOCASE').run(id,email);
  const privateCampaigns=await db.prepare(`SELECT c.id FROM mail_campaigns c WHERE EXISTS(SELECT 1 FROM mail_campaign_recipients r WHERE r.campaign_id=c.id AND (r.account_id=? OR r.email=? COLLATE NOCASE)) AND NOT EXISTS(SELECT 1 FROM mail_campaign_recipients r WHERE r.campaign_id=c.id AND r.account_id<>? AND r.email<>? COLLATE NOCASE) AND NOT EXISTS(SELECT 1 FROM mail_outbox o WHERE o.campaign_id=c.id AND o.account_id<>? AND o.email<>? COLLATE NOCASE)`).all(id,email,id,email,id,email);
  await db.prepare('DELETE FROM mail_delivery_locks WHERE outbox_id IN (SELECT id FROM mail_outbox WHERE account_id=? OR email=? COLLATE NOCASE)').run(id,email);
  await db.prepare('DELETE FROM mail_outbox WHERE account_id=? OR email=? COLLATE NOCASE').run(id,email);
  await db.prepare('DELETE FROM campaign_lead_links WHERE email=? COLLATE NOCASE').run(email);
  await db.prepare('DELETE FROM mail_campaign_recipients WHERE account_id=? OR email=? COLLATE NOCASE').run(id,email);
  for(const campaign of privateCampaigns){await db.prepare('DELETE FROM campaign_lead_links WHERE campaign_id=?').run(campaign.id);await db.prepare('DELETE FROM mail_campaigns WHERE id=?').run(campaign.id);await db.prepare('DELETE FROM academy_events WHERE target_id=?').run(campaign.id);}
  await db.prepare('DELETE FROM mail_contacts WHERE email=? COLLATE NOCASE').run(email);
  await db.prepare('DELETE FROM course_leads WHERE email=? COLLATE NOCASE').run(email);
  await db.prepare(`DELETE FROM academy_events WHERE actor_id=? OR target_id=? OR target_id IN(SELECT id FROM enrollments WHERE account_id=?) OR target_id IN(SELECT id FROM certificates WHERE account_id=?) OR target_id IN(SELECT r.id FROM receipts r JOIN enrollments e ON e.id=r.enrollment_id WHERE e.account_id=?) OR target_id IN(SELECT id FROM task_submissions WHERE account_id=?) OR target_id IN(SELECT id FROM drive_uploads WHERE account_id=?) OR instr(lower(detail),lower(?))>0 OR instr(detail,?)>0`).run(id,id,id,id,id,id,id,email,id);
  await db.prepare('DELETE FROM notifications WHERE account_id=? OR instr(body,?)>0 OR instr(lower(body),lower(?))>0').run(id,id,email);
  // Older assignment notifications lack an owner key; their full generated filename identifies the upload.
  const student=await db.prepare('SELECT name FROM accounts WHERE id=?').get(id);
  for(const file of assignmentFiles)await db.prepare("DELETE FROM notifications WHERE kind='assignment' AND body=?").run(`${student?.name} submitted ${file.filename}.`);
  await db.prepare('DELETE FROM assignment_drive_files WHERE account_id=?').run(id);
  await db.prepare('DELETE FROM drive_uploads WHERE account_id=?').run(id);
  await db.prepare('DELETE FROM legacy_training WHERE account_id=?').run(id);
  for(const file of privateCertificates)await db.prepare('DELETE FROM academy_files WHERE id=?').run(file.id);
  await db.prepare('DELETE FROM receipt_balances WHERE receipt_id IN (SELECT r.id FROM receipts r JOIN enrollments e ON e.id=r.enrollment_id WHERE e.account_id=?)').run(id);
  await db.prepare('DELETE FROM receipts WHERE enrollment_id IN (SELECT id FROM enrollments WHERE account_id=?)').run(id);
  for(const table of ['enrollment_batches','enrollment_controls','enrollment_details','enrollment_prices','course_access_grants','payment_reminders'])await db.prepare(`DELETE FROM ${table} WHERE enrollment_id IN (SELECT id FROM enrollments WHERE account_id=?)`).run(id);
  for(const table of ['certificate_mail_deliveries','alumni_welcomes','quiz_attempts','past_contact_import_rows','past_student_contacts','referral_code_controls','referral_bank_details','referral_payouts','referral_codes','lesson_watch_sessions','lesson_watch_totals','lesson_progress','live_attendance','course_feedback','task_submissions','access_deliveries','completions','assignments','messages','course_posts','assessment_results','placements','portfolio_links','portfolio_sections','portfolios','student_profiles','video_uploads','push_deliveries','push_devices','account_controls','student_admissions','sessions','certificates'])await db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(id);
  for(const table of ['microsoft_oauth','microsoft_connections','microsoft_mail_connections','curriculum_drafts','lesson_video_owners'])await db.prepare(`DELETE FROM ${table} WHERE admin_id=?`).run(id);
  await db.prepare('DELETE FROM enrollments WHERE account_id=?').run(id);
  await db.prepare("DELETE FROM accounts WHERE id=? AND role='student'").run(id);
  await db.prepare('DELETE FROM past_contact_imports WHERE NOT EXISTS(SELECT 1 FROM past_contact_import_rows r WHERE r.request_key=past_contact_imports.request_key)').run();
}

export function mountStudentErasure(app:Express,db:WritableDatabase,options:{defer?:(task:Promise<unknown>)=>void;request?:typeof graph}={}){
  app.get('/api/admin/students/:id/deletion-preview',route(async(req,res)=>{await requireAccount(db,req,'admin');res.json(await studentDeletionPreview(db,req.params.id));}));
  app.delete('/api/admin/students/:id/permanent',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');if(!await verifyPassword(String(req.body?.current||''),admin.passwordHash))throw badRequest('The current admin password is incorrect.');
    if(req.body?.confirmation!=='DELETE STUDENT')throw badRequest('Type DELETE STUDENT to confirm permanent deletion.');
    const result=await transaction(db,async tx=>{
      const latest=await requireAccount(tx,req,'admin');if(latest.passwordHash!==admin.passwordHash)throw conflict('Your sign-in changed. Sign in again.');
      const preview=await studentDeletionPreview(tx,req.params.id);
      if(String(req.body?.confirmEmail||'').trim().toLowerCase()!==preview.email.toLowerCase())throw badRequest('Type the student email to confirm deletion.');
      if(preview.reviewToken!==req.body?.reviewToken)throw conflict('Student records changed. Review the latest deletion counts.');
      if(preview.blocked)throw conflict(preview.blocked);
      await eraseStudent(tx,req.params.id,preview.email);await audit(tx,admin.id,'Student records permanently deleted','',`${preview.enrollments} enrollments, ${preview.receipts} payment receipts and ${preview.certificates} certificates removed.`);
      return {enrollments:preview.enrollments,receipts:preview.receipts,certificates:preview.certificates};
    });
    forgetStudentCertificateFiles(req.params.id);
    const work=cleanupAllPrivateFiles(db,options.request).catch(()=>undefined);
    if(options.defer)options.defer(work);else await work;
    const pending=Number((await db.prepare('SELECT COUNT(*) AS n FROM student_storage_cleanup').get())?.n||0)+Number((await db.prepare('SELECT COUNT(*) AS n FROM private_file_cleanup').get())?.n||0);
    res.json({deleted:true,removed:result,privateFileCleanupPending:pending});
  }));
}
