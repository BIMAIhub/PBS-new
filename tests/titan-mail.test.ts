import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type {SendMailOptions} from 'nodemailer';
import {mailDomainReport,type MailDns} from '../server/mail-domain.js';
import type {SmtpFactory} from '../server/mail-transport.js';

test('Titan DNS uses its own selectors without requiring Microsoft selectors or claiming active signing',async()=>{
  const missing=()=>Promise.reject(Object.assign(new Error('Not published'),{code:'ENODATA'}));
  const dns:MailDns={txt:async n=>n.startsWith('_dmarc.')?[['v=DMARC1; p=quarantine; adkim=r; aspf=r;']]:[['T6462247'],['v=spf1 include:secureserver.net -all']],
    cname:async n=>n.startsWith('secureserver1.')?['s1.dkim.example_invalid.5d5.onsecureserver.net.']:n.startsWith('secureserver2.')?['s2.dkim.example_invalid.5d5.onsecureserver.net.']:missing(),
    mx:async()=>[{exchange:'smtp.secureserver.net.',priority:0},{exchange:'mailstore1.secureserver.net.',priority:10}],ns:async()=>['ns09.domaincontrol.com']};
  const titan=await mailDomainReport('info@example.invalid',dns,'titan');
  assert.equal(titan.dkim.status,'review');assert.equal(titan.dkim.records.length,2);assert.match(titan.dkim.note,/GoDaddy \/ Titan/);assert.match(titan.dkim.note,/does not prove signing/);assert.equal(titan.mx.status,'ready');assert.equal(titan.spf.status,'ready');assert.match(titan.dmarc.note,/Preserve the existing policy/);
  assert.equal((await mailDomainReport('example.invalid',dns,'microsoft')).dkim.status,'missing');
  const onlyMicrosoft=await mailDomainReport('example.invalid',{...dns,cname:async n=>n.startsWith('selector')?['tenant.example.invalid']:missing()},'titan');assert.equal(onlyMicrosoft.dkim.status,'missing');assert.match(onlyMicrosoft.dkim.note,/Microsoft selector records are not required/);
  const unavailable=()=>Promise.reject(Object.assign(new Error('DNS timed out'),{code:'ETIMEOUT'}));
  assert.equal((await mailDomainReport('example.invalid',{...dns,cname:unavailable},'titan')).dkim.status,'unavailable');
  assert.equal((await mailDomainReport('example.invalid',{...dns,mx:async()=>[{exchange:'smtp.secureserver.net',priority:0}]},'titan')).mx.status,'review');
});


