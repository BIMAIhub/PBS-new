import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, now, transaction } from './database.js';
import { audit } from './academy-data.js';
import { badRequest, conflict, field, integer, notFound, route } from './http.js';
import { assignEnrollmentBatch } from './learning-access.js';

export async function courseBatches(db: Database, courseId?: string, publicOnly=false) {
  const rows=await db.prepare(`SELECT b.id,b.course_id AS courseId,b.name,b.description,b.starts_at AS startsAt,b.ends_at AS endsAt,b.deadline,b.capacity,b.status,b.revision,
   (SELECT COUNT(*) FROM enrollment_batches eb JOIN enrollments e ON e.id=eb.enrollment_id WHERE eb.batch_id=b.id AND e.status<>'rejected') AS reserved,
   (SELECT COUNT(*) FROM enrollment_batches eb JOIN enrollments e ON e.id=eb.enrollment_id WHERE eb.batch_id=b.id AND e.status='approved') AS enrolled
   FROM course_batches b WHERE 1=1 ${courseId?'AND b.course_id=?':''} ${publicOnly?"AND b.status<>'draft'":''} ORDER BY b.starts_at`).all(...(courseId?[courseId]:[]));
  return rows.map(r=>({...r,remaining:Math.max(0,Number(r.capacity)-Number(r.reserved)),accepting:r.status==='open'&&Date.parse(String(r.deadline))>Date.now()&&Number(r.reserved)<Number(r.capacity)}));
}
export function mountBatches(app:Express,db:WritableDatabase){
  app.get('/api/catalog/:id/batches',route(async(req,res)=>{if(!await db.prepare('SELECT 1 FROM courses WHERE id=? AND published=1').get(req.params.id))throw notFound('This course is unavailable.');res.json({batches:await courseBatches(db,req.params.id,true),hasBatches:Boolean(await db.prepare('SELECT 1 FROM course_batches WHERE course_id=? LIMIT 1').get(req.params.id))});}));
  app.get('/api/admin/batches',route(async(req,res)=>{await requireAccount(db,req,'admin');res.json({batches:await courseBatches(db),students:await db.prepare(`SELECT eb.batch_id AS batchId,e.id AS enrollmentId,a.id,a.name,a.email,e.course_id AS courseId,e.status,e.total,COALESCE((SELECT SUM(r.amount) FROM receipts r WHERE r.enrollment_id=e.id),0) AS paid FROM enrollment_batches eb JOIN enrollments e ON e.id=eb.enrollment_id JOIN accounts a ON a.id=e.account_id ORDER BY a.name`).all()});}));
  const save=route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin'),id=req.params.id||makeId(),courseId=field(req.body?.courseId,'course',80);
    const date=(key:string,optional=false)=>{const value=field(req.body?.[key],key,50,!optional);if(!value&&optional)return'';if(!Number.isFinite(Date.parse(value)))throw badRequest('Choose valid batch dates.');return new Date(value).toISOString();};
    const start=date('startsAt'),end=date('endsAt',true),deadline=date('deadline'),capacity=integer(req.body?.capacity,'batch capacity',1,10000),status=field(req.body?.status,'batch status',20);
    if(!['draft','open','closed'].includes(status)||deadline>start||end&&end<start)throw badRequest('Enrollment must close on or before the start date; the end date must follow the start date.');
    await transaction(db,async tx=>{
      if(!await tx.prepare('SELECT 1 FROM courses WHERE id=?').get(courseId))throw notFound('This course is unavailable.');
      const prior=await tx.prepare('SELECT * FROM course_batches WHERE id=?').get(id);
      if(prior&&(prior.revision!==req.body?.revision||prior.course_id!==courseId))throw conflict('The batch changed. Refresh before saving.');
      const used=Number((await tx.prepare("SELECT COUNT(*) AS n FROM enrollment_batches eb JOIN enrollments e ON e.id=eb.enrollment_id WHERE eb.batch_id=? AND e.status<>'rejected'").get(id))?.n||0);if(capacity<used)throw conflict('Capacity cannot be below the reserved places.');
      await tx.prepare(`INSERT INTO course_batches VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,starts_at=excluded.starts_at,ends_at=excluded.ends_at,deadline=excluded.deadline,capacity=excluded.capacity,status=excluded.status,revision=excluded.revision`).run(id,courseId,field(req.body?.name,'batch name',120),field(req.body?.description,'batch details',1000,false),start,end,deadline,capacity,status,makeId(),now());
      await audit(tx,admin.id,'Course batch saved',id,courseId);
    });res.json({id});
  });app.post('/api/admin/batches',save);app.put('/api/admin/batches/:id',save);
  app.put('/api/admin/enrollments/:id/batch',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');await transaction(db,async tx=>{const e=await tx.prepare('SELECT course_id FROM enrollments WHERE id=?').get(req.params.id);if(!e)throw notFound('This enrollment is unavailable.');await assignEnrollmentBatch(tx,req.params.id,field(req.body?.batchId,'batch',80),String(e.course_id),true);await audit(tx,admin.id,'Enrollment batch updated',req.params.id,String(req.body.batchId));});res.status(204).end();
  }));
  app.get('/api/admin/courses/:id/releases',route(async(req,res)=>{
    await requireAccount(db,req,'admin');res.json({rules:await db.prepare(`SELECT r.module_id AS moduleId,r.batch_id AS batchId,r.mode,r.release_at AS releaseAt,r.class_id AS classId,r.released,r.revision FROM module_releases r JOIN modules m ON m.id=r.module_id WHERE m.course_id=?`).all(req.params.id),sessions:await db.prepare(`SELECT l.id,l.title,l.starts_at AS startsAt,l.ends_at AS endsAt,l.status,COALESCE(b.batch_id,'') AS batchId,COALESCE(c.completed_at,'') AS completedAt FROM live_classes l LEFT JOIN live_class_batches b ON b.class_id=l.id LEFT JOIN class_completion c ON c.class_id=l.id WHERE l.course_id=? ORDER BY l.starts_at`).all(req.params.id)});
  }));
  app.put('/api/admin/modules/:id/release',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin'),batchId=field(req.body?.batchId,'batch',80,false),mode=field(req.body?.mode,'release mode',20),classId=field(req.body?.classId,'live session',80,false),at=field(req.body?.releaseAt,'release time',50,false);
    if(!['open','at','session','session_end','manual','inherit'].includes(mode)||mode==='inherit'&&!batchId||mode==='at'&&!Number.isFinite(Date.parse(at)))throw badRequest('Choose a valid module release rule.');
    await transaction(db,async tx=>{
      const module=await tx.prepare('SELECT course_id FROM modules WHERE id=?').get(req.params.id);if(!module)throw notFound('This module is unavailable.');
      if(batchId&&!await tx.prepare('SELECT 1 FROM course_batches WHERE id=? AND course_id=?').get(batchId,module.course_id))throw badRequest('Choose a batch in this course.');
      if(mode.startsWith('session')){const s=await tx.prepare('SELECT l.course_id,COALESCE(b.batch_id,?) AS batch_id FROM live_classes l LEFT JOIN live_class_batches b ON b.class_id=l.id WHERE l.id=?').get(batchId,classId);if(!s||s.course_id!==module.course_id||s.batch_id!==batchId)throw badRequest('Choose a live session for this course and batch.');}
      const prior=await tx.prepare('SELECT revision FROM module_releases WHERE module_id=? AND batch_id=?').get(req.params.id,batchId);if(String(prior?.revision||'')!==String(req.body?.revision||''))throw conflict('This release rule changed. Refresh and try again.');
      if(mode==='inherit'){await tx.prepare('DELETE FROM module_releases WHERE module_id=? AND batch_id=?').run(req.params.id,batchId);await audit(tx,admin.id,'Module release inherits course defaults',req.params.id,batchId);return;}
      await tx.prepare('INSERT INTO module_releases VALUES (?,?,?,?,?,?,?) ON CONFLICT(module_id,batch_id) DO UPDATE SET mode=excluded.mode,release_at=excluded.release_at,class_id=excluded.class_id,released=excluded.released,revision=excluded.revision').run(req.params.id,batchId,mode,mode==='at'?new Date(at).toISOString():'',mode.startsWith('session')?classId:'',Number(req.body?.released===true),makeId());await audit(tx,admin.id,'Module release saved',req.params.id,mode);
    });res.status(204).end();
  }));
  app.put('/api/admin/live-classes/:id/batch',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin'),batchId=field(req.body?.batchId,'batch',80,false);
    await transaction(db,async tx=>{const s=await tx.prepare('SELECT course_id FROM live_classes WHERE id=?').get(req.params.id);if(!s)throw notFound('This live session is unavailable.');if(batchId&&!await tx.prepare('SELECT 1 FROM course_batches WHERE id=? AND course_id=?').get(batchId,s.course_id))throw badRequest('Choose a batch in this course.');if(batchId)await tx.prepare('INSERT INTO live_class_batches VALUES (?,?) ON CONFLICT(class_id) DO UPDATE SET batch_id=excluded.batch_id').run(req.params.id,batchId);else await tx.prepare('DELETE FROM live_class_batches WHERE class_id=?').run(req.params.id);await audit(tx,admin.id,'Live session batch updated',req.params.id,batchId);});res.status(204).end();
  }));
  app.post('/api/admin/live-classes/:id/complete',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');await transaction(db,async tx=>{const s=await tx.prepare('SELECT ends_at,status FROM live_classes WHERE id=?').get(req.params.id);if(!s)throw notFound('This session is unavailable.');if(s.status==='cancelled'||Date.parse(String(s.ends_at))>Date.now())throw conflict('Confirm completion after the scheduled session ends.');await tx.prepare('INSERT OR IGNORE INTO class_completion VALUES (?,?,?)').run(req.params.id,now(),admin.id);await audit(tx,admin.id,'Live session confirmed complete',req.params.id,'Mapped modules can now open.');});res.status(204).end();
  }));
}
