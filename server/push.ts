import { createHash, ECDH, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Express, Request } from 'express';
import { generateVAPIDKeys, sendNotification, type PushSubscription, type RequestOptions } from 'web-push';
import { requireAccount, requestSessionHash } from './auth.js';
import { setting, saveSetting } from './academy-data.js';
import { type WritableDatabase, now, transaction } from './database.js';
import { badRequest, field, limitAttempts, RequestError, route } from './http.js';
import { seal, unseal } from './microsoft.js';
import { syncNotifications } from './notifications.js';

type VapidKeys = { publicKey: string; privateKey: string };
export type PushSender = (subscription: PushSubscription, payload: string, options: RequestOptions) => Promise<unknown>;
type DeliveryJob = { id: string; device_id: string; notification_id: string; created_at: string; attempts: number };
const keyName = 'mobile_push_keys:v1';
const ready = () => /^[a-f0-9]{64}$/i.test(process.env.PBS_INTEGRATION_KEY || '');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const allowedPushHost = (host: string) => host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
  host.endsWith('.push.services.mozilla.com') || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');

export function validPushSubscription(input: unknown): PushSubscription {
  const sub = input as Partial<PushSubscription> | undefined;
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 4096) throw badRequest('This browser supplied an invalid notification address.');
  let url: URL;
  try { url = new URL(sub.endpoint); } catch { throw badRequest('This browser supplied an invalid notification address.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !allowedPushHost(url.hostname)) {
    throw badRequest('This browser notification provider is not supported. Use Safari, Chrome, Edge or Firefox.');
  }
  const decode = (value: unknown, length: number) => typeof value === 'string' && /^[\w-]+$/.test(value) &&
    Buffer.from(value, 'base64url').length === length && Buffer.from(value, 'base64url').toString('base64url') === value;
  if (!decode(sub.keys?.auth, 16) || !decode(sub.keys?.p256dh, 65)) throw badRequest('This browser supplied invalid notification keys.');
  try { ECDH.convertKey(Buffer.from(sub.keys!.p256dh, 'base64url'), 'prime256v1'); }
  catch { throw badRequest('This browser supplied invalid notification keys.'); }
  return { endpoint: sub.endpoint, keys: { auth: sub.keys!.auth, p256dh: sub.keys!.p256dh } };
}

async function pushKeys(db: WritableDatabase): Promise<VapidKeys | undefined> {
  if (!ready()) return undefined;
  return transaction(db, async tx => {
    let encrypted = await setting(tx, keyName);
    if (!encrypted) {
      const generated = generateVAPIDKeys();
      await tx.prepare('INSERT OR IGNORE INTO academy_settings(key,value) VALUES (?,?)').run(keyName, seal(JSON.stringify(generated)));
      encrypted = await setting(tx, keyName);
    }
    try {
      const result = JSON.parse(unseal(encrypted)) as VapidKeys;
      return result.publicKey && result.privateKey ? result : undefined;
    } catch { return undefined; }
  });
}

const eligibleDevice = `SELECT d.*, a.role, a.must_change, s.expires_at, n.title, n.body, n.page, n.kind,
  n.read_at, n.created_at AS notification_created_at
  FROM push_devices d JOIN sessions s ON s.token_hash=d.session_hash AND s.account_id=d.account_id
  JOIN accounts a ON a.id=d.account_id JOIN notifications n ON n.id=? AND n.account_id=d.account_id
  WHERE d.id=? AND a.must_change=0 AND s.expires_at>?
  AND NOT EXISTS(SELECT 1 FROM account_controls c WHERE c.account_id=a.id AND c.status<>'active')
  AND NOT EXISTS(SELECT 1 FROM student_admissions sa WHERE sa.account_id=a.id AND sa.approved_at='')`;

// Page names, never provider URLs or credentials, are included in a push message.
export function pushLink(page: string) {
  const pages = new Set(['overview','students','courses','sessions','enrollments','payments','projects','placements','messages',
    'certificates','offers','curriculum','course-feedback','batches','notices','fees','project','downloads','reviews','portfolio','profile','referrals','roadmap','mobile-app']);
  return `/?page=${pages.has(page) ? page : 'overview'}`;
}

