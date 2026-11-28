import type {Express} from 'express';
import {requireAccount} from './auth.js';
import {audit,saveSetting,setting} from './academy-data.js';
import {makeId,now,transaction,type Database,type WritableDatabase} from './database.js';
import {badRequest,conflict,emailAddress,limitAttempts,route} from './http.js';
import {verifyPassword} from './passwords.js';
import {seal} from './microsoft.js';
import {connectedMailSender,manualMailSender} from './mail-senders.js';
import {smtpCredentials,verifyTitan,type SmtpFactory} from './mail-transport.js';

async function revision(db:Database,adminId:string) {return String((await db.prepare('SELECT revision FROM mail_sender_preferences WHERE admin_id=?').get(adminId))?.revision||'');}
async function checkRevision(db:Database,adminId:string,expected:unknown) {if(typeof expected!=='string'||await revision(db,adminId)!==expected)throw conflict('The mailing connection changed. Refresh its settings and try again.');}
async function activate(db:Database,adminId:string,provider:'microsoft'|'titan') {
  await db.prepare('INSERT INTO mail_sender_preferences VALUES (?,?,?) ON CONFLICT(admin_id) DO UPDATE SET provider=excluded.provider,revision=excluded.revision').run(adminId,provider,makeId());
  const automation=JSON.parse(await setting(db,'mail_automation')||'{}');
  await saveSetting(db,'mail_automation',JSON.stringify({...automation,senderId:adminId}));
}
export function mountMailConnections(app:Express,db:WritableDatabase,hosted:boolean,factory?:SmtpFactory) {
  app.get('/api/admin/integrations/mail',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');
    const smtp=await db.prepare('SELECT email,connected_at AS connectedAt FROM smtp_mail_connections WHERE admin_id=?').get(admin.id);
    const microsoft=await db.prepare('SELECT profile_email AS email,profile_name AS name FROM microsoft_mail_connections WHERE admin_id=?').get(admin.id);
    const preference=await db.prepare('SELECT provider,revision FROM mail_sender_preferences WHERE admin_id=?').get(admin.id);
    const senderId=await manualMailSender(db,admin.id),companySender=senderId?await connectedMailSender(db,senderId):null;
    res.json({provider:preference?.provider||'microsoft',revision:preference?.revision||'',smtp:smtp?{...smtp,passwordSaved:true}:null,microsoft:microsoft||null,companySender,
      encryptionReady:/^[a-f0-9]{64}$/i.test(process.env.PBS_INTEGRATION_KEY||''),host:'smtpout.secureserver.net',port:465,secure:true});
  }));
  app.put('/api/admin/integrations/mail/titan',limitAttempts(6,hosted?db:undefined),route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');
    if(!await verifyPassword(String(req.body?.current||''),admin.passwordHash))throw badRequest('The current PBS administrator password is incorrect.');
    await checkRevision(db,admin.id,req.body?.revision);
    const email=emailAddress(req.body?.email);if(!/^[a-z0-9][a-z0-9._%+-]*@(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i.test(email))throw badRequest('Enter the full company mailbox email address.');
    let password=typeof req.body?.password==='string'?req.body.password:'';
    if(!password){const prior=await smtpCredentials(db,admin.id);if(prior.email!==email)throw badRequest('Enter the mailbox password when changing the email address.');password=prior.password;}
    if(password.length>1000||password.includes('\0'))throw badRequest('Enter a valid mailbox password.');
    const encrypted=seal(password);
    // Authentication only: never send a test or process the queue when saving credentials.
    await verifyTitan({email,password},factory);
    await transaction(db,async tx=>{
      await checkRevision(tx,admin.id,req.body.revision);
      await tx.prepare('INSERT INTO smtp_mail_connections VALUES (?,?,?,?) ON CONFLICT(admin_id) DO UPDATE SET email=excluded.email,password_sealed=excluded.password_sealed,connected_at=excluded.connected_at').run(admin.id,email,encrypted,now());
      await activate(tx,admin.id,'titan');await audit(tx,admin.id,'Titan mailing account connected','','SMTP credentials verified; selected for PBS mail.');
    });res.status(204).end();
  }));
  app.post('/api/admin/integrations/mail/provider',limitAttempts(6,hosted?db:undefined),route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');
    if(!await verifyPassword(String(req.body?.current||''),admin.passwordHash))throw badRequest('The current PBS administrator password is incorrect.');
    const provider=req.body?.provider;if(provider!=='microsoft'&&provider!=='titan')throw badRequest('Choose Titan SMTP or Microsoft 365.');
    await checkRevision(db,admin.id,req.body?.revision);
    if(provider==='titan')await verifyTitan(await smtpCredentials(db,admin.id),factory);
    else if(!await db.prepare('SELECT 1 FROM microsoft_mail_connections WHERE admin_id=?').get(admin.id))throw conflict('Connect a Microsoft 365 mailbox before selecting it. Titan mailboxes use Titan SMTP.');
    await transaction(db,async tx=>{await checkRevision(tx,admin.id,req.body.revision);await activate(tx,admin.id,provider);await audit(tx,admin.id,'PBS mailing provider selected','',provider==='titan'?'Titan SMTP':'Microsoft 365');});res.status(204).end();
  }));
  app.delete('/api/admin/integrations/mail/titan',limitAttempts(6,hosted?db:undefined),route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');
    if(!await verifyPassword(String(req.body?.current||''),admin.passwordHash))throw badRequest('The current PBS administrator password is incorrect.');
    await transaction(db,async tx=>{
      await checkRevision(tx,admin.id,req.body?.revision);
      const prior=await tx.prepare('SELECT provider FROM mail_sender_preferences WHERE admin_id=?').get(admin.id);
      await tx.prepare('DELETE FROM smtp_mail_connections WHERE admin_id=?').run(admin.id);
      await tx.prepare('INSERT INTO mail_sender_preferences VALUES (?,?,?) ON CONFLICT(admin_id) DO UPDATE SET revision=excluded.revision').run(admin.id,String(prior?.provider||'titan'),makeId());
      await audit(tx,admin.id,'Titan mailing account disconnected','','Saved SMTP credentials removed. No messages sent.');
    });res.status(204).end();
  }));
}
