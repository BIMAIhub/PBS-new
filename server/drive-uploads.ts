import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database,type WritableDatabase,makeId,now,transaction } from './database.js';
import { audit,saveSetting,setting } from './academy-data.js';
import { graph,seal } from './microsoft.js';
import { badRequest,conflict,field,integer,notFound,RequestError,route } from './http.js';
import { activeCourseAccess } from './access-controls.js';
import { enrollmentBatch,moduleAccess } from './learning-access.js';
import { isMicrosoftVideo } from './video.js';

const part=encodeURIComponent, itemPath=(drive:string,item:string)=>`/drives/${part(drive)}/items/${part(item)}`;
export const driveFolderName=(name:string)=>name.normalize('NFKC').replace(/[\x00-\x1f"*:<>?\/\\|#%]/g,'-').replace(/\.{2,}/g,'-').replace(/^[.\s]+|[.\s]+$/g,'').slice(0,110)||'PBS files';
export function uploadLocation(value:unknown){let u:URL;try{u=new URL(String(value));}catch{throw badRequest('Microsoft returned an invalid upload location.');}if(u.protocol!=='https:'||u.username||u.password||!['1drv.com','sharepoint.com','onedrive.com','microsoftpersonalcontent.com','storage.live.com','storage.msn.com'].some(h=>u.hostname===h||u.hostname.endsWith(`.${h}`)))throw badRequest('Microsoft returned an unsupported upload host.');return u.href;}
export async function folder(db:Database,admin:string,drive:string,parent:string,name:string,request:typeof graph){
  const path=itemPath(drive,parent),safe=driveFolderName(name);
  try{return await request(db,admin,`${path}/children`,{method:'POST',body:JSON.stringify({name:safe,folder:{},'@microsoft.graph.conflictBehavior':'fail'})});}
  catch(e){if(!(e instanceof RequestError)||!/nameAlreadyExists|itemAlreadyExists|409/i.test(e.message))throw e;const result=await request(db,admin,`${path}:/${part(safe)}?$select=id,name,folder,parentReference`);if(!result.folder)throw conflict('A file has the same name as a required assignment folder.');return result;}
}
async function assignmentContext(db:Database,accountId:string,taskId:string){
  const task=await db.prepare('SELECT t.*,c.title AS courseTitle,a.name FROM learning_tasks t JOIN courses c ON c.id=t.course_id JOIN accounts a ON a.id=? WHERE t.id=? AND t.published=1').get(accountId,taskId);
  if(!task||!await activeCourseAccess(db,accountId,String(task.course_id)))throw notFound('This assignment is unavailable.');
  if(task.module_id&&!(await moduleAccess(db,accountId,String(task.module_id))).unlocked)throw new RequestError(403,'This assignment opens with its course module.');
  return{task,batch:await enrollmentBatch(db,accountId,String(task.course_id))};
}
export function mountDriveUploads(app:Express,db:WritableDatabase,request:typeof graph=graph){
  app.get('/api/admin/assignment-storage',route(async(req,res)=>{await requireAccount(db,req,'admin');res.json(JSON.parse(await setting(db,'assignment_storage')||'{"configured":false}'));}));
  app.put('/api/admin/assignment-storage',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin'),url=field(req.body?.url,'OneDrive assignment folder URL',3000);
    if(!isMicrosoftVideo(url))throw badRequest('Paste a OneDrive or SharePoint folder link.');
    const result=await request(db,admin.id,`/shares/u!${Buffer.from(url).toString('base64url')}/driveItem?$select=id,name,folder,webUrl,parentReference`),item=result.remoteItem||result;
    if(!item.folder||!item.parentReference?.driveId||!item.id)throw badRequest('Choose the assignment destination folder, not a file.');
    await saveSetting(db,'assignment_storage',JSON.stringify({configured:true,adminId:admin.id,driveId:item.parentReference.driveId,itemId:item.id,name:item.name,webUrl:item.webUrl||url}));await audit(db,admin.id,'Assignment destination saved','',String(item.name));res.status(204).end();
  }));
  async function initialize(accountId:string,adminId:string,kind:string,courseId:string,batchId:string,moduleId:string,taskId:string,driveId:string,parentId:string,input:any){
    const original=field(input?.filename,'file name',180),extension=/\.([a-z0-9]{1,8})$/i.exec(original)?.[1].toLowerCase();
    const allowed=kind==='video'?['mp4','webm']:['pdf','zip','rvt','rfa','dwg','ifc','nwd','nwc','png','jpg','jpeg','docx','xlsx','pptx','txt','csv','mp4','webm'];
    if(!extension||!allowed.includes(extension))throw badRequest('Choose a supported project, document, image, ZIP or video file.');
    const size=integer(input?.size,'file size',1,kind==='video'?8*1024**3:512*1024**2),id=makeId(),filename=`${id.slice(0,8)}-${driveFolderName(original.replace(/\.[^.]+$/,'')).slice(0,100)}.${extension}`;
    const contentType=kind==='video'?`video/${extension==='mp4'?'mp4':'webm'}`:field(input?.contentType||'application/octet-stream','file type',100);
    const result=await request(db,adminId,`${itemPath(driveId,parentId)}:/${part(filename)}:/createUploadSession`,{method:'POST',body:JSON.stringify({item:{name:filename,'@microsoft.graph.conflictBehavior':'fail'}})});
    const url=uploadLocation(result.uploadUrl),providerExpiry=Date.parse(String(result.expirationDateTime||'')),expiresAt=Number.isFinite(providerExpiry)?Math.min(providerExpiry,Date.now()+86400000):Date.now()+3600000;
    await transaction(db,async tx=>{
      if(kind==='video'&&!await tx.prepare('SELECT 1 FROM modules WHERE id=? AND course_id=?').get(moduleId,courseId))throw notFound('This course module is unavailable.');
      await tx.prepare('INSERT INTO drive_uploads VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,accountId,adminId,kind,courseId,batchId,moduleId,taskId,driveId,parentId,'',filename,size,contentType,seal(url),expiresAt,'',now());
    });
    return{uploadId:id,url,filename,size,expiresAt,chunkSize:10*1024**2};
  }
  app.post('/api/admin/modules/:id/drive-upload',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin'),module=await db.prepare('SELECT course_id,title FROM modules WHERE id=?').get(req.params.id);if(!module)throw notFound('This module is unavailable.');
    const storage=await db.prepare('SELECT * FROM course_storage WHERE course_id=?').get(module.course_id);if(!storage)throw conflict('Link a OneDrive course folder before uploading to OneDrive.');
    const parent=await folder(db,String(storage.admin_id),String(storage.drive_id),String(storage.item_id),String(module.title),request);
    res.json(await initialize(admin.id,String(storage.admin_id),'video',String(module.course_id),'',req.params.id,'',String(storage.drive_id),String(parent.id),req.body));
  }));
  app.post('/api/student/tasks/:id/drive-upload',route(async(req,res)=>{
    const account=await requireAccount(db,req,'student'),{task,batch}=await assignmentContext(db,account.id,req.params.id);
    const root=JSON.parse(await setting(db,'assignment_storage')||'{}');if(!root.configured)throw conflict('PBS needs to choose an assignment upload folder. You may submit a project link instead.');
    let parent=root.itemId;for(const name of [`${task.courseTitle}-${String(task.course_id).slice(-6)}`,String(batch?.name||'Individual enrollment'),`${task.name}-${account.id.slice(-6)}`,`${task.title}-${req.params.id.slice(-6)}`])parent=(await folder(db,root.adminId,root.driveId,parent,name,request)).id;
    res.json(await initialize(account.id,root.adminId,'assignment',String(task.course_id),String(batch?.id||''),'',req.params.id,root.driveId,parent,req.body));
  }));
  app.post('/api/drive-uploads/:id/complete',route(async(req,res)=>{
    const account=await requireAccount(db,req),upload=await db.prepare('SELECT * FROM drive_uploads WHERE id=? AND account_id=?').get(req.params.id,account.id);if(!upload)throw notFound('This upload is unavailable.');
    if(upload.kind==='video'&&account.role!=='admin')throw notFound('This upload is unavailable.');
    if(upload.kind==='assignment')await assignmentContext(db,account.id,String(upload.task_id));
    if(upload.attached_id){res.json({id:upload.attached_id,alreadySaved:true});return;}
    // OneDrive extends session expiry as fragments arrive. A committed file can
    // still be verified after the initial session timestamp has elapsed.
    const providedItem=field(req.body?.itemId,'uploaded item',250,false);
    // Recover a lost final fragment response using only this upload's authorized, unique destination.
    const filePath=providedItem?itemPath(String(upload.drive_id),providedItem):`${itemPath(String(upload.drive_id),String(upload.parent_id))}:/${part(String(upload.filename))}`;
    const item=await request(db,String(upload.admin_id),`${filePath}?$select=id,name,size,file,video,webUrl,parentReference`),itemId=String(item.id||'');
    if(!itemId)throw badRequest('Microsoft did not confirm the uploaded file identity. Retry this upload.');
    if(item.parentReference?.driveId!==upload.drive_id||item.parentReference?.id!==upload.parent_id||item.name!==upload.filename||Number(item.size)!==Number(upload.size)||!item.file||!item.webUrl)throw badRequest('The uploaded file does not match the authorized destination and size.');
    if(upload.kind==='video'&&!item.video&&!String(item.file.mimeType||'').startsWith('video/'))throw badRequest('The uploaded file is not a playable video.');
    const result=await transaction(db,async tx=>{
      const latest=await tx.prepare('SELECT attached_id FROM drive_uploads WHERE id=?').get(upload.id);if(latest?.attached_id)return String(latest.attached_id);
      let id:string=makeId();
      if(upload.kind==='video'){
        if(!await tx.prepare('SELECT 1 FROM modules WHERE id=? AND course_id=?').get(upload.module_id,upload.course_id))throw notFound('This course module is unavailable.');
        const replace=field(req.body?.replaceId,'lesson',80,false);if(replace&&!await tx.prepare('SELECT 1 FROM lessons WHERE id=? AND module_id=?').get(replace,upload.module_id))throw notFound('This lesson is unavailable.');
        const title=field(req.body?.title,'lesson title',160),duration=field(req.body?.duration,'duration',40,false),description=field(req.body?.description,'lesson notes',3000,false);
        if(replace){id=replace;await tx.prepare('UPDATE lessons SET title=?,duration=?,description=?,source_url=?,file_name=?,content_type=? WHERE id=?').run(title,duration,description,item.webUrl,'','',id);await tx.prepare('DELETE FROM completions WHERE lesson_id=?').run(id);await tx.prepare('DELETE FROM lesson_watch_totals WHERE lesson_id=?').run(id);}
        else await tx.prepare('INSERT INTO lessons SELECT ?,?,?,?,?,?,?,?,COALESCE(MAX(position),0)+1 FROM lessons WHERE module_id=?').run(id,upload.module_id,title,duration,description,item.webUrl,'','',upload.module_id);
        await tx.prepare('INSERT INTO lesson_video_owners VALUES (?,?) ON CONFLICT(lesson_id) DO UPDATE SET admin_id=excluded.admin_id').run(id,upload.admin_id);
      }else{
        await assignmentContext(tx,account.id,String(upload.task_id));
        await tx.prepare('INSERT INTO assignment_drive_files VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,upload.id,account.id,upload.task_id,upload.course_id,upload.batch_id,upload.drive_id,itemId,item.webUrl,upload.filename,upload.size,now());
        await tx.prepare(`INSERT INTO task_submissions (id,task_id,account_id,url,note,submitted_at) VALUES (?,?,?,?,?,?) ON CONFLICT(task_id,account_id) DO UPDATE SET url=excluded.url,note=excluded.note,submitted_at=excluded.submitted_at,feedback='',reviewed_at=''`).run(makeId(),upload.task_id,account.id,item.webUrl,field(req.body?.note,'assignment note',2000,false),now());
        const admins=await tx.prepare("SELECT id FROM accounts WHERE role='admin'").all();for(const admin of admins)await tx.prepare("INSERT INTO notifications (id,account_id,title,body,kind,page,created_at) VALUES (?,?,?,?,'assignment','curriculum',?)").run(makeId(),admin.id,'Assignment ready to review',`${account.name} submitted ${upload.filename}.`,now());
      }
      await tx.prepare('UPDATE drive_uploads SET item_id=?,attached_id=?,upload_url=? WHERE id=?').run(itemId,id,'',upload.id);await audit(tx,account.id,upload.kind==='video'?'Video saved in OneDrive':'Assignment file submitted',id,String(upload.filename));return id;
    });res.json({id:result});
  }));
  app.get('/api/student/tasks/:id/files',route(async(req,res)=>{const a=await requireAccount(db,req,'student');await assignmentContext(db,a.id,req.params.id);res.json({files:await db.prepare('SELECT id,filename,size,created_at AS createdAt FROM assignment_drive_files WHERE account_id=? AND task_id=? ORDER BY created_at DESC').all(a.id,req.params.id)});}));
  app.get('/api/admin/tasks/:id/files',route(async(req,res)=>{await requireAccount(db,req,'admin');res.json({files:await db.prepare('SELECT f.id,f.filename,f.size,f.web_url AS webUrl,f.created_at AS createdAt,a.name AS studentName,b.name AS batchName FROM assignment_drive_files f JOIN accounts a ON a.id=f.account_id LEFT JOIN course_batches b ON b.id=f.batch_id WHERE f.task_id=? ORDER BY f.created_at DESC').all(req.params.id)});}));
}
