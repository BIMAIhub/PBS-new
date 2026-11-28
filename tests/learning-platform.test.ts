import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { signInApproved } from './admission-fixtures.js';

test('batch learning, Microsoft roles, OneDrive assignments, bank payouts and reviewed reset',async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pbs-learning-'));
  for(const key of ['VERCEL','PBS_TURSO_DATABASE_URL','PBS_TURSO_AUTH_TOKEN','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','PBS_PUBLIC_ORIGIN','BLOB_STORE_ID','BLOB_READ_WRITE_TOKEN','CRON_SECRET'])delete process.env[key];
  process.env.PBS_DATA_DIR=directory;process.env.PBS_BOOTSTRAP_CATALOG='0';process.env.PBS_BOOTSTRAP_ADMIN_EMAIL='learning-admin@example.invalid';process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD='Learning-bootstrap-184!';process.env.PBS_INTEGRATION_KEY='c'.repeat(64);
  const password='Learning-isolated-password-284!';
  const {createPortalApp}=await import('../server/app.js'),{transaction}=await import('../server/database.js'),{recordWatchHeartbeat}=await import('../server/learning-progress.js'),{grantCourseAccess}=await import('../server/microsoft.js'),{videoSourceKey}=await import('../server/video.js');
  const graphCalls:{path:string;body:any}[]=[];const items=new Map<string,any>();let folderCounter=0;
  const provider:any=async(_db:any,_admin:string,url:string,init?:RequestInit)=>{
    const body=init?.body?JSON.parse(String(init.body)):undefined;graphCalls.push({path:url,body});
    if(url.startsWith('/shares/'))return{id:'assignment-root',name:'Assignments',folder:{},webUrl:'https://onedrive.live.com/assignments',parentReference:{driveId:'qa-drive'}};
    if(url.endsWith('/children'))return{id:`folder-${++folderCounter}`,name:body.name,folder:{},parentReference:{driveId:'qa-drive'}};
    if(url.endsWith('/createUploadSession'))return{uploadUrl:'https://qa.up.1drv.com/upload/isolated',expirationDateTime:new Date(Date.now()+3600000).toISOString()};
    if(url.includes(':/')){const name=decodeURIComponent(url.split(':/').pop()!.split('?')[0]);const found=[...items.values()].find(item=>item.name===name);if(found)return found;}
    const id=/\/items\/([^?]+)/.exec(url)?.[1];if(id&&items.has(id))return items.get(id);
    throw new Error(`Unexpected isolated provider path: ${url}`);
  };
  const app=await createPortalApp(false,{microsoftGraph:provider}),db=app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address(),origin=`http://127.0.0.1:${typeof address==='object'?address!.port:0}`;
  type Client={cookie:string};const admin:Client={cookie:''},student:Client={cookie:''},other:Client={cookie:''},visitor:Client={cookie:''};
  async function req(client:Client,url:string,body?:any,method=body===undefined?'GET':'POST',expected=200){const response=await fetch(origin+'/api'+url,{method,headers:{'X-PBS-Request':'1',...(client.cookie?{Cookie:client.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(response.headers.get('set-cookie'))client.cookie=response.headers.get('set-cookie')!.split(';')[0];const text=await response.text();assert.equal(response.status,expected,`${method} ${url}: ${text.slice(0,350)}`);return text&&response.headers.get('content-type')?.includes('json')?JSON.parse(text):text;}
  let adminId='',courseId='',module1='',module2='',lesson1='',lesson2='',batchA='',batchB='',first:any,second:any,ended='',liveA='',taskId='',watchId='',key='',bankRevision='',payout='',pendingPayout='',preservedAdmin:any;
  try{
    await t.test('setup preserves a deliberately changed administrator identity',async()=>{
      adminId=(await req(admin,'/auth/login',{identifier:process.env.PBS_BOOTSTRAP_ADMIN_EMAIL,password:process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD,role:'admin'})).account.id;
      await req(admin,'/auth/password',{current:process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD,next:password});
      await req(admin,'/admin/profile',{name:'Current PBS administrator',email:'changed-last-night@example.invalid',current:password},'PATCH');
      preservedAdmin=await db.prepare('SELECT id,name,email,password_hash,must_change FROM accounts WHERE id=?').get(adminId);
      courseId=(await req(admin,'/admin/courses',{title:'Isolated BIM cohort',category:'QA',fee:200000,published:true},'POST',201)).course.id;
      module1=(await req(admin,`/admin/courses/${courseId}/modules`,{title:'Basic BIM workflow'},'POST',201)).id;module2=(await req(admin,`/admin/courses/${courseId}/modules`,{title:'MEP coordination'},'POST',201)).id;
      lesson1=(await req(admin,`/admin/courses/${courseId}/modules/${module1}/lessons`,{title:'Workflow recording',duration:'10 min',url:'https://example.org/workflow.mp4'},'POST',201)).id;
      lesson2=(await req(admin,`/admin/courses/${courseId}/modules/${module2}/lessons`,{title:'Coordination recording',duration:'10 min',url:'https://example.org/coordination.mp4'},'POST',201)).id;
      const input={courseId,name:'Batch-02-Nov26',startsAt:new Date(Date.now()+86400000).toISOString(),deadline:new Date(Date.now()+43200000).toISOString(),capacity:1,status:'open'};
      batchA=(await req(admin,'/admin/batches',input)).id;batchB=(await req(admin,'/admin/batches',{...input,name:'Batch-03-Nov26',capacity:2})).id;
    });
    await t.test('capacity is reserved transactionally and missing batches cannot bypass deadlines',async()=>{
      await req(visitor,'/enrollments',{courseId,name:'No batch QA',email:'no-batch@example.invalid',phone:'9890000000',amount:0},'POST',409);
      assert.equal(await db.prepare('SELECT 1 FROM accounts WHERE email=?').get('no-batch@example.invalid'),undefined);
      const results=await Promise.all([1,2].map(async n=>{const response=await fetch(origin+'/api/enrollments',{method:'POST',headers:{'X-PBS-Request':'1','Content-Type':'application/json'},body:JSON.stringify({courseId,batchId:batchA,name:`QA applicant ${n}`,email:`batch-applicant-${n}@example.invalid`,phone:`989000000${n}`,amount:0})});return{status:response.status,data:await response.json()};}));
      assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);first=results.find(r=>r.status===201)!.data;
      const publicData=await req(visitor,`/catalog/${courseId}/batches`);assert.equal(publicData.batches.find((b:any)=>b.id===batchA).remaining,0);assert.equal(publicData.batches.find((b:any)=>b.id===batchA).enrolled,0);
      const approval=await req(admin,`/admin/enrollments/${first.enrollment.id}/decision`,{decision:'approved'});await signInApproved(req,student,approval,password);
      second=await req(admin,'/admin/students',{name:'Other batch QA',email:'other-batch@example.invalid',phone:'9890000003',courseId,batchId:batchB,total:200000,amount:0},'POST',201);await signInApproved(req,other,second,password);
      const batch=publicData.batches.find((b:any)=>b.id===batchB);await req(admin,`/admin/batches/${batchB}`,{...batch,status:'closed',capacity:2},'PUT');
      await req(visitor,'/enrollments',{courseId,batchId:batchB,name:'Closed batch QA',email:'closed-batch@example.invalid',phone:'9890000004',amount:0},'POST',409);
    });
    await t.test('live sessions and server-protected module releases follow the assigned batch',async()=>{
      const classInput={courseId,title:'Batch A basic workflow',startsAt:new Date(Date.now()-3600000).toISOString(),endsAt:new Date(Date.now()-60000).toISOString(),meetUrl:'https://meet.google.com/abc-defg-hij',published:true,accessConfirmed:true};
      ended=(await req(admin,'/admin/live-classes',classInput,'POST',201)).id;
      liveA=(await req(admin,'/admin/live-classes',{...classInput,title:'Current live workflow',startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()},'POST',201)).id;
      for(const id of [ended,liveA])await req(admin,`/admin/live-classes/${id}/batch`,{batchId:batchA},'PUT',204);
      await req(other,`/live-classes/${liveA}/join`,{},'POST',404);await req(student,`/live-classes/${liveA}/join`,{});
      assert.equal((await req(other,'/student/live-classes')).classes.length,0);
      await req(admin,`/admin/modules/${module1}/release`,{batchId:'',mode:'manual',released:false},'PUT',204);
      await req(admin,`/admin/modules/${module1}/release`,{batchId:batchA,mode:'session',classId:ended,released:false},'PUT',204);
      await req(admin,`/admin/modules/${module2}/release`,{batchId:'',mode:'manual',released:false},'PUT',204);
      await req(student,`/lessons/${lesson1}/playback-status`,undefined,'GET',403);
      const workspace=await req(student,'/student/workspace');assert.equal(workspace.courses[0].modules[0].lessons[0].playback.url,'');
      await req(admin,`/admin/live-classes/${liveA}/complete`,{},'POST',409);
      await req(admin,`/admin/live-classes/${ended}/complete`,{},'POST',204);
      await req(student,`/lessons/${lesson1}/playback-status`);await req(other,`/lessons/${lesson1}/playback-status`,undefined,'GET',403);await req(student,`/lessons/${lesson2}/video`,undefined,'GET',403);
      let shared=false;const result=await grantCourseAccess(db,first.enrollment.id,adminId,false,async()=>{shared=true;return{};});assert.equal(result.status,'portal_only');assert.equal(shared,false);
    });
    await t.test('watching counts unique sections, rejects fast-forward credit and completes automatically at 80 percent',async()=>{
      await req(student,`/student/lessons/${lesson1}/completion`,{completed:true},'POST',409);
      key=videoSourceKey('https://example.org/workflow.mp4','');watchId=(await req(student,`/student/lessons/${lesson1}/watch`,{mediaKey:key,duration:600,position:0})).id;
      const row=await db.prepare('SELECT seen_at FROM lesson_watch_sessions WHERE id=?').get(watchId);let clock=Number(row!.seen_at),seq=0,position=0;
      const beat=async(to:number,seek=false,seconds=10)=>{clock+=seconds*1000;const result=await transaction(db,tx=>recordWatchHeartbeat(tx,first.account.id,watchId,{from:position,to,seek,rate:1,sequence:++seq},clock));position=to;return result;};
      for(let n=1;n<=10;n++)await beat(n*10);
      assert.equal((await beat(500,true,0)).watched,100);
      for(let n=51;n<=60;n++)await beat(n*10);
      assert.equal((await beat(0,true,0)).watched,200);
      for(let n=1;n<=10;n++)await beat(n*10);
      assert.equal((await beat(100,true,0)).watched,200);
      for(let n=11;n<=38;n++)await beat(n*10);
      const progress=await db.prepare('SELECT watched FROM lesson_watch_totals WHERE account_id=? AND lesson_id=?').get(first.account.id,lesson1);assert.equal(progress!.watched,480);
      assert.ok(await db.prepare('SELECT 1 FROM completions WHERE account_id=? AND lesson_id=?').get(first.account.id,lesson1));
      await req(student,`/student/lessons/${lesson1}/completion`,{completed:true},'POST',204);
      const duplicate=await transaction(db,tx=>recordWatchHeartbeat(tx,first.account.id,watchId,{from:position,to:position,rate:1,sequence:seq},clock));assert.equal(duplicate.watched,480);
      await assert.rejects(()=>transaction(db,tx=>recordWatchHeartbeat(tx,second.student.id,watchId,{from:0,to:1,rate:1,sequence:1},clock)),/unavailable/);
      const before=480;await beat(590,false,.1);assert.equal((await db.prepare('SELECT watched FROM lesson_watch_totals WHERE account_id=? AND lesson_id=?').get(first.account.id,lesson1))!.watched,before);
    });
    await t.test('Microsoft apps, scopes, account replacement and clearing are independent for storage and mail',async()=>{
      const storage={purpose:'storage',clientId:'11111111-1111-4111-8111-111111111111',tenant:'common',secret:'isolated-storage-secret',current:password};
      await req(admin,'/admin/integrations/microsoft/config',storage,'PUT',204);
      await db.prepare('INSERT INTO microsoft_connections VALUES (?,?,?,?,?)').run(adminId,'storage-owner@example.invalid','QA storage','opaque-cache',new Date().toISOString());
      await req(admin,'/admin/integrations/microsoft/config',{...storage,purpose:'mail',clientId:'22222222-2222-4222-8222-222222222222',secret:'isolated-mail-secret'},'PUT',204);
      await db.prepare('INSERT INTO microsoft_mail_connections VALUES (?,?,?,?,?)').run(adminId,'info@example.invalid','QA mail','opaque-mail-cache',new Date().toISOString());
      const status=await req(admin,'/admin/integrations/microsoft');assert.equal(status.connected.email,'storage-owner@example.invalid');assert.equal(status.mail.connected.email,'info@example.invalid');assert.ok(!JSON.stringify(status).includes('isolated-storage-secret'));
      const mailAuth=new URL((await req(admin,'/admin/integrations/microsoft/connect',{purpose:'mail'})).url),driveAuth=new URL((await req(admin,'/admin/integrations/microsoft/connect',{purpose:'storage'})).url);
      assert.match(mailAuth.searchParams.get('scope')||'',/Mail.Send/);assert.ok(!(mailAuth.searchParams.get('scope')||'').includes('Files.ReadWrite'));assert.match(driveAuth.searchParams.get('scope')||'',/Files.ReadWrite/);assert.ok(!(driveAuth.searchParams.get('scope')||'').includes('Mail.Send'));
      await req(admin,'/admin/integrations/microsoft/reset',{purpose:'mail',current:'wrong'},'POST',400);
      await req(admin,'/admin/integrations/microsoft/reset',{purpose:'mail',current:password},'POST',204);
      const cleared=await req(admin,'/admin/integrations/microsoft');assert.equal(cleared.mail.clientId,'');assert.equal(cleared.mail.configured,false);assert.equal(cleared.connected.email,'storage-owner@example.invalid');assert.equal(cleared.clientId,storage.clientId);
    });
    await t.test('assignment uploads create the course/batch/student/task path, validate ownership and notify reviewers once',async()=>{
      taskId=(await req(admin,'/admin/tasks',{courseId,moduleId:module2,title:'Coordination model assignment',brief:'Submit the coordinated model.',published:true})).id;
      await req(student,`/student/tasks/${taskId}/drive-upload`,{filename:'qa-model.rvt',size:1024,contentType:'application/octet-stream'},'POST',403);
      const rules=(await req(admin,`/admin/courses/${courseId}/releases`)).rules;const rule=rules.find((r:any)=>r.moduleId===module2&&r.batchId==='');await req(admin,`/admin/modules/${module2}/release`,{...rule,mode:'manual',released:true},'PUT',204);
      await req(admin,'/admin/assignment-storage',{url:'https://onedrive.live.com/?id=qa-root'},'PUT',204);
      const init=await req(student,`/student/tasks/${taskId}/drive-upload`,{filename:'qa-model.rvt',size:1024,contentType:'application/octet-stream'});
      assert.match(init.url,/^https:\/\/qa.up.1drv.com/);const upload=await db.prepare('SELECT * FROM drive_uploads WHERE id=?').get(init.uploadId);assert.ok(!String(upload!.upload_url).includes('https://'));
      const names=graphCalls.filter(c=>c.path.endsWith('/children')).map(c=>c.body.name);assert.ok(names.some(n=>n==='Batch-02-Nov26'));assert.ok(names.some(n=>n.includes('Coordination model assignment')));
      items.set('assignment-item',{id:'assignment-item',name:upload!.filename,size:1024,file:{mimeType:'application/octet-stream'},webUrl:'https://onedrive.live.com/qa-assignment',parentReference:{driveId:'qa-drive',id:'wrong-parent'}});
      await req(student,`/drive-uploads/${init.uploadId}/complete`,{itemId:'assignment-item',note:'QA submission'},'POST',400);await req(other,`/drive-uploads/${init.uploadId}/complete`,{itemId:'assignment-item'},'POST',404);
      items.get('assignment-item').parentReference.id=upload!.parent_id;
      const saved=await req(student,`/drive-uploads/${init.uploadId}/complete`,{itemId:'assignment-item',note:'QA submission'});const again=await req(student,`/drive-uploads/${init.uploadId}/complete`,{itemId:'assignment-item'});assert.equal(saved.id,again.id);
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM assignment_drive_files').get())!.n,1);
      assert.equal((await req(admin,`/admin/tasks/${taskId}/files`)).files[0].batchName,'Batch-02-Nov26');assert.ok((await req(admin,'/notifications')).items.some((n:any)=>n.title==='Assignment ready to review'));
    });
    await t.test('video uploads are saved in the mapped OneDrive folder and attached idempotently as native lessons',async()=>{
      await db.prepare('INSERT INTO course_storage VALUES (?,?,?,?,?,?,?)').run(courseId,adminId,'qa-drive','course-root','QA course videos','https://onedrive.live.com/qa-course',1);
      await req(student,`/admin/modules/${module2}/drive-upload`,{filename:'qa.mp4',size:2048},'POST',403);
      const init=await req(admin,`/admin/modules/${module2}/drive-upload`,{filename:'qa.mp4',size:2048}),row=await db.prepare('SELECT * FROM drive_uploads WHERE id=?').get(init.uploadId);
      items.set('video-item',{id:'video-item',name:row!.filename,size:2048,file:{mimeType:'video/mp4'},video:{duration:600000},webUrl:'https://onedrive.live.com/?id=qa-video',parentReference:{driveId:'qa-drive',id:row!.parent_id}});
      const details={itemId:'video-item',title:'OneDrive uploaded video',duration:'10 min',description:'QA upload'};const firstSave=await req(admin,`/drive-uploads/${init.uploadId}/complete`,details);assert.equal((await req(admin,`/drive-uploads/${init.uploadId}/complete`,details)).id,firstSave.id);
      const lesson=(await req(student,'/student/workspace')).courses[0].modules.find((m:any)=>m.id===module2).lessons.find((l:any)=>l.id===firstSave.id);assert.equal(lesson.playback.provider,'microsoft');assert.match(lesson.playback.url,/^\/api\/lessons\//);
    });
    await t.test('a lost final upload response recovers only the authorized file and preserves long video extensions',async()=>{
      const init=await req(admin,`/admin/modules/${module2}/drive-upload`,{filename:'Long lesson '+ 'x'.repeat(140)+'.mp4',size:2048}),row=await db.prepare('SELECT * FROM drive_uploads WHERE id=?').get(init.uploadId);
      assert.ok(String(row!.filename).endsWith('.mp4'));assert.ok(String(row!.filename).length<130);
      items.set('recovered-video',{id:'recovered-video',name:row!.filename,size:2048,file:{mimeType:'video/mp4'},video:{duration:600000},webUrl:'https://onedrive.live.com/?id=recovered-video',parentReference:{driveId:'qa-drive',id:row!.parent_id}});
      await db.prepare('UPDATE drive_uploads SET expires_at=? WHERE id=?').run(Date.now()-1,init.uploadId);
      const result=await req(admin,`/drive-uploads/${init.uploadId}/complete`,{title:'Recovered lesson',description:'',duration:''});
      assert.equal((await req(admin,`/drive-uploads/${init.uploadId}/complete`,{title:'Recovered lesson'})).id,result.id);
    });
    await t.test('local background file upload retries attach one lesson per owned upload session',async()=>{
      const route=`/admin/courses/${courseId}/modules/${module2}/lessons`,payload=Buffer.alloc(32);payload.write('ftyp',4,'ascii');
      const session=await req(admin,route+'/upload',{contentType:'video/mp4',size:payload.length});assert.equal(session.storage,'local');
      const post=async()=>{const response=await fetch(origin+'/api'+route+'/file?'+new URLSearchParams({title:'Idempotent local lesson',duration:'',description:'',uploadId:session.uploadId}),{method:'POST',headers:{'X-PBS-Request':'1','Content-Type':'video/mp4',Cookie:admin.cookie},body:payload});assert.ok([200,201].includes(response.status),await response.clone().text());return response.json();};
      const [a,b]=await Promise.all([post(),post()]);assert.equal(a.id,b.id);assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE title='Idempotent local lesson'").get())!.n,1);
    });
    await t.test('news and notices respect publication time and course/batch audiences',async()=>{
      await req(admin,'/admin/notices',{title:'Batch A project notice',body:'Prepare your model review.',kind:'notice',courseId,batchId:batchA,published:true,startsAt:new Date(Date.now()-1000).toISOString()});
      await req(admin,'/admin/notices',{title:'Tomorrow academy news',body:'Scheduled later.',kind:'news',published:true,startsAt:new Date(Date.now()+86400000).toISOString()});
      assert.equal((await req(student,'/student/notices')).notices.length,1);assert.equal((await req(other,'/student/notices')).notices.length,0);assert.ok((await req(student,'/notifications')).items.some((n:any)=>n.kind==='notice'));
      await req(student,'/admin/notices',undefined,'GET',403);assert.equal((await req(student,'/student/journey')).batches[0].name,'Batch-02-Nov26');
    });
    await t.test('bank details stay encrypted, payout reservations cannot overspend, and paid transfers cannot be paid twice',async()=>{
      await db.prepare("INSERT INTO referral_wallet (id,account_id,amount,kind,note,request_key,created_at) VALUES ('qa-earned',?,100000,'referral','Isolated earned reward fixture','qa-earned',?)").run(first.account.id,new Date().toISOString());
      await req(student,'/student/referral-bank',{holder:'QA account holder',bank:'QA bank',account:'123456789012',ifsc:'TEST0123456',upi:'',revision:''},'PUT',204);
      const bank=(await req(student,'/student/referral-payouts')).bank;bankRevision=bank.revision;assert.equal(bank.account,'•••• 9012');assert.equal((await req(other,'/student/referral-payouts')).bank,null);
      assert.ok(!String((await db.prepare('SELECT sealed_details FROM referral_bank_details WHERE account_id=?').get(first.account.id))!.sealed_details).includes('123456789012'));
      let program=(await req(admin,'/admin/referrals')).program;
      program=await req(admin,'/admin/referral-program',{...program,bankPayoutsEnabled:false},'PUT');
      assert.equal((await req(student,'/student/referral-payouts')).payoutsEnabled,false);
      await req(student,'/student/referral-payouts',{amount:70000,requestKey:'paused-payout'},'POST',409);
      await req(admin,'/admin/referral-program',{...program,bankPayoutsEnabled:true},'PUT');
      const results=await Promise.all(['pay-a','pay-b'].map(async requestKey=>{const response=await fetch(origin+'/api/student/referral-payouts',{method:'POST',headers:{'X-PBS-Request':'1','Content-Type':'application/json',Cookie:student.cookie},body:JSON.stringify({amount:70000,requestKey})});return{status:response.status,data:await response.json(),requestKey};}));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const successful=results.find(r=>r.status===200)!;payout=successful.data.id;
      assert.equal((await req(student,'/student/referral-payouts',{amount:70000,requestKey:successful.requestKey})).id,payout);
      await req(admin,`/admin/referral-payouts/${payout}/bank`,{current:'wrong'},'POST',400);assert.equal((await req(admin,`/admin/referral-payouts/${payout}/bank`,{current:password})).account,'123456789012');
      await req(student,'/student/referral-bank',{holder:'Updated QA holder',bank:'QA bank',account:'999999999999',ifsc:'TEST0123456',upi:'',revision:bankRevision},'PUT',204);assert.equal((await req(admin,`/admin/referral-payouts/${payout}/bank`,{current:password})).account,'123456789012');
      await req(admin,`/admin/referral-payouts/${payout}/decision`,{status:'paid',reference:'QA-BANK-PAID',current:password},'POST',400);
      const paid=await req(admin,`/admin/referral-payouts/${payout}/decision`,{status:'paid',reference:'QA-BANK-PAID',current:password,transferConfirmed:true});assert.equal(paid.emailQueued,false);
      await req(admin,`/admin/referral-payouts/${payout}/decision`,{status:'paid',reference:'QA-BANK-PAID',current:password,transferConfirmed:true});await req(admin,`/admin/referral-payouts/${payout}/decision`,{status:'rejected',current:password},'POST',409);
      assert.equal((await req(student,'/student/referral-payouts')).balance,30000);pendingPayout=(await req(student,'/student/referral-payouts',{amount:10000,requestKey:'qa-pending-reset'})).id;
    });
    await t.test('failed private CV cleanup remains queued and can be retried without retaining a student identity',async()=>{
      const {cleanupPrivateFiles}=await import('../server/private-files.js');
      const location='pbs/cv/isolated-cleanup.pdf';await db.prepare('INSERT INTO private_file_cleanup(location,created_at) VALUES (?,?)').run(location,new Date().toISOString());
      assert.deepEqual(await cleanupPrivateFiles(db,async()=>{throw new Error('Isolated storage outage');}),{removed:0,pending:1});
      assert.equal((await db.prepare('SELECT attempts FROM private_file_cleanup WHERE location=?').get(location))!.attempts,1);
      assert.deepEqual(await cleanupPrivateFiles(db,async key=>{assert.equal(key,location);}),{removed:1,pending:0});
    });
    await t.test('reviewed reset rejects stale confirmation and pending payouts, then preserves current admin credentials',async()=>{
      let preview=await req(admin,'/admin/reset-preview');assert.equal(preview.students,2);await req(student,'/admin/reset-preview',undefined,'GET',403);
      await req(admin,'/admin/reset-students',{reviewToken:preview.reviewToken,current:password,confirmation:'WRONG'},'POST',400);await req(admin,'/admin/reset-students',{reviewToken:preview.reviewToken,current:'wrong',confirmation:'DELETE STUDENT DATA'},'POST',400);
      await req(admin,'/admin/reset-students',{reviewToken:'stale',current:password,confirmation:'DELETE STUDENT DATA'},'POST',409);
      const realNow=Date.now;Date.now=()=>realNow()+61000;
      try{await req(admin,'/admin/reset-students',{reviewToken:preview.reviewToken,current:password,confirmation:'DELETE STUDENT DATA'},'POST',409);}finally{Date.now=realNow;}
      await req(admin,`/admin/referral-payouts/${pendingPayout}/decision`,{status:'rejected',note:'Isolated reset test',current:password});
      preview=await req(admin,'/admin/reset-preview');const reset=await req(admin,'/admin/reset-students',{reviewToken:preview.reviewToken,current:password,confirmation:'DELETE STUDENT DATA'});assert.equal(reset.removed,2);
      assert.deepEqual(await db.prepare('SELECT id,name,email,password_hash,must_change FROM accounts WHERE id=?').get(adminId),preservedAdmin);
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role='student'").get())!.n,0);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM courses').get())!.n,1);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM course_batches').get())!.n,2);
      assert.equal((await req(admin,'/admin/integrations/microsoft')).connected.email,'storage-owner@example.invalid');assert.equal((await req(visitor,'/catalog')).community.historicalLearners,0);
      await req(student,'/student/workspace',undefined,'GET',401);assert.equal((await req(admin,'/admin/workspace')).students.length,0);
    });
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();rmSync(directory,{recursive:true,force:true});}
});
