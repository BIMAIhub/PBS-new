import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { signInApproved } from './admission-fixtures.js';

test('brochures, consented leads, historical credentials, scoped files and immutable MCQ attempts',async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pbs-education-'));
  for(const key of ['VERCEL','PBS_TURSO_DATABASE_URL','PBS_TURSO_AUTH_TOKEN','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','PBS_PUBLIC_ORIGIN','BLOB_STORE_ID','BLOB_READ_WRITE_TOKEN','CRON_SECRET'])delete process.env[key];
  process.env.PBS_DATA_DIR=directory;process.env.PBS_BOOTSTRAP_CATALOG='0';process.env.PBS_BOOTSTRAP_ADMIN_EMAIL='education-admin@example.invalid';process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD='Education-bootstrap-185!';process.env.PBS_INTEGRATION_KEY='d'.repeat(64);
  const password='Education-isolated-password-284!';
  const {createPortalApp}=await import('../server/app.js'),{fileDownloadLocation}=await import('../server/learning-files.js'),{templateVariables}=await import('../server/mail.js');
  const items=new Map<string,any>();let folderCounter=0;
  const provider:any=async(_db:any,_admin:string,url:string,init?:RequestInit)=>{
    const body=init?.body?JSON.parse(String(init.body)):undefined;
    if(url.endsWith('/children'))return{id:`folder-${++folderCounter}`,name:body.name,folder:{},parentReference:{driveId:'qa-drive'}};
    if(url.endsWith('/createUploadSession'))return{uploadUrl:'https://qa.up.1drv.com/upload/isolated',expirationDateTime:new Date(Date.now()+3600000).toISOString()};
    const id=/\/items\/([^?]+)/.exec(url)?.[1];if(id&&items.has(id))return items.get(id);
    throw new Error('Unexpected isolated storage request.');
  };
  const app=await createPortalApp(false,{microsoftGraph:provider}),db=app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const addr=server.address(),origin=`http://127.0.0.1:${typeof addr==='object'?addr!.port:0}`;
  type Client={cookie:string};const admin={cookie:''},student={cookie:''},alumni={cookie:''},visitor={cookie:''},other={cookie:''};
  async function req(client:Client,url:string,body?:any,method=body===undefined?'GET':'POST',expected=200){
    const response=await fetch(origin+'/api'+url,{method,redirect:'manual',headers:{'X-PBS-Request':'1',...(client.cookie?{Cookie:client.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.headers.get('set-cookie'))client.cookie=response.headers.get('set-cookie')!.split(';')[0];const raw=await response.text();assert.equal(response.status,expected,`${method} ${url}: ${raw.slice(0,350)}`);
    return response.headers.get('location')?{location:response.headers.get('location')}:raw&&response.headers.get('content-type')?.includes('json')?JSON.parse(raw):raw;
  }
  let adminId='',courseId='',draftId='',moduleId='',secondModule='',lessonId='',studentId='',alumniId='',certificate:any,resource:any,lessonResource:any,quiz:any,attempt:any,taskId='',originalFile='',preservedAdmin:any,preservedStudent:any;
  const uuid=()=>crypto.randomUUID();
  try{
    await t.test('isolated setup and existing identities',async()=>{
      adminId=(await req(admin,'/auth/login',{identifier:process.env.PBS_BOOTSTRAP_ADMIN_EMAIL,password:process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD,role:'admin'})).account.id;
      await req(admin,'/auth/password',{current:process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD,next:password});preservedAdmin=await db.prepare('SELECT * FROM accounts WHERE id=?').get(adminId);
      courseId=(await req(admin,'/admin/courses',{title:'BIM practice course',category:'QA',fee:200000,published:true},'POST',201)).course.id;
      draftId=(await req(admin,'/admin/courses',{title:'Historical offline course',category:'QA',fee:0,published:false},'POST',201)).course.id;
      moduleId=(await req(admin,`/admin/courses/${courseId}/modules`,{title:'Workflow models'},'POST',201)).id;
      secondModule=(await req(admin,`/admin/courses/${courseId}/modules`,{title:'Coordination models'},'POST',201)).id;
      lessonId=(await req(admin,`/admin/courses/${courseId}/modules/${moduleId}/lessons`,{title:'Workflow video',duration:'10 min',url:'https://example.org/private-video.mp4'},'POST',201)).id;
      const first=await req(admin,'/admin/students',{name:'Current student',email:'current@example.invalid',phone:'+919876543211',courseId,total:200000,amount:0},'POST',201);studentId=first.enrollment.studentId;await signInApproved(req,student,first,password);preservedStudent=await db.prepare('SELECT * FROM accounts WHERE id=?').get(studentId);
      const second=await req(admin,'/admin/students',{name:'Different student',email:'different@example.invalid',phone:'+919876543212',courseId:draftId,total:0,amount:0},'POST',201);await signInApproved(req,other,second,password);
    });
    await t.test('brochure requests create deduplicated leads without accounts or media URLs',async()=>{
      const body={name:'Prospective learner',email:'lead@example.invalid',phone:'+919876543213',qualification:'Civil engineer',requestKey:uuid(),consent:true};
      const result=await req(visitor,`/courses/${courseId}/brochure-request`,body,'POST',201);assert.equal(result.brochure.modules[0].lessons[0].title,'Workflow video');assert.ok(!JSON.stringify(result).includes('private-video.mp4'));
      assert.equal((await req(visitor,`/courses/${courseId}/brochure-request`,body,'POST',201)).leadId,result.leadId);
      await req(visitor,`/courses/${courseId}/brochure-request`,{...body,requestKey:uuid()},'POST',201);
      assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM course_leads').get())!.n),1);assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM brochure_requests').get())!.n),2);
      assert.equal(await db.prepare('SELECT 1 FROM accounts WHERE email=?').get(body.email),undefined);
      await req(visitor,`/courses/${draftId}/brochure-request`,{...body,requestKey:uuid()},'POST',404);await req(visitor,'/admin/leads',undefined,'GET',401);await req(student,'/admin/leads',undefined,'GET',403);
      const lead=(await req(admin,'/admin/leads')).leads[0];await req(admin,`/admin/leads/${lead.id}`,{status:'contacted',note:'Discuss next batch',revision:lead.revision},'PATCH',204);await req(admin,`/admin/leads/${lead.id}`,{status:'lost',note:'stale',revision:lead.revision},'PATCH',409);
      assert.match(await req(admin,'/admin/leads/export'),/Discuss next batch/);
    });
    await t.test('lead campaigns enforce consent, opt-outs, deduplication and draft-only behavior',async()=>{
      const base={name:'No marketing',email:'no-marketing@example.invalid',phone:'9876543214',requestKey:uuid(),consent:false};await req(visitor,`/courses/${courseId}/brochure-request`,base,'POST',201);
      const rows=(await req(admin,'/admin/leads')).leads;const campaign={title:'Brochure follow-up',templateId:'offer',subject:'About {{course}}',body:'Hello {{name}}, {{course}} {{explore_url}}',recipientMode:'leads',leadIds:rows.map((l:any)=>l.id),consentConfirmed:true};
      const draft=await req(admin,'/admin/mail/campaigns',campaign,'POST',201);assert.equal(draft.total,1);assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM mail_outbox').get())!.n),0);assert.equal((await db.prepare('SELECT course_id FROM campaign_lead_links WHERE campaign_id=?').get(draft.id))!.course_id,courseId);
      await req(admin,'/admin/mail/campaigns',{...campaign,templateId:'login'},'POST',400);
      await db.prepare('UPDATE mail_contacts SET unsubscribed=1 WHERE email=?').run('lead@example.invalid');
      await req(visitor,`/courses/${courseId}/brochure-request`,{name:'Prospective learner',email:'lead@example.invalid',phone:'9876543213',requestKey:uuid(),consent:true},'POST',201);
      await req(admin,'/admin/mail/campaigns',campaign,'POST',400);assert.equal((await db.prepare('SELECT unsubscribed FROM mail_contacts WHERE email=?').get('lead@example.invalid'))!.unsubscribed,1);
      const templates=(await req(admin,'/admin/mail')).templates;assert.ok(templates.some((t:any)=>t.id==='app_launch'&&t.marketing));assert.ok(templates.some((t:any)=>t.id==='app_guide'&&!t.marketing));
      const preview=await req(admin,'/admin/mail/preview',{subject:'Install PBS',body:'{{app_url}}',marketing:false});assert.match(preview.html,new RegExp(origin+'/app'));
    });
    await t.test('OneDrive uploads verify private file identity and preserve storage files',async()=>{
      await db.prepare('INSERT INTO course_storage VALUES (?,?,?,?,?,?,?)').run(draftId,adminId,'qa-drive','qa-root','QA','https://example.org/storage',0);
      const session=await req(admin,'/admin/learning-files/upload',{courseId:draftId,kind:'certificate',filename:'Old credential.pdf',size:3200,contentType:'application/pdf'},'POST',201);
      const upload=await db.prepare('SELECT * FROM academy_files WHERE id=?').get(session.uploadId);assert.ok(upload!.upload_url&&!String(upload!.upload_url).startsWith('https:'));
      items.set('wrong-file',{id:'wrong-file',name:upload!.filename,size:3200,file:{mimeType:'application/pdf'},parentReference:{driveId:'qa-drive',id:'wrong-parent'}});
      await req(admin,`/admin/learning-files/${session.uploadId}/complete`,{itemId:'wrong-file'},'POST',400);
      items.set('original-pdf',{id:'original-pdf',name:upload!.filename,size:3200,file:{mimeType:'application/pdf'},parentReference:{driveId:'qa-drive',id:upload!.parent_id}});
      originalFile=(await req(admin,`/admin/learning-files/${session.uploadId}/complete`,{itemId:'original-pdf'})).id;
      await req(admin,`/admin/learning-files/${session.uploadId}/complete`,{itemId:'original-pdf'});assert.equal((await db.prepare('SELECT upload_url FROM academy_files WHERE id=?').get(originalFile))!.upload_url,'');
      assert.equal((await fileDownloadLocation(db,originalFile,async()=> 'https://qa.up.1drv.com/private-file')).url,'https://qa.up.1drv.com/private-file');
      await req(admin,'/admin/learning-files/upload',{courseId:draftId,kind:'certificate',filename:'recording.mp4',size:3200},'POST',400);await req(student,'/admin/learning-files/upload',{},'POST',403);
    });
    await t.test('verified alumni can set a private password and share credentials without fabricated enrollments or grades',async()=>{
      const body={name:'Past learner',email:'past@example.invalid',phone:'+919876543215',courseId:draftId,qualification:'B.Tech Civil',mode:'offline',completedAt:'2024-06-01',issuedAt:'2024-06-03',originalNumber:'PBS/OFFLINE/2024/01',score:'',note:'Verified original ledger',fileId:originalFile,verified:true,requestKey:uuid()};
      const result=await req(admin,'/admin/past-students',body,'POST',201);alumniId=result.access.studentId;assert.ok(result.access.password);assert.match(result.access.body,/past training record/);assert.ok(!result.access.body.includes('Temporary password: undefined'));
      const repeated=await req(admin,'/admin/past-students',body,'POST',201);assert.equal(repeated.access.password,undefined);assert.equal(repeated.access.studentId,alumniId);
      assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM enrollments WHERE account_id=?').get(alumniId))!.n),0);assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM assessment_results WHERE account_id=?').get(alumniId))!.n),0);
      await req(alumni,'/auth/login',{identifier:body.email,password:result.access.password,role:'student'});await req(alumni,'/student/workspace',undefined,'GET',403);await req(alumni,'/auth/password',{current:result.access.password,next:password});
      assert.equal((await req(alumni,'/student/workspace')).courses.length,0);assert.equal((await req(alumni,'/student/past-training')).records[0].note,undefined);
      certificate=(await req(alumni,'/student/academy')).certificates[0];assert.equal(certificate.historical.scoreRecorded,false);assert.equal(certificate.historical.originalNumber,body.originalNumber);assert.equal(certificate.historical.hasOriginal,true);
      await req(visitor,`/certificates/verify/${certificate.publicToken}`,undefined,'GET',404);await req(other,`/student/certificates/${certificate.id}`,{published:true},'PATCH',404);await req(alumni,`/student/certificates/${certificate.id}`,{published:true},'PATCH',204);
      const verified=await req(visitor,`/certificates/verify/${certificate.publicToken}`);assert.equal(verified.historical.originalNumber,body.originalNumber);assert.ok(!JSON.stringify(verified).includes(body.email));assert.ok(!JSON.stringify(verified).includes('Verified original ledger'));
      await req(other,`/certificates/${certificate.id}/original`,undefined,'GET',404);await req(visitor,`/certificates/${certificate.id}/original`,undefined,'GET',401);
      await req(admin,'/admin/past-students',{...body,email:'education-admin@example.invalid',fileId:'',requestKey:uuid()},'POST',409);
      await req(admin,'/admin/past-students',{...body,email:'unverified@example.invalid',verified:false,requestKey:uuid()},'POST',400);
      const existing=await req(admin,'/admin/past-students',{...body,name:'Current student credential',email:'current@example.invalid',fileId:'',requestKey:uuid()},'POST',201);assert.equal(existing.access.password,undefined);assert.deepEqual(await db.prepare('SELECT * FROM accounts WHERE id=?').get(studentId),preservedStudent);
      const campaign=await req(admin,'/admin/mail/campaigns',{title:'Alumni app guide',templateId:'app_guide',subject:'PBS app',body:'{{app_url}}',recipientMode:'alumni'},'POST',201);assert.equal(campaign.total,2);
      assert.equal((await templateVariables(db,origin,alumniId)).course,'Historical offline course');
      assert.equal((await templateVariables(db,origin,studentId)).course,'BIM practice course');
    });
    await t.test('course, module and video resources follow approved access and release rules',async()=>{
      const payload={courseId,scope:'module',moduleId,title:'Practice BIM model',description:'Download the model for this workflow',kind:'model',url:'https://example.org/practice.rvt',published:true};
      resource=(await req(admin,'/admin/learning-resources',payload,'POST',201)).id;
      lessonResource=(await req(admin,'/admin/learning-resources',{...payload,scope:'lesson',lessonId,title:'Video question PDF',kind:'document',url:'https://example.org/questions.pdf'},'POST',201)).id;
      assert.equal((await req(student,'/student/learning-resources')).resources.length,2);assert.equal((await req(other,'/student/learning-resources')).resources.length,0);
      await req(other,`/learning-resources/${resource}/download`,undefined,'GET',404);assert.equal((await req(student,`/learning-resources/${resource}/download`,undefined,'GET',302)).location,payload.url);
      await req(admin,`/admin/modules/${moduleId}/release`,{batchId:'',mode:'manual',released:false},'PUT',204);assert.equal((await req(student,'/student/learning-resources')).resources.length,0);await req(student,`/learning-resources/${resource}/download`,undefined,'GET',404);
      await req(admin,`/admin/modules/${moduleId}/release`,{batchId:'',mode:'manual',released:true,revision:(await db.prepare('SELECT revision FROM module_releases WHERE module_id=?').get(moduleId))!.revision},'PUT',204);
      const row=(await req(admin,'/admin/learning-resources')).resources.find((r:any)=>r.id===resource);await req(admin,'/admin/learning-resources',{...payload,id:resource,revision:'stale'},'POST',409);
      taskId=(await req(admin,'/admin/tasks',{courseId,moduleId,title:'Practical task',brief:'Use the attached model and question paper.',deliverables:[],published:true,resourceIds:[resource,lessonResource]})).id;
      assert.equal((await req(student,'/student/tasks')).tasks[0].resources.length,2);
      await req(admin,`/admin/tasks/${taskId}`,{courseId,moduleId,title:'Updated task',brief:'Keep attachments when omitted.',deliverables:[],published:true},'PUT');assert.equal((await req(student,'/student/tasks')).tasks[0].resources.length,2);
      assert.equal(row.scope,'module');
    });
    await t.test('a moved video resource follows its destination module release',async()=>{
      await req(admin,`/admin/modules/${secondModule}/release`,{batchId:'',mode:'manual',released:false},'PUT',204);
      await req(admin,`/admin/courses/${courseId}/lessons/${lessonId}/module`,{moduleId:secondModule,expectedModuleId:moduleId},'PATCH');
      assert.equal((await req(student,'/student/learning-resources')).resources.some((r:any)=>r.id===lessonResource),false);
      await req(admin,`/admin/courses/${courseId}/lessons/${lessonId}/module`,{moduleId,expectedModuleId:secondModule},'PATCH');
      assert.equal((await req(student,'/student/learning-resources')).resources.some((r:any)=>r.id===lessonResource),true);
    });
    await t.test('MCQ attempts keep answers private, grade on the server and retain immutable question snapshots',async()=>{
      const payload={courseId,scope:'module',moduleId,title:'Workflow MCQ assignment',instructions:'Use the sample files.',mode:'assignment',questions:[{text:'Which system coordinates building information?',options:['BIM','Random files'],answer:0,explanation:'BIM coordinates shared building information.'}],resourceIds:[resource],passingScore:70,maxAttempts:1,timeLimit:0,published:true,reviewReleased:false};
      const id=(await req(admin,'/admin/learning-quizzes',payload,'POST',201)).id;quiz=(await req(admin,'/admin/learning-quizzes')).quizzes.find((q:any)=>q.id===id);
      const publicQuiz=(await req(student,'/student/learning-quizzes')).quizzes[0];assert.equal(publicQuiz.questions,undefined);assert.ok(!JSON.stringify(publicQuiz).includes('coordinates shared'));await req(other,`/student/learning-quizzes/${id}/start`,{requestKey:uuid()},'POST',404);
      const key=uuid();attempt=await req(student,`/student/learning-quizzes/${id}/start`,{requestKey:key},'POST',201);assert.equal(attempt.questions[0].answer,undefined);assert.equal(attempt.questions[0].explanation,undefined);
      assert.equal((await req(student,`/student/learning-quizzes/${id}/start`,{requestKey:uuid()},'POST',201)).id,attempt.id);
      await req(student,`/student/quiz-attempts/${attempt.id}`,{answers:{q1:9}},'POST',400);await req(other,`/student/quiz-attempts/${attempt.id}`,{answers:{q1:0},submit:true},'POST',404);
      await req(student,`/student/quiz-attempts/${attempt.id}`,{answers:{q1:0}});
      await req(admin,'/admin/learning-quizzes',{...payload,id,revision:quiz.revision,questions:[{...payload.questions[0],answer:1}]},'POST',201);
      const submitted=await req(student,`/student/quiz-attempts/${attempt.id}`,{answers:{q1:0},submit:true,score:0,passed:false});assert.equal(submitted.score,100);assert.equal(submitted.passed,true);assert.equal(submitted.reviewAvailable,false);assert.equal(submitted.questions[0].answer,undefined);
      assert.equal((await req(student,`/student/quiz-attempts/${attempt.id}`,{answers:{q1:1},submit:true})).score,100);await req(student,`/student/learning-quizzes/${id}/start`,{requestKey:uuid()},'POST',409);
      quiz=(await req(admin,'/admin/learning-quizzes')).quizzes.find((q:any)=>q.id===id);await req(admin,'/admin/learning-quizzes',{...payload,id,revision:quiz.revision,reviewReleased:true},'POST',201);
      const review=(await req(student,`/student/learning-quizzes/${id}/attempts`)).attempts[0];assert.equal(review.questions[0].answer,0);assert.match(review.questions[0].explanation,/shared/);
      await req(admin,`/admin/quiz-attempts/${attempt.id}/feedback`,{feedback:'Excellent understanding.'},'PATCH',204);assert.equal((await req(student,`/student/learning-quizzes/${id}/attempts`)).attempts[0].feedback,'Excellent understanding.');
      assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM assessment_results WHERE account_id=?').get(studentId))!.n),0);
      const timed=(await req(admin,'/admin/learning-quizzes',{...payload,title:'Timed practice',mode:'practice',maxAttempts:0,timeLimit:1},'POST',201)).id;
      const a=await req(student,`/student/learning-quizzes/${timed}/start`,{requestKey:uuid()},'POST',201);await db.prepare('UPDATE quiz_attempts SET expires_at=? WHERE id=?').run(Date.now()-1000,a.id);
      const expired=await req(student,`/student/quiz-attempts/${a.id}`,{answers:{q1:0},submit:true});assert.equal(expired.score,0);assert.equal(expired.reviewAvailable,true);
    });
    await t.test('removing a populated module never broadens protected file or test access',async()=>{
      const endpoint=`/admin/courses/${courseId}/modules/${moduleId}`,usage=await req(admin,`${endpoint}/usage`);
      await req(admin,endpoint,{confirm:true,expectedTitle:usage.title,expectedLessonIds:usage.lessonIds,includeVideos:true,keepAssignments:true},'DELETE',204);
      assert.equal((await req(student,'/student/learning-resources')).resources.length,0);await req(student,`/learning-resources/${resource}/download`,undefined,'GET',404);
      assert.ok((await req(student,'/student/learning-quizzes')).quizzes.every((q:any)=>q.locked));
      assert.equal((await db.prepare('SELECT id FROM academy_files WHERE id=?').get(originalFile))!.id,originalFile);
      assert.deepEqual(await db.prepare('SELECT * FROM accounts WHERE id=?').get(adminId),preservedAdmin);assert.deepEqual(await db.prepare('SELECT * FROM accounts WHERE id=?').get(studentId),preservedStudent);
      assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM receipts r JOIN enrollments e ON e.id=r.enrollment_id WHERE e.account_id=?').get(alumniId))?.n||0),0);
    });
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();rmSync(directory,{recursive:true,force:true});}
});
