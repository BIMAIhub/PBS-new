import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { activeCourseAccess } from './access-controls.js';
import type { Express, Request } from 'express';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, now, transaction } from './database.js';
import { audit, saveSetting, setting } from './academy-data.js';
import { badRequest, conflict, field, limitAttempts, notFound, RequestError, route } from './http.js';
import { verifyPassword } from './passwords.js';
import { courseById, enrollmentById } from './records.js';
import { readMicrosoftContentLocation } from './microsoft-content.js';
import {marketingMime} from './mail-mime.js';
import { brandedEmail } from './email-layout.js';
import { publicBranding } from './branding.js';

export type MicrosoftPurpose = 'storage' | 'mail';
const scopesFor = (purpose: MicrosoftPurpose) => purpose === 'mail' ? ['User.Read', 'Mail.Send'] : ['User.Read', 'Files.ReadWrite'];
const connectionTable = (purpose: MicrosoftPurpose) => purpose === 'mail' ? 'microsoft_mail_connections' : 'microsoft_connections';
const configKey = (purpose: MicrosoftPurpose) => purpose === 'mail' ? 'microsoft_mail' : 'microsoft';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const encryptionReady = () => /^[a-f0-9]{64}$/i.test(process.env.PBS_INTEGRATION_KEY || '');

export function seal(value: string) {
  if (!encryptionReady()) throw new RequestError(503, 'Configure PBS_INTEGRATION_KEY before connecting Microsoft.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(process.env.PBS_INTEGRATION_KEY!, 'hex'), iv);
  const content = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString('base64url');
}

export function unseal(value: string) {
  if (!encryptionReady()) throw new RequestError(503, 'Microsoft encryption is unavailable. Contact PBS administration.');
  const bytes = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(process.env.PBS_INTEGRATION_KEY!, 'hex'), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}

async function config(db: Database, purpose: MicrosoftPurpose = 'storage') {
  const saved = await setting(db, configKey(purpose));
  return saved ? JSON.parse(saved) as { clientId: string; tenant: string; secret: string } : { clientId: '', tenant: 'common', secret: '' };
}

async function client(db: Database, adminId?: string, purpose: MicrosoftPurpose = 'storage') {
  const cfg = await config(db, purpose);
  if (!cfg.clientId || !cfg.secret) throw conflict('Save Microsoft app settings and connect your account first.');
  const app = new ConfidentialClientApplication({
    auth: { clientId: cfg.clientId, authority: `https://login.microsoftonline.com/${cfg.tenant}`, clientSecret: unseal(cfg.secret) },
    system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } },
  });
  if (adminId) {
    const row = await db.prepare(`SELECT token_cache FROM ${connectionTable(purpose)} WHERE admin_id = ?`).get(adminId);
    if (!row) throw conflict('Connect the Microsoft account that owns this course folder.');
    app.getTokenCache().deserialize(unseal(String(row.token_cache)));
  }
  return app;
}

async function accessToken(db: Database, adminId: string, purpose: MicrosoftPurpose = 'storage') {
  const app = await client(db, adminId, purpose);
  const account = (await app.getTokenCache().getAllAccounts())[0];
  if (!account) throw conflict('Reconnect your Microsoft account.');
  let result;
  try { result = await app.acquireTokenSilent({ scopes: scopesFor(purpose), account }); }
  catch { throw conflict('Microsoft consent expired. Reconnect the course owner account.'); }
  if (!result) throw conflict('Reconnect your Microsoft account.');
  await db.prepare(`UPDATE ${connectionTable(purpose)} SET token_cache = ? WHERE admin_id = ?`).run(seal(app.getTokenCache().serialize()), adminId);
  return result.accessToken;
}

async function graphToken(token: string, path: string, init: RequestInit = {}) {
  const headers=new Headers(init.headers);if(!headers.has('Content-Type'))headers.set('Content-Type','application/json');headers.set('Authorization',`Bearer ${token}`);
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init, headers, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { code?: string } };
    const code = /^[\w.]{1,100}$/.test(body.error?.code || '') ? body.error!.code : String(response.status);
    throw new RequestError(502, `Microsoft could not complete this action (${code}). Check account permissions and sharing policy.`);
  }
  return response.status === 204 || response.status === 202 ? {} : response.json();
}

export async function graph(db: Database, adminId: string, path: string, init: RequestInit = {}) {
  return graphToken(await accessToken(db, adminId), path, init);
}

