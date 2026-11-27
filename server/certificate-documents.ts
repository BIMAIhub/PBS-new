import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Express } from 'express';
import { findAccount,requireAccount } from './auth.js';
import { type Database,type WritableDatabase,makeId,now,transaction } from './database.js';
import { audit,certificateRecords } from './academy-data.js';
import { brandingLogoData,imageExtension,publicBranding } from './branding.js';
import { documentStamp } from './document-stamp.js';
import { badRequest,conflict,field,limitAttempts,notFound,RequestError,route } from './http.js';
import { manualMailSender,mailTemplates,templateVariables } from './mail.js';
import { portalOrigin,sendMicrosoftMail } from './microsoft.js';
import { fillMailTemplate } from '../src/live/mail-templates.js';
import { buildCertificatePdf } from '../src/live/certificate-pdf.js';
import type { CertificateRecord } from '../src/live/academy-types.js';

let fonts:Promise<string[]>|undefined;
const cached=new Map<string,Buffer>();
const certificateFilename=(record:CertificateRecord)=>`${record.id.replace(/[^a-zA-Z0-9._-]/g,'-').slice(0,120)}.pdf`;
async function serverFonts(){fonts??=Promise.all(['LiberationSans-Regular.ttf','LiberationSans-Bold.ttf','LiberationSerif-Regular.ttf','LiberationSerif-Italic.ttf'].map(async file=>(await readFile(path.join(process.cwd(),'src/assets/pdf-fonts',file))).toString('base64'))).catch(error=>{fonts=undefined;throw error;});return fonts;}
export async function certificateRecord(db:Database,id:string) {
  const row=await db.prepare('SELECT account_id FROM certificates WHERE id=?').get(id);if(!row)throw notFound('This certificate is unavailable.');
  const record=(await certificateRecords(db,String(row.account_id))).find(r=>r.id===id);if(!record)throw notFound('This certificate is unavailable.');return record;
}
export async function certificateFile(db:Database,record:CertificateRecord,origin:string) {
  const brand=await publicBranding(db),stamp=await documentStamp(db),logo=record.template.logoImage||await brandingLogoData(db);
  const page=await db.prepare('SELECT duration FROM course_pages WHERE course_id=?').get(record.courseId),duration=String(page?.duration||'');
  const url=`${origin}/verify/certificate/${encodeURIComponent(record.publicToken)}`;
  const key=createHash('sha256').update(JSON.stringify({record,brand,stamp,logo,duration,url})).digest('hex');const previous=cached.get(key);if(previous)return previous;
  const qr=record.published&&!record.revokedAt?await (await import('qrcode')).toDataURL(url,{margin:1,width:200,errorCorrectionLevel:'M'}):undefined;
  const pdf=await buildCertificatePdf(record,brand,{logo,qr,verificationUrl:url,duration,fonts:await serverFonts()},stamp);
  pdf.setCreationDate(new Date(record.issuedAt));pdf.setFileId(key.slice(0,32));
  const bytes=Buffer.from(pdf.output('arraybuffer'));if(cached.size>=20)cached.delete(cached.keys().next().value!);cached.set(key,bytes);return bytes;
}
function png(input:unknown,label:string) {
  const data=field(input,label,190000,false);if(!data)return '';
  const match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);if(!match)throw badRequest(`Choose a transparent PNG for ${label}.`);
  const bytes=Buffer.from(match[1],'base64');if(bytes.length>125000)throw badRequest(`Keep ${label} below 125 KB.`);imageExtension(bytes,'image/png');return data;
}
export async function saveCertificateDesign(db:Database,courseId:string,body:Record<string,unknown>) {
  const keys=['logoImage','signatureImage','detailText','durationLabel'];if(!keys.some(key=>body[key]!==undefined))return;
  const existing=await db.prepare('SELECT * FROM certificate_design_assets WHERE course_id=?').get(courseId);
  await db.prepare(`INSERT INTO certificate_design_assets VALUES (?,?,?,?,?,?) ON CONFLICT(course_id) DO UPDATE SET logo_image=excluded.logo_image,signature_image=excluded.signature_image,detail_text=excluded.detail_text,duration_label=excluded.duration_label,revision=excluded.revision`)
    .run(courseId,body.logoImage===undefined?String(existing?.logo_image||''):png(body.logoImage,'certificate logo'),body.signatureImage===undefined?String(existing?.signature_image||''):png(body.signatureImage,'signature'),body.detailText===undefined?String(existing?.detail_text||''):field(body.detailText,'certificate details',320,false),body.durationLabel===undefined?String(existing?.duration_label||''):field(body.durationLabel,'training duration',100,false),makeId());
}
export function mountCertificateDocuments(app:Express,db:WritableDatabase,hosted:boolean,sendMail:typeof sendMicrosoftMail=sendMicrosoftMail) {
  app.get('/api/certificates/:id/pdf',limitAttempts(40,hosted?db:undefined),route(async(req,res)=>{
    const account=await requireAccount(db,req),record=await certificateRecord(db,req.params.id);if(account.role!=='admin'&&record.studentId!==account.id)throw notFound('This certificate is private.');
    res.type('application/pdf').set('Content-Disposition',`${req.query.download==='1'?'attachment':'inline'}; filename="${certificateFilename(record)}"`).send(await certificateFile(db,record,portalOrigin(req)));
  }));
  app.get('/api/certificates/verify/:token/pdf',limitAttempts(40,hosted?db:undefined),route(async(req,res)=>{
    const row=await db.prepare('SELECT id FROM certificates WHERE public_token=? AND published=1').get(req.params.token);if(!row)throw notFound('This certificate is private or unavailable.');
    const record=await certificateRecord(db,String(row.id));res.type('application/pdf').set('Content-Disposition',`${req.query.download==='1'?'attachment':'inline'}; filename="${certificateFilename(record)}"`).send(await certificateFile(db,record,portalOrigin(req)));
  }));
  app.get('/api/certificates/:id/mail',route(async(req,res)=>{
    const account=await requireAccount(db,req),record=await certificateRecord(db,req.params.id);if(account.role!=='admin'&&record.studentId!==account.id)throw notFound('This certificate is private.');
    res.json({deliveries:await db.prepare('SELECT id,status,error,created_at AS createdAt,sent_at AS sentAt FROM certificate_mail_deliveries WHERE certificate_id=? ORDER BY created_at DESC LIMIT 10').all(record.id)});
  }));
  app.post('/api/certificates/:id/mail',limitAttempts(8,hosted?db:undefined),route(async(req,res)=>{
    const actor=await requireAccount(db,req),record=await certificateRecord(db,req.params.id);if(actor.role!=='admin'&&record.studentId!==actor.id)throw notFound('This certificate is private.');if(record.revokedAt)throw conflict('A revoked certificate cannot be sent as a valid credential.');
    const account=await findAccount(db,record.studentId);if(!account||account.accountStatus!=='active')throw conflict('This student account is inactive.');
    const requestKey=field(req.body?.requestKey,'delivery reference',80);if(!/^[\w-]{16,80}$/.test(requestKey))throw badRequest('Open a fresh certificate email action.');
    const sender=await manualMailSender(db,actor.role==='admin'?actor.id:'');if(!sender)throw conflict('PBS has not connected a mailing account. Administrators can connect it in OneDrive & email. You can still download or share the PDF file.');
    const prepared=await transaction(db,async tx=>{
      const prior=await tx.prepare('SELECT * FROM certificate_mail_deliveries WHERE request_key=?').get(requestKey);if(prior){if(prior.certificate_id!==record.id||prior.account_id!==account.id)throw conflict('This email request belongs to another certificate.');return {id:String(prior.id),prior};}
      const id=makeId();await tx.prepare('INSERT INTO certificate_mail_deliveries(id,certificate_id,account_id,sender_id,request_key,email,status,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id,record.id,account.id,sender,requestKey,account.email,'pending',now());return {id};
    });if(prepared.prior){res.json({id:prepared.id,status:prepared.prior.status,error:prepared.prior.error});return;}
    let status='accepted',error='',transmitting=false;
    try{
      const bytes=await certificateFile(db,record,portalOrigin(req));if(bytes.length>2800000)throw badRequest('This certificate is too large for direct email. Download and share the PDF file instead.');
      const template=(await mailTemplates(db)).find(t=>t.id==='certificate')!,vars=await templateVariables(db,portalOrigin(req),account.id,{name:record.studentName,course:record.courseTitle});
      transmitting=true;await sendMail(db,sender,account.email,fillMailTemplate(template.subject,vars),fillMailTemplate(template.body,vars),{attachments:[{name:certificateFilename(record),contentType:'application/pdf',contentBytes:bytes.toString('base64')}]});
    }catch(problem){status=problem instanceof RequestError||!transmitting?'failed':'unknown';error=problem instanceof RequestError?problem.message:transmitting?'Delivery could not be confirmed. Ask PBS to check Microsoft Sent Items before resending.':'The certificate PDF could not be prepared. Refresh and retry, or ask PBS to check document assets.';}
    await transaction(db,async tx=>{await tx.prepare('UPDATE certificate_mail_deliveries SET status=?,error=?,sent_at=? WHERE id=?').run(status,error,status==='accepted'?now():'',prepared.id);await audit(tx,actor.id,'Certificate PDF email',record.id,status);});
    res.json({id:prepared.id,status,error});
  }));
  app.get('/api/student/alumni-welcome',route(async(req,res)=>{
    const account=await requireAccount(db,req,'student'),row=await db.prepare(`SELECT h.certificate_id FROM legacy_training h JOIN certificates c ON c.id=h.certificate_id WHERE h.account_id=? AND c.revoked_at='' AND NOT EXISTS(SELECT 1 FROM alumni_welcomes w WHERE w.account_id=h.account_id AND w.certificate_id=h.certificate_id) ORDER BY h.created_at DESC LIMIT 1`).get(account.id);
    res.json({certificate:row?await certificateRecord(db,String(row.certificate_id)):null});
  }));
  app.post('/api/student/alumni-welcome/:id/seen',route(async(req,res)=>{
    const account=await requireAccount(db,req,'student');if(!await db.prepare('SELECT 1 FROM legacy_training WHERE account_id=? AND certificate_id=?').get(account.id,req.params.id))throw notFound('This past training is unavailable.');
    await db.prepare('INSERT OR IGNORE INTO alumni_welcomes VALUES (?,?,?)').run(account.id,req.params.id,now());res.status(204).end();
  }));
}
