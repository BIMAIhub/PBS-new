import {mountMailHistory,releaseExpiredMailLocks} from './mail-history.js';
import {mountMailDeliverability} from './mail-deliverability.js';
import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, now, transaction } from './database.js';
import { audit, saveSetting, setting } from './academy-data.js';
import { publicBranding } from './branding.js';
import { brandedEmail, escapeHtml } from './email-layout.js';
import { checkMicrosoftMail,portalOrigin, sendMicrosoftMail } from './microsoft.js';
import { badRequest, conflict, emailAddress, field, limitAttempts, notFound, RequestError, route } from './http.js';
import { defaultMailTemplates, fillMailTemplate } from '../src/live/mail-templates.js';
import type { MailAutomation, MailTemplate, MailTemplateId } from '../src/live/engagement-types.js';

export async function mailTemplates(db: Database): Promise<MailTemplate[]> {
  const saved = JSON.parse(await setting(db, 'mail_templates') || '[]') as MailTemplate[];
  return defaultMailTemplates.map(template => ({ ...template, ...saved.find(item => item.id === template.id), marketing: template.marketing }));
}
export async function mailAutomation(db: Database): Promise<MailAutomation> {
  return { enabled: true, senderId: '', welcome: true, certificate: true, referral_credit: true, payout_paid:true, ...JSON.parse(await setting(db, 'mail_automation') || '{}') };
}
async function sender(db: Database) {
  const settings = await mailAutomation(db);
  if (!settings.enabled) return '';
  if (settings.senderId) return await db.prepare('SELECT 1 FROM microsoft_mail_connections WHERE admin_id = ?').get(settings.senderId) ? settings.senderId : '';
  const connections = await db.prepare('SELECT admin_id FROM microsoft_mail_connections LIMIT 2').all();
  return connections.length === 1 ? String(connections[0].admin_id) : '';
}
export async function manualMailSender(db:Database,preferred='') {
  if(preferred&&await db.prepare('SELECT 1 FROM microsoft_mail_connections WHERE admin_id=?').get(preferred))return preferred;
  const options=await mailAutomation(db);if(options.senderId&&await db.prepare('SELECT 1 FROM microsoft_mail_connections WHERE admin_id=?').get(options.senderId))return options.senderId;
  const connections=await db.prepare('SELECT admin_id FROM microsoft_mail_connections LIMIT 2').all();return connections.length===1?String(connections[0].admin_id):'';
}
const money = (value: number) => `INR ${(value / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export async function templateVariables(db: Database, origin: string, accountId = '', extra: Record<string, string> = {}) {
  const brand = await publicBranding(db);
  const account = accountId ? await db.prepare('SELECT name, email FROM accounts WHERE id = ?').get(accountId) : undefined;
  const course = accountId ? await db.prepare(`SELECT c.title, e.total - COALESCE((SELECT SUM(r.amount) FROM receipts r WHERE r.enrollment_id = e.id),0) AS balance
    FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.account_id = ? AND e.status = 'approved' ORDER BY e.approved_at DESC LIMIT 1`).get(accountId) : undefined;
  const historical=!course&&accountId?await db.prepare('SELECT c.course_title AS title FROM legacy_training h JOIN certificates c ON c.id=h.certificate_id WHERE h.account_id=? ORDER BY h.created_at DESC LIMIT 1').get(accountId):undefined;
  return { name: String(account?.name || 'Learner'), email: String(account?.email || ''), academy: brand.academyName,
    app_url: `${origin}/app`, sign_in_url: origin, explore_url: `${origin}/explore`, course: String(course?.title || historical?.title || 'your PBS course'),
    balance: money(Number(course?.balance || 0)), reward: '', message: '', ...extra };
}
async function ensureContact(db: Database, email: string, name: string, consent = false) {
  await db.prepare(`INSERT OR IGNORE INTO mail_contacts (email, name, consent, unsubscribe_token, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(email, name, Number(consent), randomBytes(24).toString('base64url'), now());
  if (consent) await db.prepare('UPDATE mail_contacts SET consent = 1, name = ?, updated_at = ? WHERE email = ?').run(name, now(), email);
}
export async function queueAutomation(db: WritableDatabase, kind: 'welcome' | 'certificate' | 'referral_credit' | 'payout_paid', eventKey: string, accountId: string, origin: string, extra: Record<string, string> = {}, manualSenderId = '') {
  const settings = await mailAutomation(db), adminId = manualSenderId
    ? (await db.prepare('SELECT 1 FROM microsoft_mail_connections WHERE admin_id=?').get(manualSenderId) ? manualSenderId : '') : await sender(db);
  if ((!manualSenderId && !settings[kind]) || !adminId) return { queued: false, reason: 'Choose a connected Microsoft sender in the email settings.' };
  const recipient = await db.prepare(`SELECT a.name, a.email FROM accounts a WHERE a.id = ? AND a.role = 'student'
    AND NOT EXISTS(SELECT 1 FROM account_controls c WHERE c.account_id = a.id AND c.status <> 'active')`).get(accountId);
  if (!recipient) return { queued: false, reason: 'Student account is unavailable.' };
  const template = (await mailTemplates(db)).find(item => item.id === kind)!;
  const variables = await templateVariables(db, origin, accountId, extra);
  const queued=await transaction(db, async tx => {
    if(!await tx.prepare("SELECT 1 FROM accounts a WHERE a.id=? AND a.role='student' AND NOT EXISTS(SELECT 1 FROM account_controls c WHERE c.account_id=a.id AND c.status<>'active')").get(accountId))return false;
    await tx.prepare(`INSERT OR IGNORE INTO mail_outbox (id,event_key,admin_id,account_id,email,name,subject,body,origin,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(makeId(), eventKey, adminId, accountId, String(recipient.email), String(recipient.name), fillMailTemplate(template.subject, variables), fillMailTemplate(template.body, variables), origin, now());
    return true;
  });
  return { queued, ...(!queued?{reason:'Student account is unavailable.'}:{}) };
}

export async function processMailQueue(db: WritableDatabase, adminId?: string, limit = 10, transport: typeof sendMicrosoftMail = sendMicrosoftMail) {
  await releaseExpiredMailLocks(db);
  const rows = await db.prepare(`SELECT * FROM mail_outbox WHERE status = 'pending' ${adminId ? 'AND admin_id = ?' : ''} ORDER BY created_at LIMIT ?`).all(...(adminId ? [adminId] : []), Math.min(20, Math.max(1, limit)));
  const result = { accepted: 0, failed: 0, uncertain: 0, skipped: 0 };
  for (const row of rows) {
    const claimed=await transaction(db,async tx=>{const claim=await tx.prepare("UPDATE mail_outbox SET status='sending' WHERE id=? AND status='pending'").run(row.id);if(!claim.changes)return false;await tx.prepare('INSERT INTO mail_delivery_locks VALUES (?,?,?) ON CONFLICT(outbox_id) DO UPDATE SET lease_token=excluded.lease_token,expires_at=excluded.expires_at').run(row.id,makeId(),Date.now()+120000);return true;});
    if(!claimed)continue;
    let active = !row.account_id || Boolean(await db.prepare(`SELECT 1 FROM accounts a WHERE a.id = ? AND NOT EXISTS(SELECT 1 FROM account_controls c WHERE c.account_id=a.id AND c.status<>'active')`).get(row.account_id));
    if (String(row.event_key).startsWith('certificate:')) active = active && Boolean(await db.prepare("SELECT 1 FROM certificates WHERE id=? AND revoked_at=''").get(String(row.event_key).slice('certificate:'.length)));
    const contact = await db.prepare('SELECT consent, unsubscribed, unsubscribe_token FROM mail_contacts WHERE email = ?').get(row.email);
    if (!active || row.marketing && (!contact?.consent || contact.unsubscribed)) {
      await db.prepare("UPDATE mail_outbox SET status='skipped', error=? WHERE id=?").run(active ? 'Recipient opted out of marketing.' : 'Account is inactive.', row.id); await db.prepare('DELETE FROM mail_delivery_locks WHERE outbox_id=?').run(row.id); result.skipped++; continue;
    }
    let status = 'accepted', error = '';
    try {
      await transport(db, String(row.admin_id), String(row.email), String(row.subject), String(row.body),
        row.marketing ? { unsubscribeUrl: `${row.origin}/api/mail/unsubscribe/${contact!.unsubscribe_token}` } : {});
      result.accepted++;
    } catch (problem) {
      const confirmedFailure = problem instanceof RequestError && [400,401,403,404,409,422,429].includes(problem.status);
      status = confirmedFailure ? 'failed' : 'unknown';
      error = problem instanceof RequestError ? problem.message : 'Delivery is uncertain. Check Microsoft Sent Items before creating another message.';
      if (confirmedFailure) result.failed++; else result.uncertain++;
    }
    await transaction(db,async tx=>{await tx.prepare('UPDATE mail_outbox SET status=?,error=?,sent_at=? WHERE id=?').run(status,error,now(),row.id);await tx.prepare('DELETE FROM mail_delivery_locks WHERE outbox_id=?').run(row.id);});
  }
  return result;
}

export function mountPublicMail(app: Express, db: WritableDatabase) {
  app.get('/api/mail/unsubscribe/:token', route(async (req, res) => {
    const contact = await db.prepare('SELECT 1 FROM mail_contacts WHERE unsubscribe_token = ?').get(req.params.token);
    if (!contact) throw notFound('This mailing preference link is unavailable.');
    const brand = await publicBranding(db);
    res.type('html').send(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PBS mailing preferences</title><body style="font-family:Arial;background:#F4F7FA;padding:32px;color:#152c42"><main style="max-width:540px;margin:auto"><h1>${escapeHtml(brand.academyName)}</h1><h2>Mailing preferences</h2><p>Stop course offers and promotional updates. Enrollment, payment and credential messages remain available.</p><form method="post"><button style="background:${brand.primaryColor};color:white;border:0;border-radius:8px;padding:14px 20px">Unsubscribe from offers and updates</button></form></main></body></html>`);
  }));
  app.post('/api/mail/unsubscribe/:token', route(async (req, res) => {
    const result = await db.prepare('UPDATE mail_contacts SET unsubscribed=1,updated_at=? WHERE unsubscribe_token=?').run(now(), req.params.token);
    if (!result.changes) throw notFound('This mailing preference link is unavailable.');
    res.type('html').send('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preferences saved</title><body style="font-family:Arial;background:#F4F7FA;color:#152c42;padding:32px"><h1>You have been unsubscribed</h1><p>PBS will stop sending you offers and promotional updates. Essential account and course messages remain available.</p></body></html>');
  }));
}

