import { createHash } from 'node:crypto';
import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database,type WritableDatabase,now,transaction } from './database.js';
import { audit,saveSetting,setting } from './academy-data.js';
import { badRequest,conflict,limitAttempts,route } from './http.js';
import { verifyPassword } from './passwords.js';
import { cleanupPrivateFiles } from './private-files.js';

async function resetSummary(db:Database){
  const count=async(sql:string)=>Number((await db.prepare(sql).get())?.n||0);
  const students=await db.prepare("SELECT id,email FROM accounts WHERE role='student' ORDER BY id").all();
  const summary={students:students.length,enrollments:await count('SELECT COUNT(*) AS n FROM enrollments'),receipts:await count('SELECT COUNT(*) AS n FROM receipts'),certificates:await count('SELECT COUNT(*) AS n FROM certificates'),assignmentFiles:await count('SELECT COUNT(*) AS n FROM assignment_drive_files'),bankRecords:await count('SELECT COUNT(*) AS n FROM referral_bank_details'),mailRecords:await count('SELECT COUNT(*) AS n FROM mail_outbox')};
  return{...summary,reviewToken:createHash('sha256').update(JSON.stringify({students,summary})).digest('hex')};
}
export function mountAcademyReset(app:Express,db:WritableDatabase,hosted:boolean){
  app.get('/api/admin/reset-preview',route(async(req,res)=>{await requireAccount(db,req,'admin');res.json({...await resetSummary(db),privateFileCleanupPending:Number((await db.prepare('SELECT COUNT(*) AS n FROM private_file_cleanup').get())?.n||0),preserved:['Current administrator email, name and password','Course content and videos','Branding, certificate designs and stamps','Batches, live sessions and release rules','Microsoft account connections and application settings']});}));
  app.post('/api/admin/reset-cleanup',route(async(req,res)=>{await requireAccount(db,req,'admin');res.json(await cleanupPrivateFiles(db));}));
  app.post('/api/admin/reset-students',limitAttempts(3,hosted?db:undefined),route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');if(!await verifyPassword(String(req.body?.current||''),admin.passwordHash))throw badRequest('The current admin password is incorrect.');
    if(req.body?.confirmation!=='DELETE STUDENT DATA')throw badRequest('Type DELETE STUDENT DATA to confirm this permanent reset.');
    const result=await transaction(db,async tx=>{
      const preview=await resetSummary(tx);if(preview.reviewToken!==req.body?.reviewToken)throw conflict('Student records changed. Review the latest counts before resetting.');
      const pending=await tx.prepare("SELECT 1 FROM referral_payouts WHERE status IN ('requested','processing') LIMIT 1").get();if(pending)throw conflict('Finalize or reject pending referral payouts before deleting the student ledger.');
      const assets=await tx.prepare("SELECT cv_path FROM student_profiles WHERE cv_path<>''").all();
      for(const asset of assets)await tx.prepare('INSERT OR IGNORE INTO private_file_cleanup(location,created_at) VALUES (?,?)').run(asset.cv_path,now());
      // Children first. Administrators and their authentication records are never updated.
      for(const table of ['mail_outbox','mail_campaign_recipients','mail_campaigns','mail_contacts','referral_payouts','referral_bank_details','referral_wallet','referrals','referral_codes','assignment_drive_files','task_submissions','live_attendance','lesson_watch_sessions','lesson_watch_totals','lesson_progress','completions','assessment_results','certificates','course_feedback','access_deliveries','course_access_grants','payment_reminders','receipt_balances','receipts','enrollment_batches','enrollment_controls','enrollment_details','enrollment_prices','student_admissions','assignments','messages','course_posts','placements','portfolio_links','portfolio_sections','portfolios','student_profiles'])await tx.prepare(`DELETE FROM ${table}`).run();
      await tx.prepare("DELETE FROM drive_uploads WHERE account_id IN (SELECT id FROM accounts WHERE role='student')").run();
      await tx.prepare("DELETE FROM video_uploads WHERE account_id IN (SELECT id FROM accounts WHERE role='student')").run();
      await tx.prepare("DELETE FROM promotions WHERE kind='referral' OR owner_id<>''").run();
      await tx.prepare('DELETE FROM enrollments').run();
      await tx.prepare("DELETE FROM notifications").run();
      await tx.prepare("DELETE FROM account_controls WHERE account_id IN (SELECT id FROM accounts WHERE role='student')").run();
      await tx.prepare("DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE role='student')").run();
      await tx.prepare("DELETE FROM accounts WHERE role='student'").run();
      await tx.prepare('DELETE FROM academy_events').run();
      const community=JSON.parse(await setting(tx,'learner_community')||'{}');await saveSetting(tx,'learner_community',JSON.stringify({...community,historicalLearners:0}));
      await audit(tx,admin.id,'Student records reset','',`${preview.students} student accounts removed; administrators preserved.`);
      return{preview};
    });
    const cleanup=await cleanupPrivateFiles(db);
    res.json({reset:true,removed:result.preview.students,privateFileCleanupPending:cleanup.pending});
  }));
}
