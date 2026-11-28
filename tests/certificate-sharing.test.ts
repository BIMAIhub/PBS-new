import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fitPdfImage } from '../src/live/pdf-image.js';

test('the deployed certificate renderer initializes as native Node ESM without the TypeScript loader',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pbs-certificate-esm-'));
  try {
    const {transpileModule,ModuleKind,ScriptTarget}=await import('typescript');
    writeFileSync(path.join(directory,'package.json'),JSON.stringify({type:'module'}));
    for(const name of ['certificate-pdf','pdf-fonts','pdf-image','document-types','pdf-stamp']) {
      const source=readFileSync(new URL(`../src/live/${name}.ts`,import.meta.url),'utf8');
      writeFileSync(path.join(directory,`${name}.js`),transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText);
    }
    const result=spawnSync(process.execPath,['--input-type=module','-e',`const renderer=await import(${JSON.stringify(pathToFileURL(path.join(directory,'certificate-pdf.js')).href)});if(typeof renderer.buildCertificatePdf!=='function')process.exit(1);`],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||result.stdout);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

const images={"logo": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAAA8CAYAAABYfzddAAAA0ElEQVR4nO3TQQ3AIADAwDETiEQg8piHfUiTOwX9dMy1zwMkvbcDgP8MDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGsA+BxQKwL0vxjgAAAABJRU5ErkJggg==", "signature": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAAAoCAYAAADAOHfQAAAAl0lEQVR4nO3TsQ3AIADAsNJDmJn5/zf6QxcUyb4gS8Zc+zxA0ns7APjPwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGsA8KTAHHu/fJmwAAAABJRU5ErkJggg==", "stamp": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAAAxUlEQVR4nO3QQQ2AMADAwDGZ04QSTDIP64OQ3Cloeq37eQfH5tcBf2dgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYLQBb3QDLzYeqPAAAAAASUVORK5CYII="};
async function pdfDetails(bytes:Uint8Array){const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:false}),doc=await task.promise;try{const page=await doc.getPage(1),text=await page.getTextContent();return {pages:doc.numPages,width:page.view[2],height:page.view[3],text:text.items.map(i=>'str'in i?i.str:'').join(' ')};}finally{await task.destroy();}}
test('PDF image slots preserve wide logo and signature proportions',()=>{
  let args:any[]=[];const pdf:any={getImageProperties:()=>({width:240,height:60,fileType:'PNG'}),addImage:(...values:any[])=>{args=values;}};
  fitPdfImage(pdf,'fixture',23,21,32,22);assert.equal(args[2],23);assert.equal(args[3],28);assert.equal(args[4],32);assert.equal(args[5],8);
});
test('canonical certificates, signed PDF email, alumni welcome and admin-controlled referral codes',async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pbs-credentials-'));
  for(const key of ['VERCEL','PBS_TURSO_DATABASE_URL','PBS_TURSO_AUTH_TOKEN','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','PBS_PUBLIC_ORIGIN','BLOB_STORE_ID','BLOB_READ_WRITE_TOKEN','CRON_SECRET'])delete process.env[key];
  process.env.PBS_DATA_DIR=directory;process.env.PBS_BOOTSTRAP_CATALOG='0';process.env.PBS_BOOTSTRAP_ADMIN_EMAIL='credentials-admin@example.invalid';process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD='Credentials-bootstrap-185!';process.env.PBS_INTEGRATION_KEY='e'.repeat(64);
  const password='Credentials-isolated-password-284!',sent:any[]=[];let failing=false,uncertain=false;
  const {createPortalApp}=await import('../server/app.js'),{RequestError}=await import('../server/http.js'),{issueReceipt}=await import('../server/records.js'),{reconcileReferrals}=await import('../server/referral-data.js');
  const mail:any=async(...args:any[])=>{if(failing)throw new RequestError(502,'Microsoft could not complete this action (ErrorAccessDenied). Reconnect the mailing account.');if(uncertain)throw new Error('Network interrupted');sent.push(args);};
  const app=await createPortalApp(false,{microsoftMail:mail}),db=app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address(),origin=`http://127.0.0.1:${typeof address==='object'?address!.port:0}`;
  type Client={cookie:string};const admin={cookie:''},student={cookie:''},other={cookie:''},visitor={cookie:''};
  async function req(client:Client,url:string,body?:any,method=body===undefined?'GET':'POST',expected=200):Promise<any>{const response=await fetch(origin+'/api'+url,{method,headers:{'X-PBS-Request':'1',...(client.cookie?{Cookie:client.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(response.headers.get('set-cookie'))client.cookie=response.headers.get('set-cookie')!.split(';')[0];if(response.headers.get('content-type')?.includes('application/pdf')){assert.equal(response.status,expected);return Buffer.from(await response.arrayBuffer());}const raw=await response.text();assert.equal(response.status,expected,`${method} ${url}: ${raw.slice(0,250)}`);return raw&&response.headers.get('content-type')?.includes('json')?JSON.parse(raw):raw;}
  let adminId='',courseId='',studentId='',record:any,originalAdmin:any,template:any,friendId='',code='';
  try{
    await t.test('create verified historical credentials without current course access',async()=>{
      adminId=(await req(admin,'/auth/login',{identifier:process.env.PBS_BOOTSTRAP_ADMIN_EMAIL,password:process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD,role:'admin'})).account.id;await req(admin,'/auth/password',{current:process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD,next:password});originalAdmin=await db.prepare('SELECT * FROM accounts WHERE id=?').get(adminId);
      courseId=(await req(admin,'/admin/courses',{title:'Revit MEP credential course',category:'BIM',fee:200000,published:true},'POST',201)).course.id;
      const imported=await req(admin,'/admin/past-students',{name:'Certificate Snapshot Name',email:'alumni-cert@example.invalid',phone:'9876543221',courseId,mode:'offline',completedAt:'2024-01-01',issuedAt:'2024-01-03',originalNumber:'PBS/ORIGINAL/2024/008',score:'',verified:true,requestKey:crypto.randomUUID()},'POST',201);studentId=imported.access.studentId;
      await req(student,'/auth/login',{identifier:imported.access.email,password:imported.access.password,role:'student'});await req(student,'/auth/password',{current:imported.access.password,next:password});
      const different=await req(admin,'/admin/past-students',{name:'Different learner',email:'different-cert@example.invalid',phone:'9876543222',courseId,mode:'offline',completedAt:'2024-01-01',issuedAt:'2024-01-03',score:'',verified:true,requestKey:crypto.randomUUID()},'POST',201);await req(other,'/auth/login',{identifier:different.access.email,password:different.access.password,role:'student'});await req(other,'/auth/password',{current:different.access.password,next:password});
      record=(await req(student,'/student/academy')).certificates[0];assert.equal(record.studentName,'Certificate Snapshot Name');
    });
    await t.test('admin PNG assets, duration and learning details are validated and preserve template settings',async()=>{
      template=await req(admin,'/admin/certificate-template');await req(student,'/admin/certificate-template',undefined,'GET',403);
      template=await req(admin,'/admin/certificate-template',{...template,logoImage:images.logo,signatureImage:images.signature,durationLabel:'84 recorded lessons + 10 live mentorship sessions',detailText:'Verified training in practical BIM workflows, MEP modelling and coordinated project documentation.'},'PUT');assert.equal(template.signatureImage,images.signature);
      await req(admin,'/admin/certificate-template',{...template,signatureImage:'data:image/svg+xml;base64,AAAA'},'PUT',400);assert.equal((await req(admin,'/admin/certificate-template')).signatureImage,images.signature);
      const {logoImage:_logo,signatureImage:_signature,detailText:_details,durationLabel:_duration,...oldFields}=template;await req(admin,'/admin/certificate-template',oldFields,'PUT');assert.equal((await req(admin,'/admin/certificate-template')).logoImage,images.logo);
    });
    await t.test('two signatories support independent PNGs, inheritance and partial updates without resetting saved credentials',async()=>{
      template=await req(admin,'/admin/certificate-template',{signer:'First authorised member',signerRole:'Academic Director',secondSigner:'Second authorised member',secondSignerRole:'Head of training',secondSignatureImage:images.logo},'PUT');
      assert.equal(template.signatureImage,images.signature);assert.equal(template.secondSignatureImage,images.logo);
      assert.equal(template.logoImage,images.logo);assert.equal(template.durationLabel,'84 recorded lessons + 10 live mentorship sessions');
      await req(student,'/admin/certificate-template',{secondSigner:'Unauthorised'},'PUT',403);
      await req(admin,'/admin/certificate-template',{secondSignatureImage:'data:image/svg+xml;base64,AAAA',signer:'Must roll back'},'PUT',400);
      assert.equal((await req(admin,'/admin/certificate-template')).signer,'First authorised member');
      const inherited=await req(admin,`/admin/certificate-template?courseId=${courseId}`);assert.equal(inherited.secondSigner,'Second authorised member');
      await req(admin,'/admin/certificate-template',{courseId,secondSigner:'Course second member'},'PUT');
      const scoped=await req(admin,`/admin/certificate-template?courseId=${courseId}`);assert.equal(scoped.secondSignatureImage,images.logo);assert.equal(scoped.signatureImage,images.signature);assert.equal(scoped.signer,'First authorised member');
      await req(admin,'/admin/certificate-template',{courseId,secondSigner:'Second authorised member'},'PUT');
      const {secondSigner:_name,secondSignerRole:_role,secondSignatureImage:_png,...legacy}=template;
      await req(admin,'/admin/certificate-template',legacy,'PUT');assert.equal((await req(admin,'/admin/certificate-template')).secondSignatureImage,images.logo);
      assert.deepEqual(await db.prepare('SELECT * FROM accounts WHERE id=?').get(adminId),originalAdmin);
    });
    await t.test('public verification and owner download use the identical standard PDF and certificate name',async()=>{
      await req(visitor,`/certificates/${record.id}/pdf`,undefined,'GET',401);await req(other,`/certificates/${record.id}/pdf`,undefined,'GET',404);await req(visitor,`/certificates/verify/${record.publicToken}/pdf`,undefined,'GET',404);
      await req(student,'/student/profile',{name:'Updated Profile Name',phone:'9876543221',headline:'Civil engineer',location:'',about:'',skills:[]},'PATCH');
      await req(student,`/student/certificates/${record.id}`,{published:true},'PATCH',204);
      const privatePdf=await req(student,`/certificates/${record.id}/pdf`),publicPdf=await req(visitor,`/certificates/verify/${record.publicToken}/pdf`);assert.deepEqual(privatePdf,publicPdf);
      const details=await pdfDetails(privatePdf);assert.equal(details.pages,1);assert.ok(Math.abs(details.width-793.70)<.1);assert.ok(Math.abs(details.height-595.28)<.1);assert.match(details.text,/Certificate Snapshot Name/);assert.match(details.text,/First authorised member/);assert.match(details.text,/Second authorised member/);assert.ok(!details.text.includes('Updated Profile Name'));assert.match(details.text,/PBS\/ORIGINAL\/2024\/008/);assert.match(details.text,/84 recorded lessons/);assert.match(details.text,/Verified training in practical BIM/);
      const verify=await req(visitor,`/certificates/verify/${record.publicToken}`);assert.equal(verify.studentName,'Certificate Snapshot Name');assert.ok(!JSON.stringify(verify).includes('alumni-cert@example.invalid'));
    });
    await t.test('credential visitors receive only public course information and old browser PDF links open the credential page',async()=>{
      const moduleId=(await req(admin,`/admin/courses/${courseId}/modules`,{title:'Public curriculum module'},'POST',201)).id;
      await req(admin,`/admin/courses/${courseId}/modules/${moduleId}/lessons`,{title:'Public lesson title',duration:'20 min',url:'https://private.example.invalid/secret-recording.mp4'},'POST',201);
      const verify=await req(visitor,`/certificates/verify/${record.publicToken}`);assert.equal(verify.course.title,'Revit MEP credential course');assert.deepEqual(verify.course.modules,['Public curriculum module']);
      const exposed=JSON.stringify(verify);assert.ok(!exposed.includes('secret-recording'));assert.ok(!exposed.includes('alumni-cert@example.invalid'));assert.ok(!exposed.includes('password_hash'));assert.ok(!exposed.includes('9876543221'));
      const redirect=await fetch(origin+`/api/certificates/verify/${record.publicToken}/pdf`,{redirect:'manual',headers:{Accept:'text/html'}});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),`/verify/certificate/${record.publicToken}`);
      const pdf=await fetch(origin+`/api/certificates/verify/${record.publicToken}/pdf`,{headers:{Accept:'application/pdf'}});assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.deepEqual(Buffer.from(await pdf.arrayBuffer()),await req(student,`/certificates/${record.id}/pdf`));
      await db.prepare('UPDATE courses SET published=0 WHERE id=?').run(courseId);assert.equal((await req(visitor,`/certificates/verify/${record.publicToken}`)).course,undefined);await db.prepare('UPDATE courses SET published=1 WHERE id=?').run(courseId);
    });
    await t.test('certificate email attaches that same PDF and records accepted, failed and uncertain results without duplicates',async()=>{
      const key=crypto.randomUUID();await req(student,`/certificates/${record.id}/mail`,{requestKey:key},'POST',409);
      await db.prepare('INSERT INTO microsoft_mail_connections VALUES (?,?,?,?,?)').run(adminId,'institution-mail@example.invalid','QA sender','opaque-test-cache',new Date().toISOString());
      const result=await req(student,`/certificates/${record.id}/mail`,{requestKey:key});assert.equal(result.status,'accepted');assert.equal(sent.length,1);const args=sent[0];assert.equal(args[2],'alumni-cert@example.invalid');assert.match(args[4],/Certificate Snapshot Name/);assert.equal(args[5].attachments[0].contentType,'application/pdf');assert.deepEqual(Buffer.from(args[5].attachments[0].contentBytes,'base64'),await req(student,`/certificates/${record.id}/pdf`));
      await req(student,`/certificates/${record.id}/mail`,{requestKey:key});assert.equal(sent.length,1);await req(other,`/certificates/${record.id}/mail`,{requestKey:crypto.randomUUID()},'POST',404);
      failing=true;const failureKey=crypto.randomUUID(),failed=await req(admin,`/certificates/${record.id}/mail`,{requestKey:failureKey});assert.equal(failed.status,'failed');assert.match(failed.error,/ErrorAccessDenied/);failing=false;await req(admin,`/certificates/${record.id}/mail`,{requestKey:failureKey});assert.equal(sent.length,1);
      uncertain=true;assert.equal((await req(student,`/certificates/${record.id}/mail`,{requestKey:crypto.randomUUID()})).status,'unknown');uncertain=false;
      assert.equal((await req(student,`/certificates/${record.id}/mail`)).deliveries.length,3);assert.ok((await req(admin,'/admin/mail')).deliveries.some((d:any)=>d.kind==='certificate'&&d.status==='failed'));assert.equal((await req(admin,'/admin/mail')).effectiveSenderId,adminId);
    });
    await t.test('alumni welcome appears for the verified owner and is dismissed persistently',async()=>{
      assert.equal((await req(student,'/student/alumni-welcome')).certificate.id,record.id);await req(other,`/student/alumni-welcome/${record.id}/seen`,{},'POST',404);await req(student,`/student/alumni-welcome/${record.id}/seen`,{},'POST',204);assert.equal((await req(student,'/student/alumni-welcome')).certificate,null);
    });
    await t.test('admin manages personal referral codes and verifies alumni fees without creating payment receipts',async()=>{
      await req(student,`/admin/students/${studentId}/referral-code`,{code:'PBS-ALUMNI-2024'},'POST',403);
      code=(await req(admin,`/admin/students/${studentId}/referral-code`,{code:'PBS-ALUMNI-2024',enabled:true,alumniPaidVerified:false,note:''})).code;await req(admin,'/admin/promotions',{kind:'coupon',code,title:'Duplicate code offer',percent:10,active:true},'POST',409);assert.equal((await req(student,'/student/referral-dashboard')).code,code);
      const application=await req(visitor,'/enrollments',{name:'Referred learner',email:'referred-cert@example.invalid',phone:'9876543223',courseId,code,amount:0},'POST',201);friendId=application.account.id;
      await req(admin,`/admin/enrollments/${application.enrollment.id}/decision`,{decision:'approved'});await issueReceipt(db,application.enrollment.id,application.enrollment.total,'Bank transfer','QA-REFERRAL-PAID',adminId);
      await reconcileReferrals(db);assert.match((await req(student,'/student/referral-dashboard')).referrals[0].reason,/referrer|referring/i);
      let controls=(await req(admin,'/admin/referral-codes')).codes.find((r:any)=>r.id===studentId);
      await req(admin,`/admin/students/${studentId}/referral-code`,{code,enabled:true,alumniPaidVerified:true,note:'',updatedAt:controls.updatedAt},'POST',400);
      await req(admin,`/admin/students/${studentId}/referral-code`,{code,enabled:true,alumniPaidVerified:true,note:'Verified original offline training fee ledger.',updatedAt:controls.updatedAt});
      const before=await req(student,'/student/referral-dashboard');assert.equal(before.program.rewardAmount,100000);assert.equal(before.referrals[0].status,'holding');assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM receipts r JOIN enrollments e ON e.id=r.enrollment_id WHERE e.account_id=?').get(studentId))!.n),0);
      const verifiedAt=(await db.prepare('SELECT verified_at FROM referral_code_controls WHERE account_id=?').get(studentId))!.verified_at;
      controls=(await req(admin,'/admin/referral-codes')).codes.find((r:any)=>r.id===studentId);await req(admin,`/admin/students/${studentId}/referral-code`,{code:'PBS-ALUMNI-NEW',enabled:false,alumniPaidVerified:true,note:controls.note,updatedAt:controls.updatedAt});assert.equal((await db.prepare('SELECT verified_at FROM referral_code_controls WHERE account_id=?').get(studentId))!.verified_at,verifiedAt);assert.equal((await req(student,'/student/referral-dashboard')).codeEnabled,false);
      await reconcileReferrals(db,new Date(Date.now()+8*86400000));await reconcileReferrals(db,new Date(Date.now()+9*86400000));assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM referral_wallet WHERE account_id=? AND kind='referral'").get(studentId))!.n),1);assert.equal((await req(student,'/student/referral-dashboard')).balance,100000);
      assert.deepEqual(await db.prepare('SELECT * FROM accounts WHERE id=?').get(adminId),originalAdmin);
    });
    await t.test('reviewed student reset removes new private records and preserves certificate branding and administrator credentials',async()=>{
      const preview=await req(admin,'/admin/reset-preview');await req(admin,'/admin/reset-students',{current:password,confirmation:'DELETE STUDENT DATA',reviewToken:preview.reviewToken});
      assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM certificate_mail_deliveries').get())!.n),0);assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM alumni_welcomes').get())!.n),0);assert.equal((await req(admin,'/admin/certificate-template')).signatureImage,images.signature);assert.equal((await req(admin,'/admin/certificate-template')).secondSignatureImage,images.logo);assert.deepEqual(await db.prepare('SELECT * FROM accounts WHERE id=?').get(adminId),originalAdmin);
    });
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();rmSync(directory,{recursive:true,force:true});}
});