function safeFailure(error: unknown) {
  const status = Number((error as { statusCode?: number })?.statusCode || 0);
  if (status === 404 || status === 410) return { status, message: 'The device subscription expired. Enable alerts again on that device.' };
  if (status === 401 || status === 403) return { status, message: 'The notification service rejected the application key. Contact PBS administration.' };
  if (status === 429) return { status, message: 'The notification service is busy. PBS will retry.' };
  return { status, message: status ? `Notification service returned HTTP ${status}.` : 'The notification service could not be reached. PBS will retry.' };
}

export async function deliverPushQueue(db: WritableDatabase, sender: PushSender = sendNotification, limit = 30) {
  const keys = await pushKeys(db);
  const result = { accepted: 0, retrying: 0, failed: 0, skipped: 0 };
  if (!keys) return result;
  const deadline = Date.now() + 20_000;
  // Several serverless invocations can run together. Every delivery has an atomic lease.
  for (let index = 0; index < limit && Date.now() < deadline; index++) {
    const clock = Date.now(), token = randomUUID();
    const job = await transaction(db, async tx => {
      const row = await tx.prepare(`SELECT * FROM push_deliveries WHERE (status='pending' AND next_attempt<=?)
        OR (status='sending' AND lease_until<=?) ORDER BY created_at,id LIMIT 1`).get(clock, clock);
      if (!row) return undefined;
      await tx.prepare("UPDATE push_deliveries SET status='sending',lease_until=?,lease_token=?,attempts=attempts+1 WHERE id=?").run(clock + 60_000, token, row.id);
      return { ...row, attempts: Number(row.attempts) + 1 } as DeliveryJob;
    });
    if (!job) break;
    const device = await db.prepare(eligibleDevice).get(job.notification_id, job.device_id, Date.now());
    const expired = !device || device.read_at || Date.parse(String(job.created_at)) < clock - 24 * 60 * 60_000 ||
      (device.kind === 'session' && Date.parse(String(job.created_at)) < clock - 30 * 60_000);
    if (expired) {
      await db.prepare("UPDATE push_deliveries SET status='skipped',lease_until=0,error='' WHERE id=? AND lease_token=?").run(job.id, token);
      result.skipped++; continue;
    }
    const previews = Boolean(device.previews);
    const payload = JSON.stringify({ id: job.notification_id, title: previews ? String(device.title).slice(0, 120) : 'PBS learning portal',
      body: previews ? String(device.body).slice(0, 240) : 'You have a new update. Open PBS to view it.',
      url: pushLink(String(device.page)) });
    try {
      const subscription = validPushSubscription(JSON.parse(unseal(String(device.subscription))));
      await sender(subscription, payload, { vapidDetails: { ...keys, subject: 'mailto:info@pragmaticbim.com' },
        timeout: 8000, TTL: device.kind === 'session' ? 1800 : 86400, urgency: device.kind === 'session' ? 'high' : 'normal',
        topic: hash(String(job.notification_id)).slice(0, 32), contentEncoding: 'aes128gcm' });
      await db.prepare("UPDATE push_deliveries SET status='sent',sent_at=?,lease_until=0,error='' WHERE id=? AND lease_token=?").run(now(), job.id, token);
      await db.prepare("UPDATE push_devices SET last_delivery_at=?,error='' WHERE id=?").run(now(), device.id);
      result.accepted++;
    } catch (error) {
      const failure = safeFailure(error);
      if ([404,410].includes(failure.status)) {
        await db.prepare('DELETE FROM push_devices WHERE id=?').run(device.id);
        result.failed++;
      } else {
        const retry = job.attempts < 5 && (!failure.status || failure.status === 429 || failure.status >= 500);
        await db.prepare('UPDATE push_deliveries SET status=?,next_attempt=?,lease_until=0,error=? WHERE id=? AND lease_token=?')
          .run(retry ? 'pending' : 'failed', Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** job.attempts), failure.message, job.id, token);
        await db.prepare('UPDATE push_devices SET error=? WHERE id=?').run(failure.message, device.id);
        if (retry) result.retrying++; else result.failed++;
      }
    }
  }
  return result;
}

