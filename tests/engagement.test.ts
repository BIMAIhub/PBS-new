import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { signInApproved } from './admission-fixtures.js';
import { brandedEmail } from '../server/email-layout.js';
import { defaultBranding } from '../src/live/branding-types.js';

test('PBS document settings, verified referrals, wallet ledger and mail campaigns', async t => {
  const directory=mkdtempSync(path.join(tmpdir(),'pbs-engagement-'));
  for(const key of ['VERCEL','PBS_TURSO_DATABASE_URL','PBS_TURSO_AUTH_TOKEN','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','PBS_PUBLIC_ORIGIN','BLOB_READ_WRITE_TOKEN','BLOB_STORE_ID','CRON_SECRET'])delete process.env[key];
  process.env.PBS_DATA_DIR=directory;process.env.PBS_BOOTSTRAP_CATALOG='1';
  process.env.PBS_BOOTSTRAP_ADMIN_EMAIL='engagement-admin@example.invalid';process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD='Engagement-bootstrap-821!';
  const password='Engagement-test-password-386!';
  const {createPortalApp}=await import('../server/app.js');
  const {reconcileReferrals,walletBalance}=await import('../server/referral-data.js');
  const {processMailQueue,queueAutomation}=await import('../server/mail.js');
  const {RequestError}=await import('../server/http.js');
  const app=await createPortalApp(),db=app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address(),base=`http://127.0.0.1:${typeof address==='object'?address!.port:0}/api`;
  type Client={cookie:string};const admin:Client={cookie:''},owner:Client={cookie:''},friend:Client={cookie:''},visitor:Client={cookie:''};
  async function req(client:Client,url:string,body?:any,method=body===undefined?'GET':'POST',expected=200){
    const response=await fetch(base+url,{method,headers:{'X-PBS-Request':'1',...(client.cookie?{Cookie:client.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.headers.get('set-cookie'))client.cookie=response.headers.get('set-cookie')!.split(';')[0];
    const text=await response.text();assert.equal(response.status,expected,`${method} ${url}: ${text.slice(0,400)}`);return text&&response.headers.get('content-type')?.includes('json')?JSON.parse(text):text;
  }
  let courseId='',ownerId='',ownerEnrollment='',friendId='',friendEnrollment='',code='',referralId='',adminId='',creditAt=0;
  try{
    await t.test('setup uses isolated accounts and never connects to a real mail provider',async()=>{
      await req(admin,'/auth/login',{identifier:process.env.PBS_BOOTSTRAP_ADMIN_EMAIL,password:process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD,role:'admin'});
      await req(admin,'/auth/password',{current:process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD,next:password});
      adminId=String((await db.prepare("SELECT id FROM accounts WHERE role='admin'").get())!.id);
      courseId=(await req(visitor,'/catalog')).courses[0].id;
      const result=await req(admin,'/admin/students',{name:'Isolated Referrer',email:'referrer@example.invalid',phone:'+919876543201',courseId,total:200000,amount:100000,method:'Bank transfer',reference:'ENG-OWNER-PART'},'POST',201);
      ownerId=result.student.id;ownerEnrollment=result.enrollment.id;await signInApproved(req,owner,result,password);
      await req(visitor,'/student/referral-dashboard',undefined,'GET',401);
      await req(owner,'/admin/referrals',undefined,'GET',403);
    });
    await t.test('institution seal is admin-only, revision checked, persistent, and cannot contain active images',async()=>{
      const original=await req(visitor,'/document-stamp');assert.equal(original.color,'#176BB7');
      await req(owner,'/admin/document-stamp',original,'PUT',403);
      const saved=await req(admin,'/admin/document-stamp',{...original,institution:'PBS Isolated Academy',center:'PBS',caption:'OFFICIAL RECORD',location:'Academic office'},'PUT');
      assert.ok(saved.revision);assert.equal((await req(visitor,'/document-stamp')).location,'Academic office');
      await req(admin,'/admin/document-stamp',{...original,center:'STALE'},'PUT',409);
      await req(admin,'/admin/document-stamp',{...saved,imageData:'data:image/svg+xml;base64,PHN2Zz4='},'PUT',400);
      await req(admin,'/admin/document-stamp',{...saved,color:'red;url(x)'},'PUT',400);
      assert.equal((await req(visitor,'/document-stamp')).revision,saved.revision);
    });
    await t.test('automatic codes remain stable and attribute referrals even when a public offer is better',async()=>{
      const dashboard=await req(owner,'/student/referral-dashboard');code=dashboard.code;
      assert.match(code,/^PBS-[A-F0-9]{12}$/);assert.equal((await req(owner,'/student/referral-dashboard')).code,code);
      assert.equal(dashboard.program.rewardAmount,100000);assert.equal(dashboard.program.waitDays,7);
      await req(owner,'/enrollments/quote',{courseId,code},'POST',400);
      const quote=await req(visitor,'/enrollments/quote',{courseId,code,email:'newlearner@example.invalid'});assert.equal(quote.percent,20);assert.equal(quote.referralCode,code);
      await req(visitor,'/enrollments',{courseId,code,name:'Duplicate Contact QA',email:'duplicate@example.invalid',phone:'+919876543201',amount:0},'POST',400);
      assert.equal(await db.prepare('SELECT 1 FROM accounts WHERE email=?').get('duplicate@example.invalid'),undefined);
      const application=await req(visitor,'/enrollments',{courseId,code,name:'Isolated New Learner',email:'newlearner@example.invalid',phone:'+919876543202',amount:0},'POST',201);
      friendId=application.account.id;friendEnrollment=application.enrollment.id;
      const attribution=await db.prepare('SELECT id,amount,wait_days FROM referrals WHERE enrollment_id=?').get(friendEnrollment);referralId=String(attribution!.id);
      assert.equal(attribution!.amount,100000);assert.equal(attribution!.wait_days,7);
      const approval=await req(admin,`/admin/enrollments/${friendEnrollment}/decision`,{decision:'approved'});await signInApproved(req,friend,approval,password);
      assert.equal((await req(friend,'/student/referral-dashboard')).total,0);
      const progress=(await req(owner,'/student/referral-dashboard')).referrals[0];assert.equal(progress.referrerPaid,false);assert.equal(progress.studentPaid,false);assert.equal(progress.status,'pending');
      assert.equal('email' in progress,false);assert.equal('referredId' in progress,false);
    });
    await t.test('edited terms do not rewrite referrals; verified full fees and the full wait are required',async()=>{
      const current=(await req(admin,'/admin/referrals')).program;
      await req(admin,'/admin/referral-program',{...current,rewardAmount:150000,waitDays:3},'PUT');
      await req(admin,'/admin/referral-program',{...current,rewardAmount:1},'PUT',409);
      await req(admin,`/admin/referrals/${referralId}/credit`,{},'POST',409);
      await req(admin,`/admin/enrollments/${ownerEnrollment}/payment`,{amount:100000,method:'Bank transfer',reference:'ENG-OWNER-FULL'});
      const fee=Number((await db.prepare('SELECT total FROM enrollments WHERE id=?').get(friendEnrollment))!.total);
      await db.prepare('UPDATE enrollments SET requested_payment=? WHERE id=?').run(fee,friendEnrollment);
      assert.equal((await req(owner,'/student/referral-dashboard')).referrals[0].studentPaid,false);
      await req(admin,`/admin/enrollments/${friendEnrollment}/payment`,{amount:fee,method:'Bank transfer',reference:'ENG-FRIEND-FULL'});
      await reconcileReferrals(db);
      const row=await db.prepare('SELECT * FROM referrals WHERE id=?').get(referralId);creditAt=Date.parse(String(row!.eligible_at));
      assert.equal(row!.status,'holding');assert.equal(creditAt-Date.parse(String(row!.qualified_at)),7*86400000);
      assert.equal((await reconcileReferrals(db,new Date(creditAt-1))).length,0);assert.equal(await walletBalance(db,ownerId),0);
      const credits=await Promise.all([reconcileReferrals(db,new Date(creditAt)),reconcileReferrals(db,new Date(creditAt))]);assert.equal(credits.flat().length,1);
      assert.equal(await walletBalance(db,ownerId),100000);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM referral_wallet WHERE referral_id=?').get(referralId))!.n,1);
    });
    await t.test('wallet payments are atomic, ownership checked and safe under retries and competing requests',async()=>{
      const second=(await req(admin,'/admin/courses',{title:'Isolated next course',category:'QA',fee:200000,published:true},'POST',201)).course;
      const assigned=await req(admin,'/admin/students',{email:'referrer@example.invalid',courseId:second.id,total:200000,amount:0},'POST',201);
      const key='engagement-wallet-payment';
      await req(friend,'/student/wallet/pay',{enrollmentId:assigned.enrollment.id,amount:100000,requestKey:key},'POST',404);
      const attempts=await Promise.all(['competing-a','competing-b'].map(async requestKey=>{
        const response=await fetch(base+'/student/wallet/pay',{method:'POST',headers:{'X-PBS-Request':'1','Content-Type':'application/json',Cookie:owner.cookie},body:JSON.stringify({enrollmentId:assigned.enrollment.id,amount:70000,requestKey})});return{status:response.status,requestKey};
      }));
      assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);assert.equal(await walletBalance(db,ownerId),30000);
      const success=attempts.find(r=>r.status===200)!;
      const retry=await req(owner,'/student/wallet/pay',{enrollmentId:assigned.enrollment.id,amount:70000,requestKey:success.requestKey});assert.equal(retry.alreadyApplied,true);
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE method='PBS wallet'").get())!.n,1);
      await req(owner,'/student/wallet/pay',{enrollmentId:assigned.enrollment.id,amount:70001,requestKey:success.requestKey},'POST',409);
      assert.equal(await walletBalance(db,ownerId),30000);
    });
    await t.test('qualification resets after account inactivity and cannot mature while a fee remains unpaid',async()=>{
      const application=await req(visitor,'/enrollments',{courseId,code,name:'Isolated Waiting Learner',email:'waiting@example.invalid',phone:'+919876543203',amount:0},'POST',201);
      await req(admin,`/admin/enrollments/${application.enrollment.id}/decision`,{decision:'approved'});
      await reconcileReferrals(db,new Date(creditAt+86400000));
      const row=await db.prepare('SELECT * FROM referrals WHERE enrollment_id=?').get(application.enrollment.id);assert.equal(row!.status,'pending');assert.equal(row!.qualified_at,'');
      assert.equal(row!.amount,150000);assert.equal(row!.wait_days,3);
      const nextEnrollment=await db.prepare("SELECT id,total-(SELECT COALESCE(SUM(amount),0) FROM receipts r WHERE r.enrollment_id=e.id) AS balance FROM enrollments e WHERE account_id=? AND id<>?").get(ownerId,ownerEnrollment);
      await req(admin,`/admin/enrollments/${nextEnrollment!.id}/payment`,{amount:Number(nextEnrollment!.balance),method:'Bank transfer',reference:'ENG-NEXT-COURSE-FULL'});
      const friendFee=Number((await db.prepare('SELECT total FROM enrollments WHERE id=?').get(application.enrollment.id))!.total);
      await req(admin,`/admin/enrollments/${application.enrollment.id}/payment`,{amount:friendFee,method:'Bank transfer',reference:'ENG-WAITING-FULL'});
      await reconcileReferrals(db);
      const holding=await db.prepare('SELECT qualified_at,eligible_at FROM referrals WHERE id=?').get(row!.id);assert.ok(holding!.qualified_at);
      const inactiveAt=new Date(Date.parse(String(holding!.qualified_at))+86400000),activeAt=new Date(inactiveAt.getTime()+86400000);
      await db.prepare("INSERT INTO account_controls VALUES (?,'inactive','QA hold',?)").run(application.account.id,inactiveAt.toISOString());
      await reconcileReferrals(db,inactiveAt);
      assert.equal((await db.prepare('SELECT qualified_at FROM referrals WHERE id=?').get(row!.id))!.qualified_at,'');
      await db.prepare("UPDATE account_controls SET status='active',updated_at=? WHERE account_id=?").run(activeAt.toISOString(),application.account.id);
      await reconcileReferrals(db,activeAt);
      const reset=await db.prepare('SELECT eligible_at FROM referrals WHERE id=?').get(row!.id);
      assert.equal(Date.parse(String(reset!.eligible_at)),activeAt.getTime()+3*86400000);
      assert.equal((await reconcileReferrals(db,new Date(String(holding!.eligible_at)))).length,0);
      assert.equal(await walletBalance(db,ownerId),30000);
    });
    await t.test('email preview escapes names, text and links in the current website theme',async()=>{
      const html=brandedEmail(defaultBranding,'A <script>bad()</script> subject','Hello <img src=x onerror=alert(1)>\nhttps://example.invalid/?a=1&b=2');
      assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.match(html,/#176BB7/);assert.match(html,/#D4A94D/);assert.match(html,/&lt;img/);assert.match(html,/&amp;b=2/);
      await req(friend,'/admin/mail',undefined,'GET',403);
      const preview=await req(admin,'/admin/mail/preview',{subject:'Hello {{name}}',body:'{{message}}',message:'<b>Escaped offer</b>'});assert.match(preview.html,/&lt;b&gt;Escaped offer/);
    });
    await t.test('campaigns require consent and snapshot recipients without sending a draft',async()=>{
      await req(admin,'/admin/mail/campaigns',{title:'No consent',templateId:'offer',subject:'Offer',body:'Hello',recipientMode:'students'},'POST',400);
      await req(admin,'/admin/mail/campaigns',{title:'No external service message',templateId:'payment_reminder',subject:'Reminder',body:'Hello',recipientMode:'external',externalRecipients:'external@example.invalid',consentConfirmed:true},'POST',400);
      const draft=await req(admin,'/admin/mail/campaigns',{title:'Isolated offer campaign',templateId:'offer',subject:'{{academy}} offer',body:'Hello {{name}}\n{{message}}',message:'Verified QA offer text',recipientMode:'external',externalRecipients:'optedin@example.invalid, QA contact\noptedin@example.invalid, QA contact',consentConfirmed:true},'POST',201);
      assert.equal(draft.total,1);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM mail_outbox').get())!.n,0);
      await req(admin,`/admin/mail/campaigns/${draft.id}/send`,{revision:draft.revision},'POST',409);
      const token=String((await db.prepare('SELECT unsubscribe_token FROM mail_contacts WHERE email=?').get('optedin@example.invalid'))!.unsubscribe_token);
      const unsubscribe=await fetch(`${base}/mail/unsubscribe/${token}`,{method:'POST'});assert.equal(unsubscribe.status,200);
      assert.equal((await db.prepare('SELECT unsubscribed FROM mail_contacts WHERE email=?').get('optedin@example.invalid'))!.unsubscribed,1);
      await db.prepare('INSERT INTO microsoft_mail_connections VALUES (?,?,?,?,?)').run(adminId,'isolated-sender@example.invalid','QA sender','not-a-real-token-cache',new Date().toISOString());
      const sent=await req(admin,`/admin/mail/campaigns/${draft.id}/send`,{revision:draft.revision});assert.equal(sent.skipped,1);assert.equal(sent.accepted,0);
      assert.match(String((await db.prepare('SELECT body FROM mail_outbox WHERE campaign_id=?').get(draft.id))!.body),/Verified QA offer text/);
      await req(admin,`/admin/mail/campaigns/${draft.id}/send`,{revision:draft.revision});assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM mail_outbox WHERE campaign_id=?').get(draft.id))!.n,1);
    });
    await t.test('automatic queue is idempotent and delivery uncertainty is never blindly retried',async()=>{
      const event='isolated-welcome-event';await queueAutomation(db,'welcome',event,ownerId,'https://pbs.example.invalid');await queueAutomation(db,'welcome',event,ownerId,'https://pbs.example.invalid');
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM mail_outbox WHERE event_key=?').get(event))!.n,1);
      let calls=0;const uncertain=await processMailQueue(db,adminId,10,async()=>{calls++;throw new Error('Transport lost after send');});assert.equal(uncertain.uncertain,1);
      await processMailQueue(db,adminId,10,async()=>{calls++;});assert.equal(calls,1);
      const delivery=await db.prepare('SELECT id FROM mail_outbox WHERE event_key=?').get(event);
      await req(admin,`/admin/mail/deliveries/${delivery!.id}/retry`,{},'POST',409);
      await queueAutomation(db,'certificate','isolated-certificate',ownerId,'https://pbs.example.invalid');
      const failed=await processMailQueue(db,adminId,10,async()=>{throw new RequestError(403,'Missing Microsoft mail permission.');});assert.equal(failed.failed,1);
      const failure=await db.prepare("SELECT id FROM mail_outbox WHERE event_key='isolated-certificate'").get();await req(admin,`/admin/mail/deliveries/${failure!.id}/retry`,{});
      const accepted=await processMailQueue(db,adminId,10,async()=>{});assert.equal(accepted.accepted,1);
      const auto=await req(admin,'/admin/mail');await req(admin,'/admin/mail/automation',{...auto.automation,enabled:false},'PUT');assert.equal((await queueAutomation(db,'welcome','disabled-event',friendId,'https://pbs.example.invalid')).queued,false);
    });
    await t.test('scheduled processing requires a server secret and leaks no settings',async()=>{
      await req(visitor,'/jobs/academy',undefined,'GET',503);process.env.CRON_SECRET='isolated-cron-test-secret';
      await req(visitor,'/jobs/academy',undefined,'GET',401);
      const response=await fetch(base+'/jobs/academy',{headers:{Authorization:'Bearer isolated-cron-test-secret'}});assert.equal(response.status,200);assert.equal((await response.json()).credited,0);
      delete process.env.CRON_SECRET;
    });
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();rmSync(directory,{recursive:true,force:true});}
});