export async function graphContentLocation(db: Database, adminId: string, path: string) {
  return readMicrosoftContentLocation(await accessToken(db, adminId), path);
}

export async function migrateMicrosoftRoles(db: WritableDatabase) {
  if(await setting(db,'microsoft_roles_v1'))return;
  await transaction(db,async tx=>{
    if(await setting(tx,'microsoft_roles_v1'))return;
    const previous=await setting(tx,'microsoft');
    if(previous&&!await setting(tx,'microsoft_mail'))await saveSetting(tx,'microsoft_mail',previous);
    await tx.prepare('INSERT OR IGNORE INTO microsoft_mail_connections SELECT * FROM microsoft_connections').run();
    await saveSetting(tx,'microsoft_roles_v1',now());
  });
}

const part = (value: string) => encodeURIComponent(value);
const itemPath = (driveId: string, itemId: string) => `/drives/${part(driveId)}/items/${part(itemId)}`;
export function portalOrigin(req: Request) {
  return process.env.PBS_PUBLIC_ORIGIN ? new URL(process.env.PBS_PUBLIC_ORIGIN).origin : `${process.env.VERCEL ? 'https' : req.protocol}://${req.get('host')}`;
}

export async function sendMicrosoftMail(db: Database, adminId: string, email: string, subject: string, body: string, options: { unsubscribeUrl?: string;attachments?:{name:string;contentType:string;contentBytes:string}[] } = {}) {
  const brand=await publicBranding(db),html=brandedEmail(brand,subject,body,options.unsubscribeUrl),token=await accessToken(db,adminId,'mail');
  if(options.unsubscribeUrl&&!options.attachments?.length){
    const profile=await graphToken(token,'/me?$select=mail,userPrincipalName');
    const mime=marketingMime({from:String(profile.mail||profile.userPrincipalName||''),name:brand.academyName,to:email,subject,text:`${body}\n\n${brand.academyName}\nUnsubscribe from offers and updates: ${options.unsubscribeUrl}\nSupport: ${brand.supportEmail}`,html,unsubscribeUrl:options.unsubscribeUrl});
    await graphToken(token,'/me/sendMail',{method:'POST',headers:{'Content-Type':'text/plain'},body:mime});return;
  }
  await graphToken(token, '/me/sendMail', { method: 'POST', body: JSON.stringify({
    message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: email } }],...(options.attachments?.length?{attachments:options.attachments.map(file=>({'@odata.type':'#microsoft.graph.fileAttachment',...file}))}:{}) },
    saveToSentItems: true,
  }) });
}
export async function checkMicrosoftMail(db:Database,adminId:string) {
  const token=await accessToken(db,adminId,'mail');let scopes:string[]=[];try{scopes=String(JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).scp||'').split(' ');}catch{}
  if(scopes.length&&!scopes.some(scope=>scope.toLowerCase()==='mail.send'))throw conflict('Reconnect the Microsoft mailing account and approve Mail.Send permission. Your OneDrive connection can stay separate.');
  const profile=await graphToken(token,'/me?$select=mail,userPrincipalName');return {email:String(profile.mail||profile.userPrincipalName||''),checkedAt:now(),status:'ready'};
}