export async function runPushCycle(db: WritableDatabase, sender?: PushSender) {
  if (!ready()) return { synced: 0, accepted: 0, retrying: 0, failed: 0, skipped: 0 };
  await db.prepare('DELETE FROM push_devices WHERE session_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=?)').run(Date.now());
  // Oldest-checked devices first so scheduled runs rotate fairly through larger academies.
  const accounts = await db.prepare(`SELECT a.id,a.role FROM accounts a WHERE a.must_change=0
    AND EXISTS(SELECT 1 FROM push_devices d JOIN sessions s ON s.token_hash=d.session_hash WHERE d.account_id=a.id AND s.expires_at>?)
    AND NOT EXISTS(SELECT 1 FROM account_controls c WHERE c.account_id=a.id AND c.status<>'active')
    AND NOT EXISTS(SELECT 1 FROM student_admissions sa WHERE sa.account_id=a.id AND sa.approved_at='')
    ORDER BY (SELECT MIN(last_synced_at) FROM push_devices d WHERE d.account_id=a.id) LIMIT 50`).all(Date.now());
  const deadline = Date.now() + 20_000;
  let synced = 0;
  for (const account of accounts) {
    if (Date.now() >= deadline) break;
    await syncNotifications(db, { id: String(account.id), role: String(account.role) });
    await db.prepare('UPDATE push_devices SET last_synced_at=? WHERE account_id=?').run(now(), account.id);
    synced++;
  }
  const delivery = await deliverPushQueue(db, sender);
  await saveSetting(db, 'mobile_push_last_run', now());
  // A short delivery history is sufficient; the portal inbox remains the record of notifications.
  await db.prepare("DELETE FROM push_deliveries WHERE status IN ('sent','skipped','failed') AND created_at<?").run(new Date(Date.now() - 30 * 86400_000).toISOString());
  return { synced, ...delivery };
}

export function authorizedPushJob(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new RequestError(503, 'Scheduled notification processing is not configured.');
  if (!timingSafeEqual(Buffer.from(hash(req.get('authorization') || ''), 'hex'), Buffer.from(hash(`Bearer ${secret}`), 'hex'))) {
    throw new RequestError(401, 'Scheduled request is unauthorized.');
  }
}