const campaignSql = `SELECT c.id,c.title,c.template_id AS templateId,c.subject,c.body,c.message,c.status,c.created_at AS createdAt,c.revision,
  (SELECT COUNT(*) FROM mail_campaign_recipients r WHERE r.campaign_id=c.id) AS total,
  (SELECT COUNT(*) FROM mail_outbox o WHERE o.campaign_id=c.id AND o.status='accepted') AS accepted,
  (SELECT COUNT(*) FROM mail_outbox o WHERE o.campaign_id=c.id AND o.status='failed') AS failed,
  (SELECT COUNT(*) FROM mail_outbox o WHERE o.campaign_id=c.id AND o.status='pending') AS pending,
  (SELECT COUNT(*) FROM mail_outbox o WHERE o.campaign_id=c.id AND o.status='skipped') AS skipped,
  (SELECT COUNT(*) FROM mail_outbox o WHERE o.campaign_id=c.id AND o.status IN ('sending','unknown')) AS uncertain FROM mail_campaigns c`;

export function mountMail(app: Express, db: WritableDatabase, hosted: boolean) {
  mountMailHistory(app,db);mountMailDeliverability(app,db);
  app.post('/api/admin/mail/check-connection',route(async(req,res)=>{const admin=await requireAccount(db,req,'admin'),id=await manualMailSender(db,admin.id);if(!id)throw conflict('Connect or select the institution mailing account in OneDrive & email.');res.json(await checkMicrosoftMail(db,id));}));
  app.get('/api/admin/mail', route(async (req, res) => {
    const admin=await requireAccount(db, req, 'admin');await releaseExpiredMailLocks(db);
    res.json({ effectiveSenderId:await manualMailSender(db,admin.id),templates: await mailTemplates(db), automation: await mailAutomation(db), scheduledProcessing: Boolean(process.env.CRON_SECRET),
      senders: await db.prepare('SELECT m.admin_id AS id,m.profile_email AS email,m.profile_name AS name FROM microsoft_mail_connections m').all(),
      campaigns: (await db.prepare(`${campaignSql} ORDER BY c.created_at DESC LIMIT 100`).all()).map(c=>({...c,status:c.status==='queued'&&!Number(c.pending)?Number(c.uncertain)||Number(c.failed)?'attention':'completed':c.status})),
      deliveries: await db.prepare(`SELECT * FROM (
        SELECT id,email,name,subject,status,error,created_at AS createdAt,sent_at AS sentAt,'campaign' AS kind FROM mail_outbox
        UNION ALL SELECT d.id,d.email,c.student_name AS name,'Certificate PDF' AS subject,d.status,d.error,d.created_at AS createdAt,d.sent_at AS sentAt,'certificate' AS kind FROM certificate_mail_deliveries d JOIN certificates c ON c.id=d.certificate_id
        UNION ALL SELECT d.id,d.email,a.name,'Student access details' AS subject,d.status,d.error,d.created_at AS createdAt,CASE WHEN d.status='accepted' THEN d.created_at ELSE '' END AS sentAt,'access' AS kind FROM access_deliveries d JOIN accounts a ON a.id=d.account_id
      ) ORDER BY createdAt DESC LIMIT 100`).all() });
  }));
  app.put('/api/admin/mail/templates/:id', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin'), id = req.params.id as MailTemplateId;
    if (!defaultMailTemplates.some(t => t.id === id)) throw notFound('This email template is unavailable.');
    const templates = await mailTemplates(db), next = templates.map(t => t.id === id ? { ...t, subject: field(req.body?.subject, 'subject', 160), body: field(req.body?.body, 'message', 6000) } : t);
    await transaction(db, async tx => { await saveSetting(tx,'mail_templates',JSON.stringify(next)); await audit(tx,admin.id,'Email template updated',id,''); }); res.json(next);
  }));
  app.put('/api/admin/mail/automation', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    for (const key of ['enabled','welcome','certificate','referral_credit']) if (typeof req.body?.[key] !== 'boolean') throw badRequest('Choose valid email automation settings.');
    const next = { enabled: Boolean(req.body?.enabled), senderId: field(req.body?.senderId, 'sender', 80, false), welcome: Boolean(req.body?.welcome), certificate: Boolean(req.body?.certificate), referral_credit: Boolean(req.body?.referral_credit),payout_paid:req.body?.payout_paid!==false };
    if (next.senderId && !await db.prepare('SELECT 1 FROM microsoft_mail_connections WHERE admin_id=?').get(next.senderId)) throw badRequest('Choose a connected Microsoft sender.');
    await transaction(db, async tx => { await saveSetting(tx,'mail_automation',JSON.stringify(next)); await audit(tx,admin.id,'Email automation settings saved','',next.enabled ? 'Enabled' : 'Paused'); }); res.json(next);
  }));
  app.post('/api/admin/mail/preview', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const variables = await templateVariables(db, portalOrigin(req), '', { name: 'Recipient name', message: field(req.body?.message || 'Your academy update appears here.', 'message', 3000) });
    const subject = fillMailTemplate(field(req.body?.subject, 'subject', 160), variables), body = fillMailTemplate(field(req.body?.body, 'body', 6000), variables);
    res.json({ html: brandedEmail(await publicBranding(db), subject, body, req.body?.marketing ? `${portalOrigin(req)}/explore` : '') });
  }));
  app.post('/api/admin/mail/campaigns', limitAttempts(10, hosted ? db : undefined), route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const template = defaultMailTemplates.find(t => t.id === req.body?.templateId); if (!template) throw badRequest('Choose a message template.');
    const mode = field(req.body?.recipientMode, 'recipient group', 20); if (!['students','selected','external','leads','alumni'].includes(mode)) throw badRequest('Choose a recipient group.');
    if ((template.marketing || mode === 'external') && req.body?.consentConfirmed !== true) throw badRequest('Confirm that these recipients agreed to receive academy offers and updates.');
    if (['external','leads'].includes(mode) && !template.marketing) throw badRequest('Use an offer, update or custom template for external contacts.');
    const title = field(req.body?.title,'campaign name',120), subject=field(req.body?.subject,'subject',160), body=field(req.body?.body,'message',6000), message=field(req.body?.message,'update details',3000,false);
    const recipients: { email:string; name:string; accountId:string; courseId?:string }[] = [];
    if (mode === 'external') {
      const lines = field(req.body?.externalRecipients,'recipients',15000).split(/[\n;]+/).filter(Boolean); if(lines.length>500) throw badRequest('Use up to 500 recipients per campaign.');
      for(const line of lines) { const [email,name='Learner'] = line.split(',').map(v=>v.trim()); recipients.push({email:emailAddress(email),name:name.slice(0,100),accountId:''}); }
    } else if (mode==='leads') {
      const ids=Array.isArray(req.body?.leadIds)?[...new Set(req.body.leadIds.filter((v:unknown)=>typeof v==='string'))] as string[]:[];
      if(!ids.length||ids.length>500)throw badRequest('Select up to 500 brochure leads who opted in.');
      const rows=await db.prepare(`SELECT l.email,l.name,l.course_id FROM course_leads l JOIN mail_contacts mc ON mc.email=l.email COLLATE NOCASE WHERE l.id IN (${ids.map(()=>'?').join(',')}) AND l.consent=1 AND mc.consent=1 AND mc.unsubscribed=0 ORDER BY l.updated_at DESC`).all(...ids);
      for(const row of rows)recipients.push({email:String(row.email),name:String(row.name),accountId:'',courseId:String(row.course_id)});
    } else if (mode==='alumni') {
      const rows=await db.prepare(`SELECT DISTINCT a.id,a.name,a.email FROM accounts a WHERE a.role='student' AND (EXISTS(SELECT 1 FROM legacy_training h WHERE h.account_id=a.id) OR EXISTS(SELECT 1 FROM past_student_contacts p WHERE p.account_id=a.id)) AND NOT EXISTS(SELECT 1 FROM account_controls c WHERE c.account_id=a.id AND c.status<>'active') ORDER BY a.name LIMIT 501`).all();
      if(rows.length>500)throw badRequest('Use a group of up to 500 past students.');
      for(const row of rows)recipients.push({email:String(row.email),name:String(row.name),accountId:String(row.id)});
    } else {
      const ids: string[] = Array.isArray(req.body?.studentIds) ? req.body.studentIds.filter((id:unknown)=>typeof id==='string').slice(0,500) : [];
      if (mode === 'selected' && !ids.length) throw badRequest('Choose at least one student.');
      const rows = await db.prepare(`SELECT a.id,a.email,a.name FROM accounts a WHERE a.role='student' AND EXISTS(SELECT 1 FROM enrollments e WHERE e.account_id=a.id AND e.status='approved') AND NOT EXISTS(SELECT 1 FROM account_controls c WHERE c.account_id=a.id AND c.status<>'active') ${mode==='selected'?`AND a.id IN (${ids.map(()=>'?').join(',')})`:''} ORDER BY a.name LIMIT 501`).all(...(mode==='selected'?ids:[]));
      if(mode==='students'&&rows.length>500) throw badRequest('Choose a group of up to 500 students.');
      for(const row of rows) if(mode==='students'||ids.includes(String(row.id))) recipients.push({email:String(row.email),name:String(row.name),accountId:String(row.id)});
    }
    const unique = [...new Map(recipients.map(r=>[r.email.toLowerCase(),r])).values()]; if(!unique.length) throw badRequest('Choose at least one recipient.');
    const id=makeId(),revision=makeId();
    await transaction(db,async tx=>{
      await tx.prepare('INSERT INTO mail_campaigns (id,title,template_id,subject,body,message,admin_id,marketing,revision,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,title,template.id,subject,body,message,admin.id,Number(template.marketing),revision,now());
      for(const r of unique) { if(r.accountId&&!await tx.prepare("SELECT 1 FROM accounts WHERE id=? AND role='student'").get(r.accountId))throw conflict('A selected student was removed. Review the audience again.'); await ensureContact(tx,r.email,r.name,mode==='leads'?false:template.marketing); await tx.prepare('INSERT INTO mail_campaign_recipients VALUES (?,?,?,?)').run(id,r.email,r.name,r.accountId); if(r.courseId)await tx.prepare('INSERT INTO campaign_lead_links VALUES (?,?,?)').run(id,r.email,r.courseId); }
      await audit(tx,admin.id,'Email campaign drafted',id,`${unique.length} recipients`);
    }); res.status(201).json({id,revision,total:unique.length});
  }));
  app.post('/api/admin/mail/campaigns/:id/send',limitAttempts(20,hosted?db:undefined),route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');
    const sendingAccount=await manualMailSender(db,admin.id);if(!sendingAccount)throw conflict('Connect or select the PBS mailing account in OneDrive & email before sending.');
    const campaign=await db.prepare('SELECT * FROM mail_campaigns WHERE id=?').get(req.params.id); if(!campaign) throw notFound('This campaign is unavailable.');
    if(campaign.revision!==req.body?.revision) throw conflict('Refresh the campaign before sending.');
    const recipients=await db.prepare('SELECT * FROM mail_campaign_recipients WHERE campaign_id=?').all(req.params.id);
    const prepared=[];
    for(const r of recipients) {
      const interest=await db.prepare('SELECT c.title FROM campaign_lead_links l JOIN courses c ON c.id=l.course_id WHERE l.campaign_id=? AND l.email=?').get(campaign.id,r.email);
      const vars=await templateVariables(db,portalOrigin(req),String(r.account_id),{name:String(r.name),email:String(r.email),message:String(campaign.message),...(interest?{course:String(interest.title)}:{})});
      prepared.push({r,subject:fillMailTemplate(String(campaign.subject),vars),body:fillMailTemplate(String(campaign.body),vars)});
    }
    await transaction(db,async tx=>{
      const current=await tx.prepare('SELECT status FROM mail_campaigns WHERE id=?').get(req.params.id);if(!current)throw notFound('This campaign was removed.');if(current.status==='cancelled')throw conflict('This campaign is cancelled.');
      for(const {r,subject,body} of prepared){if(!await tx.prepare('SELECT 1 FROM mail_campaign_recipients WHERE campaign_id=? AND email=?').get(campaign.id,r.email))continue;await tx.prepare('INSERT OR IGNORE INTO mail_outbox (id,event_key,campaign_id,admin_id,account_id,email,name,subject,body,marketing,origin,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(makeId(),`campaign:${campaign.id}:${r.email}`,campaign.id,sendingAccount,r.account_id,r.email,r.name,subject,body,campaign.marketing,portalOrigin(req),now());}
      await tx.prepare("UPDATE mail_campaigns SET status='queued' WHERE id=?").run(req.params.id);
      await audit(tx,admin.id,'Email campaign queued',req.params.id,`${recipients.length} recipient snapshots`);
    });
    res.json(await processMailQueue(db,sendingAccount));
  }));
  app.post('/api/admin/mail/process',limitAttempts(30,hosted?db:undefined),route(async(req,res)=>{const admin=await requireAccount(db,req,'admin'),sendingAccount=await manualMailSender(db,admin.id);if(!sendingAccount)throw conflict('Connect or select the PBS mailing account before processing queued emails.');res.json(await processMailQueue(db,sendingAccount));}));
  app.post('/api/admin/mail/campaigns/:id/cancel',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');
    await transaction(db,async tx=>{
      const campaign=await tx.prepare('SELECT revision FROM mail_campaigns WHERE id=?').get(req.params.id);
      if(!campaign)throw notFound('This campaign is unavailable.');
      if(campaign.revision!==req.body?.revision)throw conflict('Refresh the campaign before cancelling.');
      await tx.prepare("UPDATE mail_campaigns SET status='cancelled',revision=? WHERE id=?").run(makeId(),req.params.id);
      await tx.prepare("UPDATE mail_outbox SET status='skipped',error='Campaign cancelled by admin.' WHERE campaign_id=? AND status='pending'").run(req.params.id);
      await audit(tx,admin.id,'Email campaign cancelled',req.params.id,'Messages already sending or accepted are unchanged.');
    });res.json({cancelled:true});
  }));
  app.post('/api/admin/mail/deliveries/:id/retry',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');const row=await db.prepare('SELECT status,admin_id FROM mail_outbox WHERE id=?').get(req.params.id);
    if(!row) throw notFound('This delivery is unavailable.'); if(row.status!=='failed') throw conflict('Only confirmed failures can be retried. Check Sent Items for uncertain delivery.');
    const sendingAccount=await manualMailSender(db,admin.id);if(!sendingAccount)throw conflict('Reconnect or select a mailing account before retrying.');
    await db.prepare("UPDATE mail_outbox SET status='pending',error='',admin_id=? WHERE id=? AND status='failed'").run(sendingAccount,req.params.id);res.json({queued:true});
  }));
}
