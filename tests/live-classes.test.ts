import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('PBS scheduled live sessions, access, attendance and points', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pbs-live-classes-test-'));
  for (const key of ['VERCEL', 'PBS_TURSO_DATABASE_URL', 'PBS_TURSO_AUTH_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'PBS_PUBLIC_ORIGIN', 'BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID']) delete process.env[key];
  process.env.PBS_DATA_DIR = directory; process.env.PBS_BOOTSTRAP_CATALOG = '1';
  process.env.PBS_BOOTSTRAP_ADMIN_EMAIL = 'live-qa@example.invalid'; process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD = 'Live-bootstrap-453!';
  const password = 'Live-test-password-824!';
  const { createPortalApp } = await import('../server/app.js');
  const { migrateLegacyLiveClasses } = await import('../server/live-classes.js');
  const app = await createPortalApp(), db = app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(), base = `http://127.0.0.1:${typeof address === 'object' ? address!.port : 0}/api`;
  type Client = { cookie: string }; const admin: Client = { cookie: '' }, student: Client = { cookie: '' }, pending: Client = { cookie: '' }, other: Client = { cookie: '' }, visitor: Client = { cookie: '' };
  async function req(client: Client, endpoint: string, body?: any, method = body === undefined ? 'GET' : 'POST', expected = 200) {
    const response = await fetch(base + endpoint, { method, headers: { 'X-PBS-Request': '1', ...(client.cookie ? { Cookie: client.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const cookie = response.headers.get('set-cookie'); if (cookie) client.cookie = cookie.split(';')[0];
    const text = await response.text(), data = response.headers.get('content-type')?.includes('json') && text ? JSON.parse(text) : text;
    assert.equal(response.status, expected, `${method} ${endpoint}: ${text.slice(0, 300)}`); return data;
  }
  const time = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  let courseId = '', enrollmentId = '', studentId = '', upcoming: any, active: any, past: any;
  function input(start = 60, end = 120) { return { courseId, title: 'Isolated live BIM workshop', description: 'QA attendance workflow', startsAt: time(start), endsAt: time(end), meetUrl: 'https://meet.google.com/abc-defg-hij', joinBefore: 10, points: 20, minimumMinutes: 15, status: 'scheduled', published: true, accessConfirmed: true }; }
  try {
    await t.test('only admins can schedule and published sessions require Meet access setup', async () => {
      courseId = (await req(visitor, '/catalog')).courses[0].id;
      await req(admin, '/auth/login', { identifier: process.env.PBS_BOOTSTRAP_ADMIN_EMAIL, password: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, role: 'admin' });
      await req(admin, '/auth/password', { current: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, next: password });
      const applied = await req(student, '/enrollments', { courseId, name: 'Live QA learner', email: 'live-student@example.invalid', password, amount: 0 }, 'POST', 201); enrollmentId = applied.enrollment.id; studentId = applied.account.id;
      await req(pending, '/enrollments', { courseId, name: 'Pending live learner', email: 'pending-live@example.invalid', password, amount: 0 }, 'POST', 201);
      await req(visitor, '/admin/live-classes', input(), 'POST', 401); await req(student, '/admin/live-classes', input(), 'POST', 403);
      await req(admin, '/admin/live-classes', { ...input(), meetUrl: 'https://meet.google.com.evil.example/abc-defg-hij' }, 'POST', 400);
      await req(admin, '/admin/live-classes', { ...input(), accessConfirmed: false }, 'POST', 400);
      await req(admin, '/admin/live-classes', { ...input(), endsAt: time(59) }, 'POST', 400);
      upcoming = await req(admin, '/admin/live-classes', input(), 'POST', 201); assert.equal(upcoming.state, 'upcoming');
      assert.equal((await req(student, '/student/live-classes')).classes.length, 0);
    });
    await t.test('approval is required and meeting links stay out of student lists and calendars', async () => {
      await req(admin, `/admin/enrollments/${enrollmentId}/decision`, { decision: 'approved', recordPayment: false });
      const data = await req(student, '/student/live-classes'); assert.equal(data.classes[0].id, upcoming.id); assert.equal('meetUrl' in data.classes[0], false);
      assert.equal(JSON.stringify(await req(student, '/student/workspace')).includes('meet.google.com'), false);
      const calendar = await req(student, `/live-classes/${upcoming.id}/calendar`); assert.match(calendar, /BEGIN:VCALENDAR/); assert.match(calendar, /page=sessions/); assert.equal(calendar.includes('meet.google.com'), false);
      await req(pending, `/live-classes/${upcoming.id}/calendar`, undefined, 'GET', 404);
      await req(visitor, '/student/live-classes', undefined, 'GET', 401);
      await req(student, `/live-classes/${upcoming.id}/join`, {}, 'POST', 403);
      assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM live_attendance').get())!.total, 0);
    });
    await t.test('join window and current enrollment are enforced when requesting the Meet link', async () => {
      active = await req(admin, '/admin/live-classes', input(-5, 55), 'POST', 201); assert.equal(active.state, 'open');
      await req(pending, `/live-classes/${active.id}/join`, {}, 'POST', 404);
      await req(admin, `/live-classes/${active.id}/join`, {}, 'POST', 403);
      assert.equal((await req(student, `/live-classes/${active.id}/join`, { studentId: 'someone-else' })).url, active.meetUrl);
      await req(student, `/live-classes/${active.id}/join`, {});
      const attendance = (await req(student, '/student/live-classes')).classes.find((item: any) => item.id === active.id).attendance;
      assert.equal(attendance.joinCount, 2); assert.equal(attendance.status, 'pending'); assert.equal(attendance.points, 0); assert.ok(attendance.firstJoinedAt);
    });
    await t.test('schedule and opening notifications are scoped to approved course students', async () => {
      const notices = await req(student, '/notifications'); assert.ok(notices.items.some((item: any) => item.title === 'Your live session is open')); assert.equal(JSON.stringify(notices).includes('meet.google.com'), false);
      assert.equal((await req(pending, '/notifications')).items.some((item: any) => item.kind === 'session'), false);
      const again = await req(student, '/notifications'); assert.equal(again.items.filter((item: any) => item.title === 'Your live session is open').length, 1);
      const updated = await req(admin, `/admin/live-classes/${upcoming.id}`, { ...upcoming, title: 'Rescheduled workshop', description: '' }, 'PUT'); assert.notEqual(updated.revision, upcoming.revision);
      assert.ok((await req(student, '/notifications')).items.some((item: any) => item.body.includes('Rescheduled workshop')));
    });
    await t.test('manual attendance awards points once and corrections update real totals', async () => {
      await req(student, `/admin/live-classes/${active.id}/attendance/${studentId}`, { status: 'present', minutes: 20 }, 'PATCH', 403);
      await req(admin, `/admin/live-classes/${upcoming.id}/attendance/${studentId}`, { status: 'present', minutes: 20 }, 'PATCH', 400);
      await Promise.all([1, 2].map(() => req(admin, `/admin/live-classes/${active.id}/attendance/${studentId}`, { status: 'present', minutes: 20 }, 'PATCH', 204)));
      assert.equal((await req(student, '/student/live-classes')).points, 20);
      const updated = await req(admin, `/admin/live-classes/${active.id}`, { ...active, points: 40 }, 'PUT');
      await req(admin, `/admin/live-classes/${active.id}/attendance/${studentId}`, { status: 'present', minutes: 25 }, 'PATCH', 204); assert.equal((await req(student, '/student/live-classes')).points, 20);
      await req(admin, `/admin/live-classes/${active.id}/attendance/${studentId}`, { status: 'absent', minutes: 0 }, 'PATCH', 204); assert.equal((await req(student, '/student/live-classes')).points, 0);
      await req(admin, `/admin/live-classes/${active.id}/attendance/${studentId}`, { status: 'present', minutes: 30 }, 'PATCH', 204); assert.equal((await req(student, '/student/live-classes')).points, 40);
      await req(admin, `/admin/live-classes/${active.id}`, { ...updated, startsAt: time(-10) }, 'PUT', 409);
      assert.equal((await req(admin, '/admin/workspace')).students.find((item: any) => item.id === studentId).livePoints, 40);
    });
    await t.test('report preview makes no changes and repeated imports never duplicate points', async () => {
      past = await req(admin, '/admin/live-classes', { ...input(-120, -60), points: 25 }, 'POST', 201);
      const csv = 'First name,Last name,Email,Time joined,Time exited,Duration\r\nLive,Learner,live-student@example.invalid,09:00,09:45,00:45:00\r\nPending,Learner,pending-live@example.invalid,09:00,10:00,01:00:00\r\nUnknown,Visitor,outside@example.invalid,09:00,10:00,01:00:00';
      const preview = await req(admin, `/admin/live-classes/${past.id}/attendance/import`, { csv, apply: false }); assert.equal(preview.rows.length, 1); assert.equal(preview.skipped, 2); assert.equal(preview.rows[0].minutes, 45); assert.equal(preview.rows[0].points, 25);
      assert.equal((await req(student, '/student/live-classes')).points, 40);
      await req(admin, `/admin/live-classes/${past.id}/attendance/import`, { csv, apply: true }, 'POST', 400);
      for (const count of [1, 2]) {
        const reviewed = await req(admin, `/admin/live-classes/${past.id}/attendance/import`, { csv, apply: false });
        const imported = await req(admin, `/admin/live-classes/${past.id}/attendance/import`, { csv, apply: true, confirmed: true, reviewToken: reviewed.reviewToken }); assert.equal(imported.applied, true);
      }
      assert.equal((await req(student, '/student/live-classes')).points, 65);
      const shorter = 'Email,Duration\nlive-student@example.invalid,10m';
      const shorterPreview = await req(admin, `/admin/live-classes/${past.id}/attendance/import`, { csv: shorter });
      await req(admin, `/admin/live-classes/${past.id}/attendance/import`, { csv: shorter, apply: true, confirmed: true, reviewToken: shorterPreview.reviewToken }); assert.equal((await req(student, '/student/live-classes')).points, 40);
      const attendance = (await req(student, '/student/live-classes')).classes.find((item: any) => item.id === past.id).attendance; assert.equal(attendance.status, 'partial'); assert.equal(attendance.source, 'meet-report');
      await req(admin, `/admin/live-classes/${past.id}/attendance/import`, { csv: 'Email,Duration\nlive-student@example.invalid,45m\nlive-student@example.invalid,45m' }, 'POST', 400);
      await req(admin, `/admin/live-classes/${past.id}/attendance/import`, { csv: 'Email,Duration\nlive-student@example.invalid,garbage' }, 'POST', 400);
      await req(admin, `/admin/live-classes/${past.id}/attendance/import`, { csv: 'Email,Duration\nlive-student@example.invalid,"unfinished' }, 'POST', 400);
    });
    await t.test('an attendance import requires the current reviewed report and award settings', async () => {
      const endpoint = `/admin/live-classes/${past.id}/attendance/import`, csv = 'Email,Duration\nlive-student@example.invalid,45m';
      const original = await req(admin, endpoint, { csv }); assert.match(original.reviewToken, /^[a-f0-9]{64}$/);
      await req(admin, endpoint, { csv, apply: true, confirmed: true }, 'POST', 409);
      await req(admin, endpoint, { csv: csv.replace('45m', '50m'), apply: true, confirmed: true, reviewToken: original.reviewToken }, 'POST', 409);
      past = await req(admin, `/admin/live-classes/${past.id}`, { ...past, points: 35 }, 'PUT');
      await req(admin, endpoint, { csv, apply: true, confirmed: true, reviewToken: original.reviewToken }, 'POST', 409);
      assert.equal((await req(student, '/student/live-classes')).points, 40);
      const beforeCorrection = await req(admin, endpoint, { csv });
      await req(admin, `/admin/live-classes/${past.id}/attendance/${studentId}`, { status: 'absent', minutes: 0 }, 'PATCH', 204);
      await req(admin, endpoint, { csv, apply: true, confirmed: true, reviewToken: beforeCorrection.reviewToken }, 'POST', 409);
      const current = await req(admin, endpoint, { csv }); assert.equal(current.rows[0].points, 35);
      await req(admin, endpoint, { csv, apply: true, confirmed: true, reviewToken: current.reviewToken });
      assert.equal((await req(student, '/student/live-classes')).points, 75);
      await req(admin, endpoint, { csv, apply: true, confirmed: true, reviewToken: current.reviewToken }, 'POST', 409);
      assert.equal((await req(student, '/student/live-classes')).points, 75);
      await req(admin, `/admin/live-classes/${past.id}/attendance/${studentId}`, { status: 'partial', minutes: 10 }, 'PATCH', 204);
    });
    await t.test('past, cancelled and draft meetings cannot be joined; attendance exports stay private', async () => {
      await req(student, `/live-classes/${past.id}/join`, {}, 'POST', 403);
      const cancelled = await req(admin, '/admin/live-classes', { ...input(-2, 58), status: 'cancelled' }, 'POST', 201); await req(student, `/live-classes/${cancelled.id}/join`, {}, 'POST', 403);
      const draft = await req(admin, '/admin/live-classes', { ...input(-2, 58), published: false }, 'POST', 201); await req(student, `/live-classes/${draft.id}/join`, {}, 'POST', 404);
      assert.equal((await req(student, '/student/live-classes')).classes.some((item: any) => item.id === draft.id), false);
      await req(student, `/admin/live-classes/${active.id}/attendance`, undefined, 'GET', 403);
      await req(visitor, `/admin/live-classes/${active.id}/attendance/export`, undefined, 'GET', 401);
      assert.match(await req(admin, `/admin/live-classes/${active.id}/attendance/export`), /Portal join clicks/);
    });
    await t.test('legacy session links migrate once and no longer leak through course data', async () => {
      await db.prepare("INSERT INTO course_links VALUES ('legacy-qa', ?, 'session', 'Legacy QA session', 'https://meet.google.com/xyz-abcd-efg', ?)").run(courseId, time(-1));
      await db.prepare("DELETE FROM academy_settings WHERE key = 'live_classes_v1'").run(); await migrateLegacyLiveClasses(db); await migrateLegacyLiveClasses(db);
      assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM live_classes WHERE id = 'legacy-qa'").get())!.total, 1);
      await req(student, '/live-classes/legacy-qa/join', {}, 'POST', 403); assert.equal(JSON.stringify(await req(student, '/student/workspace')).includes('meet.google.com'), false);
      const legacy = await req(admin, `/admin/courses/${courseId}/links`, { kind: 'session', title: 'Old API still creates a safe draft', url: 'https://meet.google.com/abc-defg-hij', startsAt: time(60) }, 'POST', 201);
      assert.equal((await req(admin, '/admin/live-classes')).classes.find((item: any) => item.id === legacy.id).published, false);
    });
    await t.test('revoked enrollment blocks an existing join and keeps private points history', async () => {
      await db.prepare("UPDATE enrollments SET status = 'rejected' WHERE id = ?").run(enrollmentId);
      await req(student, `/live-classes/${active.id}/join`, {}, 'POST', 404);
      const data = await req(student, '/student/live-classes'); assert.equal(data.classes.length, 0); assert.equal(data.points, 40);
      await req(admin, `/admin/live-classes/${active.id}/attendance/${studentId}`, { status: 'present', minutes: 45 }, 'PATCH', 400);
    });
    await t.test('admins can correct earlier awards after revocation without granting new points', async () => {
      await req(admin, `/admin/live-classes/${active.id}/attendance/${studentId}`, { status: 'excused', minutes: 0 }, 'PATCH', 204);
      assert.equal((await req(student, '/student/live-classes')).points, 0);
      const row = (await req(admin, `/admin/live-classes/${active.id}/attendance`)).rows.find((item: any) => item.studentId === studentId);
      assert.equal(row.eligible, false); assert.equal(row.status, 'excused'); assert.equal(row.points, 0);
      await req(admin, `/admin/live-classes/${active.id}/attendance/${studentId}`, { status: 'present', minutes: 45 }, 'PATCH', 400);
      const pendingId = String((await db.prepare('SELECT id FROM accounts WHERE email = ?').get('pending-live@example.invalid'))!.id);
      await req(admin, `/admin/live-classes/${active.id}/attendance/${pendingId}`, { status: 'absent', minutes: 0 }, 'PATCH', 400);
      await req(pending, `/admin/live-classes/${active.id}/attendance/${studentId}`, { status: 'absent', minutes: 0 }, 'PATCH', 403);
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(directory, { recursive: true, force: true }); }
});
