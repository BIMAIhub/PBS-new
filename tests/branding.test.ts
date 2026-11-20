import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultBrandSettings } from '../src/live/branding-types.js';

test('PBS global branding and public image delivery', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pbs-branding-test-'));
  for (const key of ['VERCEL', 'PBS_TURSO_DATABASE_URL', 'PBS_TURSO_AUTH_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'PBS_PUBLIC_ORIGIN', 'BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID']) delete process.env[key];
  process.env.PBS_DATA_DIR = directory; process.env.PBS_BOOTSTRAP_CATALOG = '1';
  process.env.PBS_BOOTSTRAP_ADMIN_EMAIL = 'branding-qa@example.invalid'; process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD = 'Branding-bootstrap-352!';
  const password = 'Branding-test-password-828!';
  const { createPortalApp } = await import('../server/app.js');
  const app = await createPortalApp(), db = app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(), base = `http://127.0.0.1:${typeof address === 'object' ? address!.port : 0}/api`;
  type Client = { cookie: string }; const admin: Client = { cookie: '' }, student: Client = { cookie: '' }, visitor: Client = { cookie: '' };
  async function request(client: Client, endpoint: string, body?: any, method = body === undefined ? 'GET' : 'POST', expected = 200, type = 'application/json') {
    const response = await fetch(base + endpoint, { method, headers: { 'X-PBS-Request': '1', ...(client.cookie ? { Cookie: client.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': type }) }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
    const cookie = response.headers.get('set-cookie'); if (cookie) client.cookie = cookie.split(';')[0];
    const bytes = Buffer.from(await response.arrayBuffer()), data = response.headers.get('content-type')?.includes('json') && bytes.length ? JSON.parse(bytes.toString()) : bytes;
    assert.equal(response.status, expected, `${method} ${endpoint}: ${bytes.toString().slice(0, 300)}`); return data;
  }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz0AAAAASUVORK5CYII=', 'base64');
  let saved: any, logoUrl = '', heroUrl = '';
  try {
    await t.test('anonymous visitors receive only public defaults', async () => {
      const brand = await request(visitor, '/branding'); assert.equal(brand.primaryColor, '#176BB7'); assert.equal(brand.accentColor, '#D4A94D'); assert.equal(brand.backgroundColor, '#F4F7FA');
      assert.equal(brand.logoUrl, '/pbs-logo.svg'); assert.equal(brand.heroUrl, '/bim-studio-hero.webp'); assert.equal(brand.glassEnabled, true);
      assert.equal(JSON.stringify(brand).includes('location'), false);
      await request(visitor, '/admin/branding', defaultBrandSettings, 'PUT', 401);
      await request(admin, '/auth/login', { identifier: process.env.PBS_BOOTSTRAP_ADMIN_EMAIL, password: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, role: 'admin' });
      await request(admin, '/admin/branding', defaultBrandSettings, 'PUT', 403);
      await request(admin, '/auth/password', { current: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, next: password });
      const course = (await request(visitor, '/catalog')).courses[0];
      await request(student, '/enrollments', { courseId: course.id, name: 'Isolated branding learner', email: 'branding-student@example.invalid', password, amount: 0 }, 'POST', 201);
      await request(student, '/admin/branding', defaultBrandSettings, 'PUT', 403);
      await request(student, '/admin/branding/assets/logo', png, 'POST', 403, 'image/png');
    });
    await t.test('settings persist while unsafe colours and destinations leave them unchanged', async () => {
      saved = await request(admin, '/admin/branding', { ...defaultBrandSettings, academyName: 'PBS QA Academy', supportEmail: 'help@example.invalid', heroTitle: 'Practice BIM\nwith purpose', motionEnabled: false, logoUrl: 'javascript:alert(1)', privateKey: 'never-echo-this' }, 'PUT');
      assert.equal(saved.academyName, 'PBS QA Academy'); assert.equal(saved.motionEnabled, false); assert.equal(saved.logoUrl, '/pbs-logo.svg'); assert.ok(saved.revision);
      assert.equal(JSON.stringify(saved).includes('never-echo-this'), false);
      await request(admin, '/admin/branding', { ...saved, primaryColor: '#ffffff' }, 'PUT', 400);
      await request(admin, '/admin/branding', { ...saved, supportEmail: 'javascript:alert(1)' }, 'PUT', 400);
      await request(admin, '/admin/branding', { ...saved, backgroundColor: '#000000' }, 'PUT', 400);
      const current = await request(visitor, '/branding'); assert.equal(current.revision, saved.revision); assert.equal(current.heroTitle, 'Practice BIM\nwith purpose');
    });
    await t.test('logo uploads reject executable or mismatched files and keep storage details private', async () => {
      await request(admin, '/admin/branding/assets/logo', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), 'POST', 400, 'image/svg+xml');
      await request(admin, '/admin/branding/assets/logo', Buffer.from('This is not actually a PNG image'), 'POST', 400, 'image/png');
      await request(admin, '/admin/branding/assets/logo', Buffer.alloc(512 * 1024 + 1), 'POST', 413, 'image/png');
      const brand = await request(admin, '/admin/branding/assets/logo', png, 'POST', 201, 'image/png'); logoUrl = brand.logoUrl;
      assert.match(logoUrl, /^\/api\/branding\/assets\/logo\/[a-f\d-]+$/); assert.equal(brand.logoUploaded, true); assert.equal(brand.academyName, saved.academyName);
      assert.equal(JSON.stringify(brand).includes('location'), false); assert.deepEqual(await request(visitor, logoUrl.slice(4)), png);
      const response = await fetch(base + logoUrl.slice(4)); assert.equal(response.headers.get('content-type'), 'image/png'); assert.match(response.headers.get('cache-control')!, /immutable/);
      const cached = await fetch(base + logoUrl.slice(4), { headers: { 'If-None-Match': response.headers.get('etag')! } }); assert.equal(cached.status, 304);
      await request(visitor, '/branding/assets/logo/not-a-valid-id', undefined, 'GET', 404);
    });
    await t.test('background and logo updates are independent and defaults can be restored', async () => {
      const hero = await request(admin, '/admin/branding/assets/hero', png, 'POST', 201, 'image/png'); heroUrl = hero.heroUrl;
      assert.equal(hero.logoUrl, logoUrl); assert.equal(hero.heroUploaded, true);
      const reset = await request(admin, '/admin/branding/assets/logo', undefined, 'DELETE'); assert.equal(reset.logoUrl, '/pbs-logo.svg'); assert.equal(reset.heroUrl, heroUrl); assert.equal(reset.logoUploaded, false);
      await request(visitor, logoUrl.slice(4), undefined, 'GET', 404); assert.deepEqual(await request(visitor, heroUrl.slice(4)), png);
      await request(admin, '/admin/branding/assets/unknown', undefined, 'DELETE', 404);
      const end = await request(admin, '/admin/branding/assets/hero', undefined, 'DELETE'); assert.equal(end.heroUrl, '/bim-studio-hero.webp');
      assert.ok(Number((await db.prepare("SELECT COUNT(*) AS total FROM academy_events WHERE action LIKE '%brand%' OR action LIKE '%Brand%'").get())!.total) > 0);
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(directory, { recursive: true, force: true }); }
});