export function mountPush(app: Express, db: WritableDatabase, hosted: boolean, sender?: PushSender) {
  app.get('/api/push/status', route(async (req, res) => {
    const account = await requireAccount(db, req), keys = await pushKeys(db);
    const devices = await db.prepare(`SELECT d.id,d.label,d.previews,d.created_at AS createdAt,d.last_delivery_at AS lastDeliveryAt,
      d.error,s.expires_at AS expiresAt,CASE WHEN d.session_hash=? THEN 1 ELSE 0 END AS currentSession
      FROM push_devices d JOIN sessions s ON s.token_hash=d.session_hash WHERE d.account_id=? AND s.expires_at>? ORDER BY d.updated_at DESC`).all(requestSessionHash(req), account.id, Date.now());
    res.json({ accountId: account.id, ready: Boolean(keys), publicKey: keys?.publicKey || '', devices: devices.map(d => ({ ...d, previews: Boolean(d.previews), currentSession: Boolean(d.currentSession) })) });
  }));
  app.post('/api/push/subscribe', limitAttempts(15, hosted ? db : undefined), route(async (req, res) => {
    const account = await requireAccount(db, req);
    if (!await pushKeys(db)) throw new RequestError(503, 'Phone notifications need the PBS server encryption setting. Contact administration.');
    const subscription = validPushSubscription(req.body?.subscription), endpointHash = hash(subscription.endpoint);
    const label = field(req.body?.label, 'device name', 80), sessionHash = requestSessionHash(req);
    // Build the initial inbox BEFORE this device is subscribed. Past alerts are never sent as a flood of new pushes.
    await syncNotifications(db, account);
    const id = await transaction(db, async tx => {
      await tx.prepare('DELETE FROM push_devices WHERE session_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=?)').run(Date.now());
      const existing = await tx.prepare('SELECT id,account_id,session_hash FROM push_devices WHERE endpoint_hash=?').get(endpointHash);
      if (existing && (existing.account_id !== account.id || existing.session_hash !== sessionHash)) await tx.prepare('DELETE FROM push_devices WHERE id=?').run(existing.id);
      const current = existing?.account_id === account.id && existing?.session_hash === sessionHash ? String(existing.id) : randomUUID();
      if (Number((await tx.prepare('SELECT COUNT(*) AS n FROM push_devices WHERE account_id=?').get(account.id))?.n) >= 10 && current !== existing?.id) throw badRequest('Remove an old device before enabling more than ten devices.');
      await tx.prepare(`INSERT INTO push_devices(id,account_id,session_hash,endpoint_hash,subscription,label,previews,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,label=excluded.label,previews=excluded.previews,updated_at=excluded.updated_at,error=''`)
        .run(current, account.id, sessionHash, endpointHash, seal(JSON.stringify(subscription)), label, req.body?.previews === true ? 1 : 0, now(), now());
      return current;
    });
    res.status(201).json({ id });
  }));
  app.delete('/api/push/devices/:id', route(async (req, res) => {
    const account = await requireAccount(db, req);
    await db.prepare('DELETE FROM push_devices WHERE id=? AND account_id=?').run(field(req.params.id, 'device', 80), account.id);
    res.status(204).end();
  }));
  app.post('/api/push/test', limitAttempts(3, hosted ? db : undefined), route(async (req, res) => {
    const account = await requireAccount(db, req), device = await db.prepare('SELECT id FROM push_devices WHERE id=? AND account_id=? AND session_hash=?')
      .get(field(req.body?.deviceId, 'device', 80), account.id, requestSessionHash(req));
    if (!device) throw badRequest('Enable phone notifications on this device first.');
    // A test is sent only to the device explicitly selected by its own signed-in account.
    const id = `push-test:${randomUUID()}`;
    await transaction(db, async tx => {
      await tx.prepare("INSERT INTO notifications(id,account_id,title,body,kind,page,created_at) VALUES (?,?,'PBS notifications are ready','Your device is connected to PBS updates.','app','mobile-app',?)").run(id, account.id, now());
      await tx.prepare('DELETE FROM push_deliveries WHERE notification_id=? AND device_id<>?').run(id, device.id);
    });
    const result = await deliverPushQueue(db, sender);
    const delivery = await db.prepare('SELECT status,error FROM push_deliveries WHERE notification_id=? AND device_id=?').get(id, device.id);
    res.json({ status: delivery?.status || 'expired', error: delivery?.error || '', accepted: result.accepted });
  }));
  app.get('/api/admin/push/diagnostics', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const devices = Number((await db.prepare('SELECT COUNT(*) AS n FROM push_devices d JOIN sessions s ON s.token_hash=d.session_hash WHERE s.expires_at>?').get(Date.now()))?.n || 0);
    const counts = await db.prepare('SELECT status,COUNT(*) AS count FROM push_deliveries GROUP BY status').all();
    res.json({ devices, counts, lastRun: await setting(db, 'mobile_push_last_run'), cronConfigured: Boolean(process.env.CRON_SECRET),
      schedule: 'Daily background check; event updates are sent after portal changes. For timely session reminders, schedule /api/jobs/push every 1–5 minutes using CRON_SECRET as a Bearer header.',
      errors: await db.prepare("SELECT label,error,last_delivery_at AS lastDeliveryAt FROM push_devices WHERE error<>'' ORDER BY updated_at DESC LIMIT 10").all() });
  }));
  app.get('/api/jobs/push', route(async (req, res) => { authorizedPushJob(req); res.json(await runPushCycle(db, sender)); }));
}
