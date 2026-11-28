import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parsePastStudentCsv,accessDetailsCsv} from '../src/live/past-student-csv.js';

test('contact CSV supports quoted names, BOM and phone strings and rejects ambiguous or invalid rows',()=>{
  const rows=parsePastStudentCsv('\uFEFFName,Email ID,Mobile Number\r\n"Learner, One",ONE@EXAMPLE.INVALID,0987654321\r\n"Learner ""Two""",two@example.invalid,+919876543211\r\n\r\n');
  assert.deepEqual(rows,[{name:'Learner, One',email:'one@example.invalid',phone:'0987654321'},{name:'Learner "Two"',email:'two@example.invalid',phone:'+919876543211'}]);
  for(const input of ['Name,Mobile\nOne,9876543210','Name,Email\nOne,bad-email','Name,Email\nOne,one@example.invalid\nAgain,ONE@example.invalid','Name,Email\n"Unclosed,one@example.invalid','Name,Email,Mobile Number\nOne,one@example.invalid,=SUM(A1)'])assert.throws(()=>parsePastStudentCsv(input));
  assert.throws(()=>parsePastStudentCsv('Name,Email\n'+Array.from({length:26},(_,i)=>`Name ${i},learner${i}@example.invalid`).join('\n')),/25/);
});

test('private login CSV quotes messages and protects contact fields against spreadsheet formulas',()=>{
  const csv=accessDetailsCsv([{name:'=2+2',email:'one@example.invalid',phone:'+919876543210',studentId:'PBS-QA',password:'PBS-private-one-time-password',signInUrl:'https://portal.example.invalid/',body:'Hello "Learner"\nSet your own new password.'}]);
  assert.match(csv,/"'=2\+2"/);assert.match(csv,/"'\+919876543210"/);assert.match(csv,/PBS-private-one-time-password/);assert.match(csv,/Hello ""Learner""\n/);assert.ok(!csv.includes('undefined'));
});

