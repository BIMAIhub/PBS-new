import type { Express } from 'express';
import { requireAccount,publicAccount } from './auth.js';
import { type Database,type WritableDatabase,makeId,now,transaction } from './database.js';
import { audit } from './academy-data.js';
import { badRequest,conflict,field,notFound,route } from './http.js';
import { studentWorkspace } from './records.js';
import { enrollmentBatch } from './learning-access.js';

const noticeFields=`n.id,n.title,n.body,n.kind,n.course_id AS courseId,n.batch_id AS batchId,n.published,n.starts_at AS startsAt,n.expires_at AS expiresAt,n.revision,n.created_at AS createdAt`;
export async function learnerNotices(db:Database,accountId:string){
  return await db.prepare(`SELECT ${noticeFields} FROM notice_board n WHERE n.published=1 AND n.starts_at<=? AND (n.expires_at='' OR n.expires_at>?)
    AND (n.course_id='' OR EXISTS(SELECT 1 FROM enrollments e WHERE e.account_id=? AND e.course_id=n.course_id AND e.status='approved'))
    AND (n.batch_id='' OR EXISTS(SELECT 1 FROM enrollment_batches eb JOIN enrollments e ON e.id=eb.enrollment_id WHERE e.account_id=? AND e.status='approved' AND eb.batch_id=n.batch_id)) ORDER BY n.starts_at DESC LIMIT 100`).all(now(),now(),accountId,accountId);
}
export async function ensureNoticeNotifications(db:Database,accountId:string){
  for(const notice of await learnerNotices(db,accountId))await db.prepare("INSERT OR IGNORE INTO notifications (id,account_id,title,body,kind,page,created_at) VALUES (?,?,?,?,'notice','notices',?)").run(`notice:${notice.id}:${accountId}`,accountId,notice.title,notice.body,notice.startsAt);
}
export function mountAcademyLife(app:Express,db:WritableDatabase){
  app.get('/api/student/notices',route(async(req,res)=>{const a=await requireAccount(db,req,'student');await ensureNoticeNotifications(db,a.id);res.json({notices:await learnerNotices(db,a.id)});}));
  app.get('/api/admin/notices',route(async(req,res)=>{await requireAccount(db,req,'admin');res.json({notices:await db.prepare(`SELECT ${noticeFields} FROM notice_board n ORDER BY n.created_at DESC LIMIT 200`).all()});}));
  const save=route(async(req,res)=>{
    const a=await requireAccount(db,req,'admin'),id=req.params.id||makeId(),kind=field(req.body?.kind,'notice type',20),course=field(req.body?.courseId,'course',80,false),batch=field(req.body?.batchId,'batch',80,false),start=String(req.body?.startsAt||now()),end=field(req.body?.expiresAt,'expiry time',50,false);
    if(!['notice','news'].includes(kind)||!Number.isFinite(Date.parse(start))||end&&(!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start)))throw badRequest('Choose a notice type and valid publication dates.');
    await transaction(db,async tx=>{if(course&&!await tx.prepare('SELECT 1 FROM courses WHERE id=?').get(course))throw badRequest('Choose an existing course.');if(batch&&!await tx.prepare('SELECT 1 FROM course_batches WHERE id=? AND course_id=?').get(batch,course))throw badRequest('Choose a batch in this course.');const prior=await tx.prepare('SELECT revision FROM notice_board WHERE id=?').get(id);if(prior&&prior.revision!==req.body?.revision)throw conflict('This notice changed. Refresh first.');await tx.prepare('INSERT INTO notice_board VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,kind=excluded.kind,course_id=excluded.course_id,batch_id=excluded.batch_id,published=excluded.published,starts_at=excluded.starts_at,expires_at=excluded.expires_at,revision=excluded.revision').run(id,field(req.body?.title,'notice title',160),field(req.body?.body,'notice details',4000),kind,course,batch,Number(req.body?.published===true),new Date(start).toISOString(),end?new Date(end).toISOString():'',a.id,makeId(),now());await audit(tx,a.id,'Academy notice saved',id,kind);});res.json({id});
  });app.post('/api/admin/notices',save);app.put('/api/admin/notices/:id',save);
  app.get('/api/student/journey',route(async(req,res)=>{
    const a=await requireAccount(db,req,'student'),workspace=await studentWorkspace(db,publicAccount(a));
    const viewing=await db.prepare('SELECT lesson_id AS lessonId,media_key AS mediaKey,watched,duration,updated_at AS updatedAt FROM lesson_watch_totals WHERE account_id=?').all(a.id);
    const batches=[];for(const c of workspace.courses){const batch=await enrollmentBatch(db,a.id,c.id);if(batch)batches.push(batch);}
    const certificates=await db.prepare("SELECT id,course_id AS courseId,issued_at AS issuedAt FROM certificates WHERE account_id=? AND revoked_at=''").all(a.id);
    res.json({courses:workspace.courses,completions:workspace.completions,viewing,batches,certificates,live:workspace.live});
  }));
}