test('Titan setup preserves data, encrypts credentials and routes mail without touching OneDrive',async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pbs-titan-mail-'));
  for(const key of ['VERCEL','PBS_TURSO_DATABASE_URL','PBS_TURSO_AUTH_TOKEN','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','PBS_PUBLIC_ORIGIN','BLOB_STORE_ID','BLOB_READ_WRITE_TOKEN','CRON_SECRET'])delete process.env[key];
  process.env.PBS_DATA_DIR=directory;process.env.PBS_BOOTSTRAP_CATALOG='0';process.env.PBS_BOOTSTRAP_ADMIN_EMAIL='titan-admin@example.invalid';process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD='Titan-bootstrap-849!';process.env.PBS_INTEGRATION_KEY='c'.repeat(64);
  const password='Titan-PBS-admin-fixture-936!',mailboxPassword='  Titan-mailbox-fixture-with-spaces  ';
  let verifying=0,sending=0,closed=0,verifyFailure:unknown,sendFailure:unknown,onVerify:(()=>Promise<void>)|undefined,lastMessage:SendMailOptions|undefined;
  const factory:SmtpFactory=auth=>({verify:async()=>{verifying++;assert.equal(auth.password,mailboxPassword);await onVerify?.();if(verifyFailure)throw verifyFailure;return true;},sendMail:async message=>{sending++;assert.equal(auth.password,mailboxPassword);lastMessage=message;if(sendFailure)throw sendFailure;return {accepted:['recipient@example.invalid'],rejected:[]};},close:()=>{closed++;}});
  const {createPortalApp}=await import('../server/app.js'),{seal,unseal}=await import('../server/microsoft.js'),{sendPortalMail,smtpProblem,titanSmtpFactory}=await import('../server/mail-transport.js'),{manualMailSender}=await import('../server/mail-senders.js'),{processMailQueue}=await import('../server/mail.js'),{saveSetting,setting}=await import('../server/academy-data.js');
  const app=await createPortalApp(false,{smtpFactory:factory}),db=app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address(),base=`http://127.0.0.1:${typeof address==='object'?address!.port:0}/api`;
  type Client={cookie:string};const admin={cookie:''},student={cookie:''},visitor={cookie:''};
  async function req(client:Client,url:string,body?:any,method=body===undefined?'GET':'POST',expected=200):Promise<any>{const response=await fetch(base+url,{method,headers:{'X-PBS-Request':'1',...(client.cookie?{Cookie:client.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(response.headers.get('set-cookie'))client.cookie=response.headers.get('set-cookie')!.split(';')[0];const raw=await response.text();assert.equal(response.status,expected,`${method} ${url}: ${raw.slice(0,200)}`);return raw?JSON.parse(raw):undefined;}
  let adminId='',state:any,roster:any,storage:any,microsoft:any,settings:any;
  const transport:typeof sendPortalMail=(db,id,to,subject,body,options)=>sendPortalMail(db,id,to,subject,body,options,factory);
  try{
    assert.equal((await import('../server/database.js')).dataDirectory,directory);
    await t.test('Titan transport enforces its fixed TLS endpoint and never exposes provider response text',()=>{
  const client=titanSmtpFactory({email:'info@example.invalid',password:'isolated-fixture-password'});
  const options=(client as unknown as {options:any}).options;assert.equal(options.host,'smtpout.secureserver.net');assert.equal(options.port,465);assert.equal(options.secure,true);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.disableFileAccess,true);assert.equal(options.disableUrlAccess,true);assert.equal(options.logger,false);assert.equal(options.debug,false);client.close();
  for(const source of [{code:'EAUTH',response:'secret-password',message:'secret-password'},{responseCode:550,response:'secret-password'},{code:'ETIMEDOUT',command:'DATA',message:'secret-password'}])assert.ok(!smtpProblem(source).message.includes('secret-password'));
  assert.equal(smtpProblem({code:'EAUTH'}).status,409);assert.equal(smtpProblem({responseCode:450}).status,429);assert.equal(smtpProblem({responseCode:550}).status,422);assert.equal(smtpProblem({code:'ETIMEDOUT',command:'DATA'}).status,502);
});

    await t.test('new schema is additive and only administrators can inspect or change mailing connections',async()=>{
      adminId=(await req(admin,'/auth/login',{identifier:process.env.PBS_BOOTSTRAP_ADMIN_EMAIL,password:process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD,role:'admin'})).account.id;await req(admin,'/auth/password',{current:process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD,next:password});
      const course=(await req(admin,'/admin/courses',{title:'Preserved Titan test course',category:'QA',fee:100000,published:true},'POST',201)).course;
      const learner=await req(admin,'/admin/students',{courseId:course.id,name:'Retained learner',email:'titan-learner@example.invalid',phone:'9876543220',total:100000,amount:25000,method:'Bank transfer',reference:'TITAN-FIXTURE'},'POST',201);await req(student,'/auth/login',{identifier:learner.student.email,password:learner.temporaryPassword,role:'student'});await req(student,'/auth/password',{current:learner.temporaryPassword,next:password});
      await db.prepare('INSERT INTO microsoft_connections VALUES (?,?,?,?,?)').run(adminId,'storage@example.invalid','Storage fixture',seal('not-a-real-storage-token'),'2026-01-01');await db.prepare('INSERT INTO microsoft_mail_connections VALUES (?,?,?,?,?)').run(adminId,'old-mail@example.invalid','Microsoft fixture',seal('not-a-real-mail-token'),'2026-01-01');
      await saveSetting(db,'mail_automation',JSON.stringify({enabled:false,welcome:false,senderId:'',certificate:true,payout_paid:false}));await saveSetting(db,'payments',JSON.stringify({paymentName:'Preserved payment settings'}));
      roster=await db.prepare('SELECT * FROM accounts ORDER BY id').all();storage=await db.prepare('SELECT * FROM microsoft_connections').all();microsoft=await db.prepare('SELECT * FROM microsoft_mail_connections').all();settings=await db.prepare("SELECT * FROM academy_settings WHERE key<>'mail_automation' ORDER BY key").all();
      await req(visitor,'/admin/integrations/mail',undefined,'GET',401);await req(student,'/admin/integrations/mail',undefined,'GET',403);await req(student,'/admin/integrations/mail/provider',{},'POST',403);await req(student,'/admin/integrations/mail/titan',{},'DELETE',403);
      state=await req(admin,'/admin/integrations/mail');assert.equal(state.provider,'microsoft');assert.equal(state.smtp,null);assert.equal(state.companySender.email,'old-mail@example.invalid');assert.equal(verifying,0);assert.equal(sending,0);
    });
    await t.test('invalid confirmations, stale reviews and failed authentication never save a password or send mail',async()=>{
      const input={email:'info@example.invalid',password:mailboxPassword,current:password,revision:state.revision};
      await req(admin,'/admin/integrations/mail/titan',{...input,current:'incorrect'},'PUT',400);await req(admin,'/admin/integrations/mail/titan',{...input,revision:'outdated'},'PUT',409);assert.equal(verifying,0);
      verifyFailure={code:'EAUTH',message:mailboxPassword,response:mailboxPassword};const failure=await req(admin,'/admin/integrations/mail/titan',input,'PUT',409);assert.ok(!failure.error.includes(mailboxPassword));assert.equal(await db.prepare('SELECT 1 FROM smtp_mail_connections').get(),undefined);assert.equal(sending,0);verifyFailure=undefined;
    });
    await t.test('verified Titan credentials are encrypted and selected without altering existing automation flags or data',async()=>{
      await req(admin,'/admin/integrations/mail/titan',{email:'info@example.invalid',password:mailboxPassword,current:password,revision:state.revision},'PUT',204);state=await req(admin,'/admin/integrations/mail');assert.equal(state.companySender.provider,'titan');assert.equal(state.companySender.email,'info@example.invalid');assert.equal(sending,0);
      const encrypted=String((await db.prepare('SELECT password_sealed FROM smtp_mail_connections').get())!.password_sealed);assert.ok(!encrypted.includes(mailboxPassword));assert.equal(unseal(encrypted),mailboxPassword);assert.ok(!JSON.stringify(state).includes(encrypted));assert.ok(!JSON.stringify(state).includes(mailboxPassword));
      const automation=JSON.parse(await setting(db,'mail_automation'));assert.equal(automation.enabled,false);assert.equal(automation.welcome,false);assert.equal(automation.payout_paid,false);assert.equal(automation.senderId,adminId);
      assert.deepEqual(await db.prepare('SELECT * FROM accounts ORDER BY id').all(),roster);assert.deepEqual(await db.prepare('SELECT * FROM microsoft_connections').all(),storage);assert.deepEqual(await db.prepare('SELECT * FROM microsoft_mail_connections').all(),microsoft);assert.deepEqual(await db.prepare("SELECT * FROM academy_settings WHERE key<>'mail_automation' ORDER BY key").all(),settings);
      const check=await req(admin,'/admin/mail/check-connection',{});assert.equal(check.provider,'titan');assert.equal(sending,0);assert.equal((await req(admin,'/admin/mail')).senders[0].email,'info@example.invalid');
    });
    await t.test('password reuse requires the same mailbox and stale saves are rejected even after authentication finishes',async()=>{
      await req(admin,'/admin/integrations/mail/titan',{email:'changed@example.invalid',password:'',current:password,revision:state.revision},'PUT',400);
      onVerify=async()=>{await db.prepare("UPDATE mail_sender_preferences SET revision='changed-during-verify' WHERE admin_id=?").run(adminId);};
      await req(admin,'/admin/integrations/mail/titan',{email:'info@example.invalid',password:mailboxPassword,current:password,revision:state.revision},'PUT',409);onVerify=undefined;state=await req(admin,'/admin/integrations/mail');assert.equal(state.smtp.email,'info@example.invalid');assert.equal(sending,0);
    });
    await t.test('the common transport includes theme, text, safe unsubscribe headers and identical attachment bytes',async()=>{
      const bytes=Buffer.from('%PDF-1.7 isolated certificate fixture'),url='https://pbs.example.invalid/api/mail/unsubscribe/fixture';
      await transport(db,adminId,'recipient@example.invalid','PBS update','Hello learner',{unsubscribeUrl:url,attachments:[{name:'certificate.pdf',contentType:'application/pdf',contentBytes:bytes.toString('base64')}]});
      assert.equal((lastMessage!.from as any).address,'info@example.invalid');assert.match(String(lastMessage!.html),/Hello learner/);assert.match(String(lastMessage!.text),/Unsubscribe/);assert.equal((lastMessage!.headers as any)['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');assert.deepEqual((lastMessage!.attachments![0] as any).content,bytes);
      const mime=await nodemailer.createTransport({streamTransport:true,buffer:true}).sendMail(lastMessage!);const raw=String(mime.message);assert.match(raw,/List-Unsubscribe:/);assert.match(raw,/multipart\/alternative/);assert.match(raw,/application\/pdf/);
    });
    await t.test('confirmed SMTP rejection can retry but an interrupted DATA response stays uncertain without automatic resend',async()=>{
      const insert=async(id:string)=>db.prepare('INSERT INTO mail_outbox (id,event_key,admin_id,email,name,subject,body,origin,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,id,adminId,'recipient@example.invalid','QA recipient','QA update','QA body','https://pbs.example.invalid',new Date().toISOString());
      await insert('smtp-rejected');sendFailure={responseCode:550,response:mailboxPassword};assert.equal((await processMailQueue(db,adminId,10,transport)).failed,1);assert.equal((await db.prepare("SELECT status FROM mail_outbox WHERE id='smtp-rejected'").get())!.status,'failed');
      await insert('smtp-interrupted');sendFailure={code:'ETIMEDOUT',command:'DATA',message:mailboxPassword};assert.equal((await processMailQueue(db,adminId,10,transport)).uncertain,1);const count=sending;assert.equal((await processMailQueue(db,adminId,10,transport)).accepted,0);assert.equal(sending,count);const row=await db.prepare("SELECT status,error FROM mail_outbox WHERE id='smtp-interrupted'").get();assert.equal(row!.status,'unknown');assert.ok(!String(row!.error).includes(mailboxPassword));sendFailure=undefined;
    });
    await t.test('switching and removing Titan never resets Microsoft or OneDrive and cannot silently fall back',async()=>{
      await req(admin,'/admin/integrations/mail/provider',{provider:'microsoft',revision:state.revision,current:password},'POST',204);state=await req(admin,'/admin/integrations/mail');assert.equal(state.companySender.provider,'microsoft');assert.ok(state.smtp.passwordSaved);
      await req(admin,'/admin/integrations/mail/provider',{provider:'titan',revision:state.revision,current:password},'POST',204);state=await req(admin,'/admin/integrations/mail');const count=sending;
      await req(admin,'/admin/integrations/mail/titan',{revision:state.revision,current:password},'DELETE',204);assert.equal(await manualMailSender(db,adminId),'');assert.equal((await req(admin,'/admin/integrations/mail')).companySender,null);
      await assert.rejects(()=>transport(db,adminId,'recipient@example.invalid','Never fall back','QA'),/Connect the selected/);assert.equal(sending,count);
      assert.deepEqual(await db.prepare('SELECT * FROM microsoft_connections').all(),storage);assert.deepEqual(await db.prepare('SELECT * FROM microsoft_mail_connections').all(),microsoft);assert.deepEqual(await db.prepare('SELECT * FROM accounts ORDER BY id').all(),roster);assert.ok(closed>0);
      const audit=JSON.stringify(await db.prepare('SELECT * FROM academy_events').all());assert.ok(!audit.includes(mailboxPassword));assert.ok(!audit.includes('password_sealed'));
    });
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));db.close();rmSync(directory,{recursive:true,force:true});}
});