test('contact-only past-student imports create secure logins without training claims, resets or automatic mail',async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pbs-past-contacts-'));
  for(const key of ['VERCEL','PBS_TURSO_DATABASE_URL','PBS_TURSO_AUTH_TOKEN','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','PBS_PUBLIC_ORIGIN','BLOB_STORE_ID','BLOB_READ_WRITE_TOKEN','CRON_SECRET'])delete process.env[key];
  process.env.PBS_DATA_DIR=directory;process.env.PBS_BOOTSTRAP_CATALOG='0';process.env.PBS_BOOTSTRAP_ADMIN_EMAIL='contacts-admin@example.invalid';process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD='Contacts-bootstrap-password-2026!';process.env.PBS_INTEGRATION_KEY='7'.repeat(64);
  const {createPortalApp}=await import('../server/app.js'),{hashPassword}=await import('../server/passwords.js');
  const app=await createPortalApp(false),db=app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const addr=server.address(),origin=`http://127.0.0.1:${typeof addr==='object'?addr!.port:0}`;
  type Client={cookie:string};const admin={cookie:''},visitor={cookie:''},student={cookie:''};
  async function req(client:Client,url:string,body?:any,method=body===undefined?'GET':'POST',expected=200):Promise<any>{
    const response=await fetch(origin+'/api'+url,{method,headers:{'X-PBS-Request':'1',...(client.cookie?{Cookie:client.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.headers.get('set-cookie'))client.cookie=response.headers.get('set-cookie')!.split(';')[0];const text=await response.text();assert.equal(response.status,expected,`${method} ${url}: ${text.slice(0,180)}`);return text&&response.headers.get('content-type')?.includes('json')?JSON.parse(text):text;
  }
  const endpoint='/admin/past-students/contacts',csv='Name,Email ID,Mobile Number\nNew One,new-one@example.invalid,9876543210\nNew Two,new-two@example.invalid,9876543211\nExisting Row,existing@example.invalid,9876543212\nPending Row,pending@example.invalid,9876543213';
  const passwords=Object.fromEntries(parsePastStudentCsv(csv).map((row,i)=>[row.email,`PBS-isolated-temporary-password-${i}-2026!`]));
  const body={csv,source:'isolated-contacts.csv',requestKey:crypto.randomUUID(),passwords,confirmed:true};
  const next='Contacts-own-new-password-2026!';let originalAdmin:any,originalExisting:any,originalPending:any,result:any,adminId='';
  const count=async(table:string)=>Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get())!.n);
  try{
    await t.test('setup preserves existing identity snapshots',async()=>{
      adminId=(await req(admin,'/auth/login',{identifier:process.env.PBS_BOOTSTRAP_ADMIN_EMAIL,password:process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD,role:'admin'})).account.id;
      await req(admin,'/auth/password',{current:process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD,next});originalAdmin=await db.prepare('SELECT * FROM accounts WHERE id=?').get(adminId);
      const hash=await hashPassword('An-existing-student-password-2026!');
      for(const [id,email,pending] of [['qa-existing','existing@example.invalid',false],['qa-pending','pending@example.invalid',true]] as const){
        await db.prepare('INSERT INTO accounts(id,role,name,email,phone,roll_number,password_hash,must_change,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,'student','Saved profile name',email,'0987654300',id,hash,0,new Date().toISOString());
        await db.prepare('INSERT INTO student_admissions VALUES (?,?)').run(id,pending?'':new Date().toISOString());
        await db.prepare('INSERT INTO student_profiles(account_id,headline) VALUES (?,?)').run(id,'Saved qualification');
        await db.prepare('INSERT INTO portfolios VALUES (?,?,?,?,?)').run(id,'Saved headline','','',0);
      }
      originalExisting=await db.prepare('SELECT * FROM accounts WHERE id=?').get('qa-existing');originalPending=await db.prepare('SELECT * FROM accounts WHERE id=?').get('qa-pending');
    });
    await t.test('preview is authenticated, validates the entire file and makes no account writes',async()=>{
      await req(visitor,endpoint+'/preview',{csv},'POST',401);
      const preview=await req(admin,endpoint+'/preview',{csv});assert.equal(preview.total,4);assert.equal(preview.created,2);assert.equal(preview.existing,2);assert.equal(await count('accounts'),3);
      await req(admin,endpoint+'/import',{...body,confirmed:false},'POST',400);await req(admin,endpoint+'/import',{...body,csv:'Name,Email\nOne,one@example.invalid\nDuplicate,ONE@example.invalid'},'POST',400);
      const blocked='Name,Email ID\nAdmin,contacts-admin@example.invalid';assert.equal((await req(admin,endpoint+'/preview',{csv:blocked})).blocked,1);
      await req(admin,endpoint+'/import',{...body,csv:blocked},'POST',409);assert.equal(await count('accounts'),3);
    });
    await t.test('import creates two first-sign-in logins and lists all contacts with training details pending',async()=>{
      result=await req(admin,endpoint+'/import',body,'POST',201);assert.equal(result.total,4);assert.equal(result.created,2);assert.equal(result.existing,2);assert.equal(result.emailsSent,0);assert.equal(result.certificatesIssued,0);
      for(const row of result.rows.filter((r:any)=>r.created)){assert.equal(row.access.password,passwords[row.email]);assert.match(row.access.body,/Login process/);assert.match(row.access.body,/details later/);assert.ok(!row.access.body.includes('is verified'));}
      assert.equal(result.rows.find((r:any)=>r.email==='existing@example.invalid').access.password,undefined);assert.equal(result.rows.find((r:any)=>r.email==='pending@example.invalid').access,undefined);
      assert.equal((await req(admin,'/admin/past-students')).contacts.length,4);assert.equal((await req(admin,'/admin/past-students')).records.length,0);
      for(const table of ['certificates','enrollments','receipts','assessment_results','mail_outbox','access_deliveries','course_access_grants'])assert.equal(await count(table),0,table+' must remain empty');
      assert.deepEqual(await db.prepare('SELECT * FROM accounts WHERE id=?').get(adminId),originalAdmin);assert.deepEqual(await db.prepare('SELECT * FROM accounts WHERE id=?').get('qa-existing'),originalExisting);assert.deepEqual(await db.prepare('SELECT * FROM accounts WHERE id=?').get('qa-pending'),originalPending);assert.equal((await db.prepare('SELECT approved_at FROM student_admissions WHERE account_id=?').get('qa-pending'))!.approved_at,'');
      for(const row of await db.prepare('SELECT * FROM past_contact_imports').all())assert.ok(!JSON.stringify(row).includes('PBS-isolated-temporary-password'));
    });
    await t.test('retries and repeated files do not duplicate accounts or change passwords',async()=>{
      const retry=await req(admin,endpoint+'/import',body,'POST',201);assert.equal(retry.repeated,true);assert.equal(await count('accounts'),5);assert.equal(retry.rows[0].access.password,passwords['new-one@example.invalid']);
      await req(admin,endpoint+'/import',{...body,csv:csv+'\nAnother,another@example.invalid,9876543219'},'POST',409);
      const again=await req(admin,endpoint+'/import',{...body,requestKey:crypto.randomUUID()},'POST',201);assert.equal(again.created,0);assert.equal(again.rows[0].access.password,undefined);assert.equal(await count('accounts'),5);
    });
    await t.test('students must choose a new password and see an honest pending-training state',async()=>{
      const row=result.rows[0];await req(student,'/auth/login',{identifier:row.email,password:row.access.password,role:'student'});await req(student,'/student/workspace',undefined,'GET',403);
      await req(student,'/auth/password',{current:row.access.password,next});assert.equal((await req(student,'/student/workspace')).courses.length,0);
      const training=await req(student,'/student/past-training');assert.equal(training.awaitingDetails,true);assert.equal(training.records.length,0);assert.equal((await req(student,'/student/academy')).certificates.length,0);
      await req(student,endpoint+'/preview',{csv},'POST',403);await req(student,endpoint+'/import',body,'POST',403);
      const retry=await req(admin,endpoint+'/import',body,'POST',201);assert.equal(retry.rows[0].access.password,undefined,'a changed student password never gets reissued');
    });
    await t.test('verified training can be added later without changing the imported student login',async()=>{
      const row=result.rows[0],before=await db.prepare('SELECT * FROM accounts WHERE id=?').get(row.studentId);
      const courseId=(await req(admin,'/admin/courses',{title:'Historical Revit training',category:'BIM',fee:0,published:false},'POST',201)).course.id;
      const verified=await req(admin,'/admin/past-students',{name:row.name,email:row.email,phone:'9876543210',courseId,mode:'offline',completedAt:'2024-01-01',issuedAt:'2024-01-03',score:'',verified:true,requestKey:crypto.randomUUID()},'POST',201);
      assert.equal(verified.created,false);assert.equal(verified.access.password,undefined);assert.deepEqual(await db.prepare('SELECT * FROM accounts WHERE id=?').get(row.studentId),before);
      assert.equal((await req(admin,'/admin/past-students')).contacts.length,3);assert.equal((await req(student,'/student/past-training')).awaitingDetails,false);assert.equal(await count('enrollments'),0);
    });
    await t.test('inactive and deleted accounts remain protected by their existing account controls',async()=>{
      const row=result.rows[1],before=await db.prepare('SELECT password_hash FROM accounts WHERE id=?').get(row.studentId);
      await db.prepare('INSERT INTO account_controls VALUES (?,?,?,?)').run(row.studentId,'inactive','QA control',new Date().toISOString());
      assert.equal((await req(admin,endpoint+'/preview',{csv})).blocked,1);await req(admin,endpoint+'/import',{...body,requestKey:crypto.randomUUID()},'POST',409);
      assert.deepEqual(await db.prepare('SELECT password_hash FROM accounts WHERE id=?').get(row.studentId),before);
      await db.prepare("UPDATE account_controls SET status='deleted' WHERE account_id=?").run(row.studentId);
      assert.ok(!(await req(admin,'/admin/past-students')).contacts.some((c:any)=>c.accountId===row.studentId));
    });
    await t.test('reviewed reset clears contact import metadata while retaining the administrator',async()=>{
      const preview=await req(admin,'/admin/reset-preview');await req(admin,'/admin/reset-students',{current:next,confirmation:'DELETE STUDENT DATA',reviewToken:preview.reviewToken});
      for(const table of ['past_contact_import_rows','past_contact_imports','past_student_contacts'])assert.equal(await count(table),0);
      assert.deepEqual(await db.prepare('SELECT * FROM accounts WHERE id=?').get(adminId),originalAdmin);
    });
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();rmSync(directory,{recursive:true,force:true});}
});
