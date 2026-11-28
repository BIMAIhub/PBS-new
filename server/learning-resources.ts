import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, now, transaction } from './database.js';
import { audit } from './academy-data.js';
import { hasCourseAccess } from './records.js';
import { moduleAccess } from './learning-access.js';
import { badRequest, conflict, field, notFound, route } from './http.js';
import { httpsLink } from './inputs.js';
import { fileDownloadLocation, learningFileExtensions } from './learning-files.js';
import type { Account } from '../src/live/types.js';
import type { LearningResource } from '../src/live/education-types.js';

export async function educationScope(db: Database, body: Record<string, unknown>) {
  const courseId=field(body.courseId,'course',80), scope=field(body.scope,'resource scope',20);
  if (!await db.prepare('SELECT 1 FROM courses WHERE id=?').get(courseId)) throw notFound('This course is unavailable.');
  if (!['course','module','lesson'].includes(scope)) throw badRequest('Choose course, module or video.');
  let moduleId: string|null=null, lessonId: string|null=null;
  if (scope==='module') {
    moduleId=field(body.moduleId,'module',80);
    if (!await db.prepare('SELECT 1 FROM modules WHERE id=? AND course_id=?').get(moduleId,courseId)) throw badRequest('Choose a module in this course.');
  }
  if (scope==='lesson') {
    lessonId=field(body.lessonId,'video',80);
    const lesson=await db.prepare('SELECT m.id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.id=? AND m.course_id=?').get(lessonId,courseId);
    if (!lesson) throw badRequest('Choose a video in this course.'); moduleId=String(lesson.id);
  }
  return {courseId,scope:scope as LearningResource['scope'],moduleId,lessonId};
}
export async function educationAccess(db: Database, account: Pick<Account,'id'|'role'>, row: {courseId:string;scope:string;moduleId:string|null;lessonId:string|null}) {
  if (account.role==='admin') return {available:true,reason:''};
  if (!await hasCourseAccess(db,account,row.courseId)) return {available:false,reason:'Approved, active course access is required.'};
  if (row.scope==='course') return {available:true,reason:''};
  if (row.scope==='module'&&!row.moduleId || row.scope==='lesson'&&!row.lessonId) return {available:false,reason:'This module or video has been removed.'};
  let moduleId=row.moduleId;
  if(row.scope==='lesson'){
    const lesson=await db.prepare('SELECT l.module_id,m.course_id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.id=?').get(row.lessonId);
    if(!lesson||lesson.course_id!==row.courseId)return {available:false,reason:'This video is no longer part of the course.'};moduleId=String(lesson.module_id);
  }else if(!await db.prepare('SELECT 1 FROM modules WHERE id=? AND course_id=?').get(moduleId,row.courseId))return {available:false,reason:'This module is no longer part of the course.'};
  const access=await moduleAccess(db,account.id,moduleId);
  return {available:access.unlocked,reason:access.reason};
}
export async function learningResources(db: Database, account: Pick<Account,'id'|'role'>, courseId='') {
  const admin=account.role==='admin';
  const rows=await db.prepare(`SELECT r.id,r.course_id AS courseId,c.title AS courseTitle,r.scope,CASE WHEN r.scope='lesson' THEN l.module_id ELSE r.module_id END AS moduleId,r.lesson_id AS lessonId,
    m.title AS moduleTitle,l.title AS lessonTitle,r.title,r.description,r.kind,r.file_id AS fileId,
    COALESCE(f.original_name,'Linked file') AS filename,COALESCE(f.size,0) AS size,r.url,r.published,r.revision
    FROM learning_resources r JOIN courses c ON c.id=r.course_id LEFT JOIN lessons l ON l.id=r.lesson_id
    LEFT JOIN modules m ON m.id=CASE WHEN r.scope='lesson' THEN l.module_id ELSE r.module_id END LEFT JOIN academy_files f ON f.id=r.file_id
    WHERE 1=1 ${courseId?'AND r.course_id=?':''} ${admin?'':'AND r.published=1'} ORDER BY r.created_at DESC`).all(...(courseId?[courseId]:[]));
  const result:LearningResource[]=[];
  for (const raw of rows) {
    const row=raw as unknown as LearningResource, access=await educationAccess(db,account,row);
    if (!admin && !access.available) continue;
    result.push({...row,published:Boolean(row.published),size:Number(row.size),available:access.available,url:admin?String(row.url):undefined,downloadUrl:`/api/learning-resources/${row.id}/download`});
  }
  return result;
}
export async function validateResourceIds(db:Database, input:unknown, courseId:string) {
  if (!Array.isArray(input)||input.length>20||input.some(id=>typeof id!=='string')) throw badRequest('Choose up to 20 course resources.');
  const ids=[...new Set(input as string[])];
  for (const id of ids) if (!await db.prepare('SELECT 1 FROM learning_resources WHERE id=? AND course_id=?').get(id,courseId)) throw badRequest('An attachment is not part of this course.');
  return ids;
}
export function mountLearningResources(app:Express,db:WritableDatabase) {
  app.get('/api/admin/learning-resources',route(async(req,res)=>{const admin=await requireAccount(db,req,'admin');res.json({resources:await learningResources(db,admin,String(req.query.courseId||''))});}));
  app.get('/api/student/learning-resources',route(async(req,res)=>{const account=await requireAccount(db,req,'student');res.json({resources:await learningResources(db,account,String(req.query.courseId||''))});}));
  app.post('/api/admin/learning-resources',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin'), scope=await educationScope(db,req.body||{}), id=field(req.body?.id,'resource ID',80,false)||makeId();
    const title=field(req.body?.title,'resource title',180),description=field(req.body?.description,'resource description',2500,false),kind=field(req.body?.kind,'resource type',20);
    if (!['model','document','reference'].includes(kind)) throw badRequest('Choose a model, document or reference.');
    const fileId=field(req.body?.fileId,'uploaded file',80,false),url=fileId?'':httpsLink(req.body?.url,'download link');
    if (fileId) {
      if (!await db.prepare("SELECT 1 FROM academy_files WHERE id=? AND kind='resource' AND course_id=? AND completed_at<>''").get(fileId,scope.courseId)) throw badRequest('Upload a practice file to this course first.');
    } else {
      const extension=new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
      if (!extension||!learningFileExtensions.includes(extension)) throw badRequest('Use a direct file download link (PDF, ZIP, Revit/model or document), or upload the file to OneDrive.');
    }
    await transaction(db,async tx=>{
      const existing=await tx.prepare('SELECT revision,course_id FROM learning_resources WHERE id=?').get(id);
      if(existing&&existing.course_id!==scope.courseId)throw badRequest('Keep a resource in its original course so assignment attachments remain valid.');
      if (existing&&existing.revision!==req.body?.revision) throw conflict('This resource changed. Refresh before saving.');
      await tx.prepare(`INSERT INTO learning_resources(id,course_id,scope,module_id,lesson_id,title,description,kind,file_id,url,published,revision,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id,scope=excluded.scope,module_id=excluded.module_id,lesson_id=excluded.lesson_id,
        title=excluded.title,description=excluded.description,kind=excluded.kind,file_id=excluded.file_id,url=excluded.url,published=excluded.published,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(id,scope.courseId,scope.scope,scope.moduleId,scope.lessonId,title,description,kind,fileId||null,url,Number(req.body?.published===true),makeId(),now(),now());
      await audit(tx,admin.id,'Practice resource saved',id,title);
    });res.status(201).json({id});
  }));
  app.delete('/api/admin/learning-resources/:id',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');
    await transaction(db,async tx=>{
      const row=await tx.prepare('SELECT revision,title FROM learning_resources WHERE id=?').get(req.params.id);
      if (!row) throw notFound('This resource is unavailable.');
      if (row.revision!==req.body?.revision) throw conflict('This resource changed. Refresh before removing it.');
      await tx.prepare('DELETE FROM learning_resources WHERE id=?').run(req.params.id);await audit(tx,admin.id,'Practice resource removed',req.params.id,String(row.title));
    });res.status(204).end();
  }));
  app.get('/api/learning-resources/:id/download',route(async(req,res)=>{
    const account=await requireAccount(db,req), resources=await learningResources(db,account),resource=resources.find(row=>row.id===req.params.id);
    if (!resource) throw notFound('This resource is unavailable or its module is locked.');
    let url=resource.url;
    if (resource.fileId) url=(await fileDownloadLocation(db,resource.fileId)).url;
    else if (!url) url=String((await db.prepare('SELECT url FROM learning_resources WHERE id=?').get(resource.id))?.url||'');
    if (!url) throw notFound('Ask PBS to reconnect this practice file.');res.redirect(302,url);
  }));
}