export async function grantCourseAccess(db: WritableDatabase, enrollmentId: string, actorId: string, automatic = false, request: typeof graph = graph) {
  const enrollment = await enrollmentById(db, enrollmentId);
  if (enrollment.status !== 'approved') throw conflict('Approve enrollment before granting course access.');
  if (!await activeCourseAccess(db, enrollment.studentId, enrollment.courseId)) throw conflict('Reactivate the student and resume course access before granting OneDrive access.');
  if(await db.prepare("SELECT 1 FROM module_releases r JOIN modules m ON m.id=r.module_id WHERE m.course_id=? AND r.mode<>'open' LIMIT 1").get(enrollment.courseId))return{status:'portal_only',error:'This course uses scheduled modules. Students play released videos in PBS; sharing its entire OneDrive folder would expose locked modules.'};
  const storage = await db.prepare('SELECT * FROM course_storage WHERE course_id = ?').get(enrollment.courseId);
  if (!storage || (automatic && !storage.automatic)) return { status: 'unconfigured' };
  const claimed = await transaction(db, async tx => {
    if (!await activeCourseAccess(tx, enrollment.studentId, enrollment.courseId)) throw conflict('This student course access is paused or inactive.');
    const prior = await tx.prepare('SELECT * FROM course_access_grants WHERE enrollment_id = ?').get(enrollmentId);
    if (prior?.status === 'granted' && prior.email === enrollment.email) return false;
    if (prior?.status === 'granting' && Date.now() - Date.parse(String(prior.updated_at)) < 60_000) throw conflict('Access is being granted. Refresh shortly.');
    if (prior?.email && prior.email !== enrollment.email) throw conflict('The student email changed. Remove the previous permission in OneDrive before updating this access record.');
    await tx.prepare(`INSERT INTO course_access_grants (enrollment_id, email, status, updated_at)
      VALUES (?, ?, 'granting', ?) ON CONFLICT(enrollment_id) DO UPDATE SET status = 'granting', error = '', updated_at = excluded.updated_at`)
      .run(enrollmentId, enrollment.email, now());
    return true;
  });
  if (!claimed) return { status: 'granted' };
  try {
    const result = await request(db, String(storage.admin_id), `${itemPath(String(storage.drive_id), String(storage.item_id))}/invite`, {
      method: 'POST', body: JSON.stringify({ recipients: [{ email: enrollment.email }], roles: ['read'],
        requireSignIn: true, sendInvitation: false }),
    }) as { value?: { id?: string; error?: unknown }[] };
    const permissions = result.value?.filter(permission => permission.id && !permission.error) || [];
    if (!permissions.length || result.value?.some(permission => permission.error)) throw new Error('Microsoft did not confirm the student invitation. Check the folder permissions before retrying.');
    await db.prepare(`UPDATE course_access_grants SET status = 'granted', permission_ids = ?, error = '', updated_at = ? WHERE enrollment_id = ?`)
      .run(JSON.stringify(permissions.map(permission => permission.id)), now(), enrollmentId);
    await audit(db, actorId, 'OneDrive access granted', enrollmentId, enrollment.email);
    return { status: 'granted' };
  } catch (error) {
    const detail = error instanceof RequestError ? error.message : 'Microsoft access could not be confirmed. Check OneDrive permissions and retry.';
    await db.prepare("UPDATE course_access_grants SET status = 'failed', error = ?, updated_at = ? WHERE enrollment_id = ?").run(detail, now(), enrollmentId);
    await audit(db, actorId, 'OneDrive access needs attention', enrollmentId, detail);
    return { status: 'failed', error: detail };
  }
}

