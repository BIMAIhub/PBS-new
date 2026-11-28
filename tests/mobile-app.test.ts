import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { signInApproved } from './admission-fixtures.js';

test('mobile push is private, durable and bound to the existing account session', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pbs-mobile-'));
  for (const key of ['VERCEL','PBS_TURSO_DATABASE_URL','PBS_TURSO_AUTH_TOKEN','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','PBS_PUBLIC_ORIGIN','BLOB_STORE_ID','BLOB_READ_WRITE_TOKEN']) delete process.env[key];
  process.env.PBS_DATA_DIR = directory; process.env.PBS_BOOTSTRAP_CATALOG = '0';
  process.env.PBS_BOOTSTRAP_ADMIN_EMAIL = 'mobile-admin@example.invalid'; process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD = 'Mobile-bootstrap-only-758!';
  process.env.PBS_INTEGRATION_KEY = 'e'.repeat(64); process.env.CRON_SECRET = 'isolated-mobile-job-secret';
  const { createPortalApp } = await import('../server/app.js');
  const { deliverPushQueue, runPushCycle, validPushSubscription, pushLink } = await import('../server/push.js');
  const { generateRequestDetails } = await import('web-push');
  const { unseal } = await import('../server/microsoft.js');
  type Delivery = { endpoint: string; payload: any; options: any };
  const delivered: Delivery[] = []; let providerFailure = 0;
  const sender = async (subscription: any, payload: string, options: any) => {
    if (providerFailure) throw { statusCode: providerFailure, body: `PRIVATE PROVIDER RESPONSE ${subscription.endpoint}` };
    // Exercise the actual VAPID signature and encrypted Web Push request generation, without contacting a real device.
    const request = generateRequestDetails(subscription, payload, options);
    assert.equal(request.headers['Content-Encoding'], 'aes128gcm'); assert.ok(request.headers.Authorization); assert.ok(request.body);
    delivered.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload), options });
  };
  const app = await createPortalApp(false, { pushSender: sender });
  const db = app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(), origin = `http://127.0.0.1:${typeof address === 'object' ? address!.port : 0}`;
  type Client = { cookie: string }; const admin: Client = { cookie: '' }, learner: Client = { cookie: '' }, other: Client = { cookie: '' }, visitor: Client = { cookie: '' };
  async function req(client: Client, url: string, body?: any, method = body === undefined ? 'GET' : 'POST', expected = 200) {
    const response = await fetch(origin + '/api' + url, { method, headers: { 'X-PBS-Request': '1', ...(client.cookie ? { Cookie: client.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.headers.get('set-cookie')) client.cookie = response.headers.get('set-cookie')!.split(';')[0];
    const text = await response.text(); assert.equal(response.status, expected, `${method} ${url}: ${text.slice(0, 300)}`);
    return text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
  }
  function subscription(suffix: string) {
    const ec = createECDH('prime256v1'); ec.generateKeys();
    return { endpoint: `https://fcm.googleapis.com/fcm/send/isolated-${suffix}`, keys: { p256dh: ec.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  }
  const firstSubscription = subscription('learner'), adminSubscription = subscription('admin'), otherSubscription = subscription('other');
  let course = '', module = '', locked = '', learnerId = '', otherId = '', adminId = '', deviceId = '', adminDeviceId = '';
  let originalAccounts: any;
  const addNotification = async (id: string, accountId = learnerId, readAt = '') => db.prepare('INSERT INTO notifications(id,account_id,title,body,kind,page,created_at,read_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, accountId, 'Private assignment update', 'Private student details for this account only.', 'assignment', 'project', new Date().toISOString(), readAt);
  try {
    await t.test('isolated setup preserves real authentication behavior', async () => {
      adminId = (await req(admin, '/auth/login', { identifier: process.env.PBS_BOOTSTRAP_ADMIN_EMAIL, password: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, role: 'admin', remember: true })).account.id;
      await req(admin, '/auth/password', { current: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, next: 'Mobile-isolated-admin-753!' });
      course = (await req(admin, '/admin/courses', { title: 'Isolated mobile course', category: 'BIM', fee: 100000, published: true }, 'POST', 201)).course.id;
      module = (await req(admin, `/admin/courses/${course}/modules`, { title: 'Open module' }, 'POST', 201)).id;
      locked = (await req(admin, `/admin/courses/${course}/modules`, { title: 'Locked module' }, 'POST', 201)).id;
      await db.prepare('INSERT INTO module_releases VALUES (?,?,?,?,?,?,?)').run(locked, '', 'manual', '', '', 0, 'existing-lock');
      const enroll = async (client: Client, name: string, email: string) => {
        const result = await req(admin, '/admin/students', { name, email, phone: '9890000000', courseId: course, total: 100000, amount: 0 }, 'POST', 201);
        await signInApproved(req, client, result, 'Mobile-isolated-learner-987!'); return (await req(client, '/session')).account.id;
      };
      learnerId = await enroll(learner, 'Isolated learner', 'mobile-learner@example.invalid'); otherId = await enroll(other, 'Other isolated learner', 'mobile-other@example.invalid');
      originalAccounts = await db.prepare('SELECT * FROM accounts ORDER BY id').all();
      await db.prepare('INSERT INTO academy_settings VALUES (?,?)').run('preserved-mobile-test-setting', 'unchanged');
    });
    await t.test('endpoints enforce authentication, role and job authorization', async () => {
      await req(visitor, '/push/status', undefined, 'GET', 401);
      await req(visitor, '/push/subscribe', {}, 'POST', 401);
      await req(learner, '/admin/push/diagnostics', undefined, 'GET', 403);
      await req(visitor, '/jobs/push', undefined, 'GET', 401);
      const response = await fetch(origin + '/api/jobs/push', { headers: { Authorization: 'Bearer isolated-mobile-job-secret' } }); assert.equal(response.status, 200);
      await req(admin, '/push/subscribe', { label: 'Invalid provider', subscription: { ...adminSubscription, endpoint: 'https://127.0.0.1/private' } }, 'POST', 400);
      for (const endpoint of ['http://fcm.googleapis.com/x','https://evilpush.apple.com/x','https://fcm.googleapis.com:444/x','https://fcm.googleapis.com@attacker.invalid/x','https://fcm.googleapis.com/x#fragment']) {
        assert.throws(() => validPushSubscription({ ...firstSubscription, endpoint }));
      }
      assert.throws(() => validPushSubscription({ ...firstSubscription, keys: { ...firstSubscription.keys, auth: 'bad' } }));
      assert.equal(pushLink('https://attacker.invalid'), '/?page=overview');
    });
    await t.test('opting in keeps past alerts in the inbox and encrypts subscription capabilities', async () => {
      await addNotification('before-subscribe');
      const status = await req(learner, '/push/status'); assert.equal(status.ready, true); assert.equal(status.accountId, learnerId);
      const key = status.publicKey; assert.equal(Buffer.from(key, 'base64url').length, 65); assert.equal((await req(learner, '/push/status')).publicKey, key);
      assert.ok(!JSON.stringify(status).includes('privateKey'));
      deviceId = (await req(learner, '/push/subscribe', { label: 'Isolated phone', subscription: firstSubscription }, 'POST', 201)).id;
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_deliveries').get())!.n, 0);
      const device = (await db.prepare('SELECT * FROM push_devices WHERE id=?').get(deviceId))!;
      assert.ok(!String(device.subscription).includes(firstSubscription.endpoint)); assert.deepEqual(JSON.parse(unseal(String(device.subscription))), firstSubscription);
      assert.equal((await req(learner, '/push/subscribe', { label: 'Isolated phone', subscription: firstSubscription }, 'POST', 201)).id, deviceId);
      adminDeviceId = (await req(admin, '/push/subscribe', { label: 'Admin phone', subscription: adminSubscription }, 'POST', 201)).id;
      await req(other, '/push/subscribe', { label: 'Other phone', subscription: otherSubscription }, 'POST', 201);
      const own = await req(learner, '/push/status'); assert.equal(own.devices.length, 1); assert.ok(!JSON.stringify(own).includes('session_hash')); assert.ok(!JSON.stringify(own).includes(firstSubscription.endpoint));
    });
    await t.test('new messages use the correct recipient and default to a private lock-screen preview', async () => {
      await req(admin, '/admin/messages', { studentId: learnerId, subject: 'Private course update', body: 'Course information for this learner only.' }, 'POST', 204);
      await runPushCycle(db, sender);
      assert.equal(delivered.length, 1); assert.equal(delivered[0].endpoint, firstSubscription.endpoint);
      assert.equal(delivered[0].payload.body, 'You have a new update. Open PBS to view it.'); assert.equal(delivered[0].payload.url, '/?page=messages');
      await runPushCycle(db, sender); assert.equal(delivered.length, 1);
      const queued = await db.prepare('SELECT * FROM push_deliveries').all(); assert.equal(queued.length, 1); assert.equal(queued[0].status, 'sent');
    });
    await t.test('previews are opt-in, a test stays on this device and other accounts cannot remove it', async () => {
      await req(other, `/push/devices/${deviceId}`, undefined, 'DELETE', 204);
      assert.ok(await db.prepare('SELECT id FROM push_devices WHERE id=?').get(deviceId));
      await req(other, '/push/test', { deviceId }, 'POST', 400);
      await req(learner, '/push/subscribe', { label: 'Isolated phone', subscription: firstSubscription, previews: true }, 'POST', 201);
      await addNotification('preview-on'); await deliverPushQueue(db, sender);
      assert.equal(delivered.at(-1)!.payload.body, 'Private student details for this account only.');
      const before = delivered.length; const result = await req(admin, '/push/test', { deviceId: adminDeviceId }); assert.equal(result.status, 'sent');
      assert.equal(delivered.length, before + 1); assert.equal(delivered.at(-1)!.endpoint, adminSubscription.endpoint);
    });
    await t.test('delivery leases prevent duplicate sends by simultaneous serverless workers', async () => {
      await addNotification('concurrent'); const before = delivered.length;
      await Promise.all([deliverPushQueue(db, sender), deliverPushQueue(db, sender)]);
      assert.equal(delivered.length, before + 1);
      assert.equal((await db.prepare("SELECT attempts FROM push_deliveries WHERE notification_id='concurrent'").get())!.attempts, 1);
    });
    await t.test('transient failures back off and diagnostics never expose provider responses', async () => {
      await addNotification('retry'); providerFailure = 503; const before = delivered.length;
      const result = await deliverPushQueue(db, sender); assert.equal(result.retrying, 1);
      const job = (await db.prepare("SELECT * FROM push_deliveries WHERE notification_id='retry'").get())!;
      assert.equal(job.status, 'pending'); assert.ok(Number(job.next_attempt) > Date.now()); assert.ok(!String(job.error).includes('PRIVATE'));
      await deliverPushQueue(db, sender); assert.equal(delivered.length, before);
      const diagnostics = await req(admin, '/admin/push/diagnostics'); assert.ok(!JSON.stringify(diagnostics).includes(firstSubscription.endpoint)); assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE'));
      providerFailure = 0; await db.prepare("UPDATE push_deliveries SET next_attempt=0 WHERE notification_id='retry'").run();
      await deliverPushQueue(db, sender); assert.equal(delivered.length, before + 1);
    });
    await t.test('read, expired and revoked-account alerts are never sent', async () => {
      await addNotification('read-before-send'); await req(learner, '/notifications/read-before-send', { read: true }, 'PATCH', 204);
      await addNotification('expired-before-send'); await db.prepare("UPDATE push_deliveries SET created_at='2020-01-01T00:00:00.000Z' WHERE notification_id='expired-before-send'").run();
      const before = delivered.length; await deliverPushQueue(db, sender); assert.equal(delivered.length, before);
      await addNotification('inactive'); await db.prepare('INSERT INTO account_controls VALUES (?,?,?,?)').run(learnerId, 'inactive', 'QA only', new Date().toISOString());
      await deliverPushQueue(db, sender); assert.equal(delivered.length, before); await req(learner, '/push/status', undefined, 'GET', 401);
      await db.prepare('DELETE FROM account_controls WHERE account_id=?').run(learnerId);
    });
    await t.test('lesson availability honors the existing module release rules', async () => {
      const addLesson = async (moduleId: string, title: string) => (await req(admin, `/admin/courses/${course}/modules/${moduleId}/lessons`, { title, duration: '10 min', url: 'https://example.org/isolated.mp4' }, 'POST', 201)).id;
      const openId = await addLesson(module, 'New available lesson'), lockedId = await addLesson(locked, 'Still locked lesson');
      await runPushCycle(db, sender);
      assert.ok(await db.prepare('SELECT id FROM notifications WHERE id=?').get(`lesson:${openId}:${learnerId}`));
      assert.equal(await db.prepare('SELECT id FROM notifications WHERE id=?').get(`lesson:${lockedId}:${learnerId}`), undefined);
      await db.prepare('UPDATE module_releases SET released=1 WHERE module_id=?').run(locked); await runPushCycle(db, sender);
      assert.ok(await db.prepare('SELECT id FROM notifications WHERE id=?').get(`lesson:${lockedId}:${learnerId}`));
      assert.ok(delivered.some(item => item.payload.url === '/?page=courses'));
    });
    await t.test('expired push providers are removed, while server authorization errors stop retrying', async () => {
      await addNotification('permanent-provider-failure'); providerFailure = 403;
      await deliverPushQueue(db, sender); assert.equal((await db.prepare("SELECT status FROM push_deliveries WHERE notification_id='permanent-provider-failure'").get())!.status, 'failed');
      await addNotification('gone-provider'); providerFailure = 410; await deliverPushQueue(db, sender);
      assert.equal(await db.prepare('SELECT id FROM push_devices WHERE id=?').get(deviceId), undefined); providerFailure = 0;
      deviceId = (await req(learner, '/push/subscribe', { label: 'Reconnected phone', subscription: firstSubscription }, 'POST', 201)).id;
    });
    await t.test('logout and password changes revoke the device without changing student or admin data', async () => {
      await addNotification('before-logout', otherId);
      await req(other, '/auth/logout', undefined, 'POST', 204);
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_devices WHERE account_id=?').get(otherId))!.n, 0);
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_deliveries WHERE account_id=?').get(otherId))!.n, 0);
      assert.deepEqual(await db.prepare('SELECT * FROM accounts ORDER BY id').all(), originalAccounts);
      assert.equal((await db.prepare('SELECT value FROM academy_settings WHERE key=?').get('preserved-mobile-test-setting'))!.value, 'unchanged');
      const before = delivered.length; await addNotification('session-expired');
      await db.prepare('UPDATE sessions SET expires_at=0 WHERE account_id=?').run(learnerId); await runPushCycle(db, sender);
      assert.equal(delivered.length, before); assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_devices WHERE account_id=?').get(learnerId))!.n, 0);
      await req(admin, '/auth/password', { current: 'Mobile-isolated-admin-753!', next: 'Mobile-new-isolated-password-536!' });
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_devices WHERE account_id=?').get(adminId))!.n, 0);
    });
    await t.test('missing encryption configuration does not break the portal or existing records', async () => {
      delete process.env.PBS_INTEGRATION_KEY;
      const status = await req(admin, '/push/status'); assert.equal(status.ready, false); assert.equal(status.publicKey, '');
      await req(admin, '/push/subscribe', { label: 'Unconfigured', subscription: adminSubscription }, 'POST', 503);
      await req(visitor, '/health');
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('the Home Screen app has valid icons and a public-only offline fallback', async t => {
  const root = path.resolve('public'), manifest = JSON.parse(readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.scope, '/');
  for (const icon of [...manifest.icons, { src: '/apple-touch-icon.png', sizes: '180x180' }]) {
    const png = readFileSync(path.join(root, icon.src)); assert.equal(png.subarray(1,4).toString(), 'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
  const listeners = new Map<string, (event: any) => void>(); const shown: any[] = [], opened: string[] = [], messages: any[] = [];
  let client: any, networkOffline = false; const cached: string[] = [];
  const self = { location: { origin: 'https://student.pragmaticbim.com' }, addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    registration: { showNotification: async (title: string, options: any) => { shown.push({ title, ...options }); }, getNotifications: async () => [] },
    clients: { claim: async () => {}, matchAll: async () => client ? [client] : [], openWindow: async (url: string) => { opened.push(url); } }, skipWaiting: async () => {} };
  const caches = { open: async () => ({ addAll: async (urls: string[]) => { cached.push(...urls); } }), keys: async () => ['pbs-public-v1'], match: async () => new Response('Public reconnect page') };
  runInNewContext(readFileSync(path.join(root, 'sw.js'), 'utf8'), { self, caches, URL, Response, fetch: async () => { if (networkOffline) throw new Error('Offline'); return new Response('online'); } });
  async function dispatch(name: string, values: any = {}) { let task: Promise<unknown> | undefined; listeners.get(name)!({ ...values, waitUntil: (promise: Promise<unknown>) => { task = promise; } }); await task; }
  await t.test('installation stores only the public offline page and icons', async () => {
    await dispatch('install'); assert.deepEqual(cached, ['/offline.html','/app-icon-192.png','/app-icon-512.png']);
    assert.ok(!cached.some(url => url.startsWith('/api/') || url === '/'));
    for (const url of ['/api/session','/api/student/workspace','/api/playback/video','/api/admin/export']) {
      let intercepted = false; listeners.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: self.location.origin + url }, respondWith: () => { intercepted = true; } }); assert.equal(intercepted, false);
    }
    let response: Promise<Response> | undefined; networkOffline = true;
    listeners.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: self.location.origin + '/' }, respondWith: (promise: Promise<Response>) => { response = promise; } });
    assert.equal(await (await response!).text(), 'Public reconnect page');
  });
  await t.test('every push is visible and external notification URLs are refused', async () => {
    await dispatch('push', { data: { json: () => ({ title: 'PBS', body: 'Update', url: 'https://attacker.invalid', id: 'qa' }) } }); assert.equal(shown.at(-1).data.url, '/');
    await dispatch('push', { data: { json: () => { throw new Error('Invalid JSON'); } } }); assert.equal(shown.at(-1).title, 'PBS learning portal');
  });
  await t.test('notification clicks reuse the open portal without reloading an active upload', async () => {
    let focused = 0, closed = 0;
    client = { url: self.location.origin + '/', focus: async () => { focused++; }, postMessage: (message: any) => messages.push(message) };
    await dispatch('notificationclick', { notification: { close: () => closed++, data: { url: '/?page=courses', id: 'qa' } } });
    assert.equal(focused, 1); assert.equal(closed, 1); assert.equal(messages[0].url, '/?page=courses'); assert.equal(opened.length, 0);
    client = undefined;
    await dispatch('notificationclick', { notification: { close: () => {}, data: { url: '/?page=sessions' } } }); assert.equal(opened[0], '/?page=sessions');
  });
});
