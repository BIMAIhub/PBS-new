import type { Database } from './database.js';
import { badRequest, conflict, notFound } from './http.js';

export async function enrollmentBatch(db: Database, accountId: string, courseId: string) {
  return await db.prepare(`SELECT b.id,b.name,b.course_id AS courseId,b.starts_at AS startsAt,b.deadline FROM course_batches b JOIN enrollment_batches eb ON eb.batch_id=b.id JOIN enrollments e ON e.id=eb.enrollment_id WHERE e.account_id=? AND e.course_id=? AND e.status<>'rejected'`).get(accountId,courseId);
}
export async function batchAccess(db: Database, accountId: string, courseId: string, classId: string) {
  const mapped=await db.prepare('SELECT batch_id FROM live_class_batches WHERE class_id=?').get(classId);
  return !mapped || (await enrollmentBatch(db,accountId,courseId))?.id===mapped.batch_id;
}
export async function assignEnrollmentBatch(db: Database, enrollmentId: string, batchId: string, courseId: string, admin = false) {
  if(!batchId){if(!admin&&await db.prepare('SELECT 1 FROM course_batches WHERE course_id=? LIMIT 1').get(courseId))throw conflict('Choose an open course batch before applying.');return;}
  const batch=await db.prepare('SELECT * FROM course_batches WHERE id=? AND course_id=?').get(batchId,courseId);
  if(!batch)throw badRequest('Choose a batch in this course.');
  if(!admin&&(batch.status!=='open'||Date.parse(String(batch.deadline))<=Date.now()))throw conflict('Enrollment for this batch has closed. Choose another open batch.');
  const used=Number((await db.prepare(`SELECT COUNT(*) AS n FROM enrollment_batches eb JOIN enrollments e ON e.id=eb.enrollment_id WHERE eb.batch_id=? AND e.status<>'rejected' AND e.id<>?`).get(batchId,enrollmentId))?.n||0);
  if(used>=Number(batch.capacity))throw conflict('This batch is full. Choose another batch.');
  await db.prepare('INSERT INTO enrollment_batches VALUES (?,?) ON CONFLICT(enrollment_id) DO UPDATE SET batch_id=excluded.batch_id').run(enrollmentId,batchId);
}
export async function moduleAccess(db: Database, accountId: string, moduleId: string, clock=Date.now()) {
  const module=await db.prepare('SELECT course_id FROM modules WHERE id=?').get(moduleId);if(!module)throw notFound('This module is unavailable.');
  const batch=await enrollmentBatch(db,accountId,String(module.course_id));
  const rule=await db.prepare("SELECT * FROM module_releases WHERE module_id=? AND batch_id IN ('',?) ORDER BY CASE WHEN batch_id='' THEN 1 ELSE 0 END LIMIT 1").get(moduleId,String(batch?.id||''));
  if(!rule||rule.mode==='open')return{unlocked:true,reason:'',releaseAt:''};
  if(rule.mode==='manual')return{unlocked:Boolean(rule.released),reason:rule.released?'':'Your instructor will open this module.',releaseAt:''};
  if(rule.mode==='at'){const unlocked=Date.parse(String(rule.release_at))<=clock;return{unlocked,reason:unlocked?'':'Opens at the scheduled release time.',releaseAt:String(rule.release_at)};}
  const session=await db.prepare(`SELECT l.title,l.ends_at,l.status,l.published,cc.completed_at FROM live_classes l LEFT JOIN class_completion cc ON cc.class_id=l.id WHERE l.id=? AND l.course_id=?`).get(rule.class_id,module.course_id);
  const matches=session&&await batchAccess(db,accountId,String(module.course_id),String(rule.class_id));
  const unlocked=Boolean(matches&&session!.status!=='cancelled'&&session!.published&&(rule.mode==='session_end'?Date.parse(String(session!.ends_at))<=clock:session!.completed_at));
  return{unlocked,reason:unlocked?'':`Available after ${session?.title||'the mapped live session'}${rule.mode==='session'?' is confirmed complete': ' ends'}.`,releaseAt:rule.mode==='session_end'?String(session?.ends_at||''):''};
}
export async function requireLessonRelease(db: Database, account: {id:string;role:string}, lessonId: string) {
  if(account.role==='admin')return;
  const row=await db.prepare('SELECT module_id FROM lessons WHERE id=?').get(lessonId);if(!row)throw notFound('This lesson is unavailable.');
  const access=await moduleAccess(db,account.id,String(row.module_id));if(!access.unlocked)throw new (await import('./http.js')).RequestError(403,access.reason);
}