export function mountMicrosoft(app: Express, db: WritableDatabase, hosted: boolean) {
  const purposeOf = (value: unknown): MicrosoftPurpose => { if (value === undefined || value === '' || value === 'storage') return 'storage'; if (value === 'mail') return 'mail'; throw badRequest('Choose OneDrive storage or email.'); };
  app.get('/api/admin/integrations/microsoft', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const cfg = await config(db);
    const mailCfg = await config(db, 'mail');
    const mailConnected = await db.prepare('SELECT profile_email AS email,profile_name AS name,connected_at AS connectedAt FROM microsoft_mail_connections WHERE admin_id=?').get(admin.id);
    const connected = await db.prepare(`SELECT profile_email AS email, profile_name AS name, connected_at AS connectedAt
      FROM microsoft_connections WHERE admin_id = ?`).get(admin.id);
    const storage = await db.prepare(`SELECT s.course_id AS courseId, s.drive_id AS driveId, s.item_id AS itemId,
      s.item_name AS itemName, s.web_url AS webUrl, s.automatic, (c.admin_id IS NOT NULL) AS connected
      FROM course_storage s LEFT JOIN microsoft_connections c ON s.admin_id = c.admin_id`).all();
    res.json({ encryptionReady: encryptionReady(), configured: Boolean(cfg.clientId && cfg.secret), clientId: cfg.clientId,
      tenant: cfg.tenant, secretSaved: Boolean(cfg.secret), redirectUri: `${portalOrigin(req)}/api/integrations/microsoft/callback`,
      connected, mail: {clientId:mailCfg.clientId,tenant:mailCfg.tenant,secretSaved:Boolean(mailCfg.secret),configured:Boolean(mailCfg.clientId&&mailCfg.secret),connected:mailConnected},
      storage: storage.map(row => ({ ...row, automatic: Boolean(row.automatic), connected: Boolean(row.connected) })) });
  }));

  app.put('/api/admin/integrations/microsoft/config', limitAttempts(6, hosted ? db : undefined), route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const purpose = purposeOf(req.body?.purpose);
    if (!await verifyPassword(String(req.body?.current || ''), admin.passwordHash)) throw badRequest('The current password is incorrect.');
    const clientId = field(req.body?.clientId, 'Microsoft client ID', 36);
    const tenant = field(req.body?.tenant, 'Microsoft tenant', 100);
    if (!/^[a-f0-9-]{36}$/i.test(clientId) || !/^(common|organizations|consumers|[a-f0-9-]{36}|[a-z0-9.-]+\.onmicrosoft\.com)$/i.test(tenant)) throw badRequest('Enter a valid Microsoft application and tenant ID.');
    const prior = await config(db, purpose);
    const secret = field(req.body?.secret, 'client secret', 1000, false);
    if (!secret && (!prior.secret || prior.clientId !== clientId)) throw badRequest('Enter the application client secret.');
    await transaction(db, async tx => {
      await saveSetting(tx, configKey(purpose), JSON.stringify({ clientId, tenant, secret: secret ? seal(secret) : prior.secret }));
      if (prior.clientId !== clientId || prior.tenant !== tenant) {
        await tx.prepare(`DELETE FROM ${connectionTable(purpose)}`).run();
        await tx.prepare('DELETE FROM microsoft_oauth WHERE state_hash IN (SELECT state_hash FROM microsoft_oauth_roles WHERE purpose=?)').run(purpose);
        await tx.prepare('DELETE FROM microsoft_oauth_roles WHERE purpose=?').run(purpose);
      }
      await audit(tx, admin.id, 'Microsoft application settings saved', '', 'Application credentials updated.');
    });
    res.status(204).end();
  }));

  app.post('/api/admin/integrations/microsoft/connect', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const purpose = purposeOf(req.body?.purpose);
    const app = await client(db, undefined, purpose);
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const redirectUri = `${portalOrigin(req)}/api/integrations/microsoft/callback`;
    await db.prepare('DELETE FROM microsoft_oauth WHERE expires_at < ? OR admin_id = ?').run(Date.now(), admin.id);
    await db.prepare('INSERT INTO microsoft_oauth VALUES (?, ?, ?, ?, ?)').run(digest(state), admin.id, seal(verifier), redirectUri, Date.now() + 10 * 60_000);
    await db.prepare('INSERT INTO microsoft_oauth_roles VALUES (?,?)').run(digest(state),purpose);
    const url = await app.getAuthCodeUrl({ scopes: scopesFor(purpose), redirectUri, state, codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256', prompt: 'select_account' });
    res.json({ url });
  }));

  app.get('/api/integrations/microsoft/callback', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const state = field(req.query.state, 'authorization state', 100);
    const row = await transaction(db, async tx => {
      const row = await tx.prepare('SELECT * FROM microsoft_oauth WHERE state_hash = ? AND admin_id = ? AND expires_at > ?').get(digest(state), admin.id, Date.now());
      if (!row) throw badRequest('This Microsoft connection request expired. Start again from Integrations.');
      await tx.prepare('DELETE FROM microsoft_oauth WHERE state_hash = ?').run(digest(state));
      const role = await tx.prepare('SELECT purpose FROM microsoft_oauth_roles WHERE state_hash=?').get(digest(state));
      await tx.prepare('DELETE FROM microsoft_oauth_roles WHERE state_hash=?').run(digest(state));
      return {...row,redirect_uri:String(row.redirect_uri),verifier:String(row.verifier),purpose:purposeOf(role?.purpose)};
    });
    if (req.query.error) return res.redirect('/?integration=declined');
    try {
      const app = await client(db, undefined, row.purpose);
      const result = await app.acquireTokenByCode({ code: field(req.query.code, 'authorization code', 8000), scopes: scopesFor(row.purpose),
        redirectUri: String(row.redirect_uri), codeVerifier: unseal(String(row.verifier)) });
      if (!result?.account) throw new Error('Missing Microsoft account.');
      const profile = await graphToken(result.accessToken, '/me?$select=displayName,mail,userPrincipalName');
      await db.prepare(`INSERT INTO ${connectionTable(row.purpose)} VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(admin_id) DO UPDATE SET profile_email = excluded.profile_email, profile_name = excluded.profile_name,
        token_cache = excluded.token_cache, connected_at = excluded.connected_at`)
        .run(admin.id, profile.mail || profile.userPrincipalName || result.account.username, profile.displayName || 'Microsoft account', seal(app.getTokenCache().serialize()), now());
      await audit(db, admin.id, 'Microsoft account connected', admin.id, profile.displayName || 'Microsoft account');
      res.redirect(`/?page=integrations&integration=connected&purpose=${row.purpose}`);
    } catch { res.redirect('/?integration=failed'); }
  }));

  app.delete('/api/admin/integrations/microsoft', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const purpose = purposeOf(req.query.purpose);
    await db.prepare(`DELETE FROM ${connectionTable(purpose)} WHERE admin_id = ?`).run(admin.id);
    await audit(db, admin.id, 'Microsoft account disconnected', admin.id, 'Previously granted OneDrive permissions remain in Microsoft.');
    res.status(204).end();
  }));

  app.post('/api/admin/integrations/microsoft/reset', limitAttempts(5,hosted?db:undefined), route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');
    if(!await verifyPassword(String(req.body?.current||''),admin.passwordHash))throw badRequest('The current password is incorrect.');
    const purpose=purposeOf(req.body?.purpose);
    await transaction(db,async tx=>{
      await tx.prepare(`DELETE FROM ${connectionTable(purpose)}`).run();
      await tx.prepare('DELETE FROM academy_settings WHERE key=?').run(configKey(purpose));
      await tx.prepare('DELETE FROM microsoft_oauth WHERE state_hash IN (SELECT state_hash FROM microsoft_oauth_roles WHERE purpose=?)').run(purpose);
      await tx.prepare('DELETE FROM microsoft_oauth_roles WHERE purpose=?').run(purpose);
      await audit(tx,admin.id,'Microsoft setup cleared',purpose,'Saved app configuration and account connection removed. External files and permissions preserved.');
    });res.status(204).end();
  }));

  app.get('/api/admin/integrations/microsoft/items', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const driveId = field(req.query.driveId, 'drive ID', 250, false);
    const itemId = field(req.query.itemId, 'folder ID', 250, false);
    const path = driveId && itemId ? itemPath(driveId, itemId) : '/me/drive/root';
    const skip = field(req.query.skip, 'continuation', 8000, false);
    const result = await graph(db, admin.id, `${path}/children?${new URLSearchParams({ '$select': 'id,name,folder,video,parentReference,webUrl', '$top': '100', ...(skip ? { '$skiptoken': skip } : {}) })}`);
    const next = result['@odata.nextLink'] ? new URL(result['@odata.nextLink']).searchParams.get('$skiptoken') || '' : '';
    res.json({ items: result.value || [], next });
  }));

  app.put('/api/admin/courses/:id/storage', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    await courseById(db, req.params.id);
    const driveId = field(req.body?.driveId, 'OneDrive drive ID', 250);
    const itemId = field(req.body?.itemId, 'OneDrive item ID', 250);
    const existing = await db.prepare('SELECT drive_id, item_id FROM course_storage WHERE course_id = ?').get(req.params.id);
    if (existing && (existing.drive_id !== driveId || existing.item_id !== itemId) && await db.prepare("SELECT 1 FROM course_access_grants g JOIN enrollments e ON e.id = g.enrollment_id WHERE e.course_id = ? AND g.status = 'granted'").get(req.params.id)) {
      throw conflict('This course already has grants. Remove the old permissions in Microsoft before changing its folder.');
    }
    const item = await graph(db, admin.id, `${itemPath(driveId, itemId)}?$select=id,name,webUrl,folder,video`);
    if (!item.folder && !item.video) throw badRequest('Choose a course folder or video from OneDrive.');
    await db.prepare(`INSERT INTO course_storage VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(course_id) DO UPDATE SET admin_id = excluded.admin_id, drive_id = excluded.drive_id,
      item_id = excluded.item_id, item_name = excluded.item_name, web_url = excluded.web_url, automatic = excluded.automatic`)
      .run(req.params.id, admin.id, driveId, itemId, item.name, item.webUrl || '', Number(req.body?.automatic === true));
    await audit(db, admin.id, 'Course OneDrive folder saved', req.params.id, item.name);
    res.status(204).end();
  }));

  app.post('/api/admin/enrollments/:id/access', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const result = await grantCourseAccess(db, req.params.id, admin.id);
    if (result.status === 'unconfigured') throw conflict('Map a OneDrive folder to this course in Integrations.');
    res.json(result);
  }));
}
