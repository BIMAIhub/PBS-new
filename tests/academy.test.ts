import { signInApproved, activateOnAnotherCourse } from './admission-fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('PBS academy payments, credentials and enrollment access', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pbs-academy-test-'));
  for (const key of ['VERCEL', 'PBS_TURSO_DATABASE_URL', 'PBS_TURSO_AUTH_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'PBS_PUBLIC_ORIGIN']) delete process.env[key];
  process.env.PBS_DATA_DIR = directory;
  process.env.PBS_BOOTSTRAP_ADMIN_EMAIL = 'qa-admin@example.invalid';
  process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD = 'Test-bootstrap-password-927';
  process.env.PBS_INTEGRATION_KEY = 'b'.repeat(64);
  const password = 'QA-account-password-768!';
  const { createPortalApp } = await import('../server/app.js');
  const { grantCourseAccess } = await import('../server/microsoft.js');
  const app = await createPortalApp();
  const db = app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' ? address!.port : 0}/api`;
  type Client = { cookie: string };
  const admin: Client = { cookie: '' }; const student: Client = { cookie: '' }; const other: Client = { cookie: '' };
  async function req(client: Client, endpoint: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', expected = 200) {
    const response = await fetch(`${base}${endpoint}`, { method, headers: { 'X-PBS-Request': '1', ...(client.cookie ? { Cookie: client.cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const cookie = response.headers.get('set-cookie'); if (cookie) client.cookie = cookie.split(';')[0];
    const raw = await response.text(); const result = raw && response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : raw;
    assert.equal(response.status, expected, `${method} ${endpoint}: ${JSON.stringify(result)}`); return result;
  }
  let course: any; let lesson: any; let enrollment: any; let certificate: any; let adminId: string;
  try {
    await t.test('isolated database starts without students; admin bootstrap must change password', async () => {
      assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE role = 'student'").get())!.count, 0);
      const login = await req(admin, '/auth/login', { identifier: process.env.PBS_BOOTSTRAP_ADMIN_EMAIL, password: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, role: 'admin' });
      adminId = login.account.id; assert.equal(login.account.mustChangePassword, true);
      await req(admin, '/admin/academy', undefined, 'GET', 403);
      await req(admin, '/auth/password', { current: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, next: password });
      await req(other, '/admin/academy', undefined, 'GET', 401);
    });
    await t.test('payment destination requires admin password and is exposed without secrets', async () => {
      await req(admin, '/admin/payment-settings', { paymentUpiId: 'invalid', paymentName: 'PBS QA', current: password }, 'PUT', 400);
      await req(admin, '/admin/payment-settings', { paymentUpiId: 'qa-payee@bank', paymentName: 'PBS QA', current: 'wrong' }, 'PUT', 400);
      await req(admin, '/admin/payment-settings', { paymentUpiId: 'qa-payee@bank', paymentName: 'PBS QA', current: password }, 'PUT', 204);
      const catalog = await req(other, '/catalog'); assert.equal(catalog.paymentUpiId, 'qa-payee@bank'); assert.equal('current' in catalog, false);
    });
    await t.test('course and student application persist; pending enrollment cannot earn credential', async () => {
      course = (await req(admin, '/admin/courses', { title: 'QA BIM Course', category: 'BIM', description: 'Isolated test course', instructor: 'QA Instructor', schedule: '', fee: 100000, published: true }, 'POST', 201)).course;
      const module = await req(admin, `/admin/courses/${course.id}/modules`, { title: 'QA Module' }, 'POST', 201);
      lesson = await req(admin, `/admin/courses/${course.id}/modules/${module.id}/lessons`, { title: 'QA Lesson', duration: '5 min', description: '', url: 'https://example.org/training.mp4' }, 'POST', 201);
      await req(admin, `/admin/courses/${course.id}/assessment`, { passingScore: 75, questions: [{ prompt: 'BIM uses information?', options: ['Yes', 'No'], answer: 0 }] }, 'PUT', 204);
      const applied = await req(student, '/enrollments', { courseId: course.id, name: 'QA Student', email: 'qa-student@example.invalid', password, amount: 20000, reference: 'QAUTR001' }, 'POST', 201);
      enrollment = applied.enrollment;
      assert.equal(student.cookie, '');
      await req(student, '/admin/academy', undefined, 'GET', 401);
      await req(student, `/student/courses/${course.id}/certificate`, {}, 'POST', 401);
      assert.equal((await req(admin, '/admin/academy')).details.find((item: any) => item.enrollmentId === enrollment.id).source, 'student');
    });
    await t.test('approved payment is counted once, repeated decisions do not duplicate receipts', async () => {
      const approval = await req(admin, `/admin/enrollments/${enrollment.id}/decision`, { decision: 'approved', recordPayment: true });
      await req(admin, `/admin/enrollments/${enrollment.id}/decision`, { decision: 'approved', recordPayment: true });
      await signInApproved(req, student, approval, password);
      const workspace = await req(admin, '/admin/workspace'); assert.equal(workspace.receipts.length, 1); assert.equal(workspace.enrollments[0].paid, 20000);
      await req(student, `/student/courses/${course.id}/certificate`, {}, 'POST', 409);
    });
    await t.test('student payment reference requires ownership; admin verification is idempotent', async () => {
      await req(other, '/enrollments', { courseId: course.id, name: 'Other QA', email: 'other-qa@example.invalid', password, amount: 0 }, 'POST', 201);
      await activateOnAnotherCourse(req, admin, other, 'other-qa@example.invalid', password);
      await req(other, `/student/enrollments/${enrollment.id}/payment`, { amount: 10000, reference: 'QAWRONG' }, 'POST', 404);
      await req(student, `/student/enrollments/${enrollment.id}/payment`, { amount: 30000, reference: 'QAUTR002' });
      await req(student, `/student/enrollments/${enrollment.id}/payment`, { amount: 10000, reference: 'QAUTR003' }, 'POST', 409);
      const before = await req(student, '/student/workspace'); assert.equal(before.receipts.length, 1); assert.equal(before.enrollments[0].requestedPayment, 30000);
      await req(admin, `/admin/enrollments/${enrollment.id}/payment`, { amount: 30000, reference: 'QAUTR002', method: 'UPI' });
      await req(admin, `/admin/enrollments/${enrollment.id}/payment`, { amount: 30000, reference: 'QAUTR002', method: 'UPI' });
      const after = await req(student, '/student/workspace'); assert.equal(after.receipts.length, 2); assert.equal(after.enrollments[0].paid, 50000); assert.equal(after.enrollments[0].requestedPayment, 0);
      await req(admin, `/admin/enrollments/${enrollment.id}/payment`, { amount: 50001, reference: 'QAUTR004', method: 'UPI' }, 'POST', 400);
    });
    await t.test('due dates and admin notes persist with student privacy', async () => {
      await req(admin, `/admin/enrollments/${enrollment.id}/details`, { dueDate: 'not-a-date', internalNote: '' }, 'PATCH', 400);
      await req(admin, `/admin/enrollments/${enrollment.id}/details`, { dueDate: '2026-11-30', internalNote: 'Private QA follow-up' }, 'PATCH', 204);
      const academy = await req(student, '/student/academy'); assert.equal(academy.details[0].dueDate, '2026-11-30'); assert.equal('internalNote' in academy.details[0], false);
      const csv = await req(admin, '/admin/payment-ledger.csv'); assert.match(csv, /Verified INR/); assert.match(csv, /500/);
    });
    await t.test('reminders are idempotent portal messages; email requires a connection', async () => {
      await req(admin, `/admin/enrollments/${enrollment.id}/reminder`, { requestKey: 'qa-reminder-email', channel: 'email', body: 'Please pay your remaining fee.' }, 'POST', 409);
      const request = { requestKey: 'qa-reminder-1', channel: 'portal', body: 'Please pay your remaining fee.' };
      const first = await req(admin, `/admin/enrollments/${enrollment.id}/reminder`, request);
      const again = await req(admin, `/admin/enrollments/${enrollment.id}/reminder`, request); assert.equal(first.id, again.id);
      assert.equal((await req(student, '/student/academy')).reminders.length, 1);
      assert.equal((await req(student, '/student/workspace')).messages.length, 1);
      assert.equal((await req(other, '/student/academy')).reminders.length, 0);
    });
    await t.test('certificate requires complete lessons and passed assessment, with stable issuance', async () => {
      const details = await req(admin, '/admin/workspace'); const lessonId = details.courses.find((item: any) => item.id === course.id).modules[0].lessons[0].id;
      await req(student, `/student/lessons/${lessonId}/completion`, { completed: true }, 'POST', 204);
      await req(student, `/student/courses/${course.id}/certificate`, {}, 'POST', 409);
      await req(student, `/student/courses/${course.id}/assessment`, { answers: [0] });
      certificate = await req(student, `/student/courses/${course.id}/certificate`, {});
      assert.equal((await req(student, `/student/courses/${course.id}/certificate`, {})).id, certificate.id);
      await req(other, `/student/certificates/${certificate.id}`, { published: true }, 'PATCH', 404);
      await req({ cookie: '' }, `/certificates/verify/${certificate.publicToken}`, undefined, 'GET', 404);
      await req(student, `/student/certificates/${certificate.id}`, { published: true }, 'PATCH', 204);
      const verified = await req({ cookie: '' }, `/certificates/verify/${certificate.publicToken}`); assert.equal(verified.studentName, 'QA Student'); assert.equal('email' in verified, false); assert.equal('studentId' in verified, false);
    });
    await t.test('certificate designs are validated and revocation is verified', async () => {
      const template = { courseId: course.id, title: 'PBS BIM achievement', issuer: 'PBS', signer: 'QA Director', signerRole: 'Academic Director', design: 'classic', primaryColor: '#176BB7', accentColor: '#D4A94D' };
      await req(admin, '/admin/certificate-template', { ...template, primaryColor: 'url(evil)' }, 'PUT', 400);
      await req(admin, '/admin/certificate-template', template, 'PUT');
      assert.equal((await req(student, '/student/academy')).certificates[0].template.design, 'classic');
      await req(admin, `/admin/certificates/${certificate.id}/revoke`, { reason: 'QA revocation check' }, 'POST', 204);
      assert.ok((await req({ cookie: '' }, `/certificates/verify/${certificate.publicToken}`)).revokedAt);
    });
    await t.test('portfolio sharing is opt-in and excludes private records', async () => {
      await req(student, '/student/portfolio', { headline: 'QA BIM learner', bio: 'My project', projectUrl: 'https://example.org/project', linkedin: 'https://www.linkedin.com/in/qa', github: '', website: '', published: true }, 'PATCH');
      const account = (await req(student, '/session')).account;
      const published = await req({ cookie: '' }, `/portfolios/${account.id}`); assert.equal(published.portfolio.linkedin, 'https://www.linkedin.com/in/qa'); assert.equal('email' in published, false); assert.equal('receipts' in published, false);
      await req(student, '/student/portfolio', { headline: '', bio: '', projectUrl: '', published: false }, 'PATCH');
      await req({ cookie: '' }, `/portfolios/${account.id}`, undefined, 'GET', 404);
    });
    await t.test('OneDrive grants target approved student email with read access; failures are recorded', async () => {
      await db.prepare('INSERT INTO course_storage VALUES (?, ?, ?, ?, ?, ?, ?)').run(course.id, adminId, 'qa-drive', 'qa-folder', 'QA Course Folder', 'https://example.org/qa-folder', 1);
      let calls = 0;
      const request: any = async (_db: unknown, owner: string, endpoint: string, init: RequestInit) => {
        calls++; assert.equal(owner, adminId); assert.match(endpoint, /\/invite$/); const body = JSON.parse(String(init.body));
        assert.equal(body.requireSignIn, true); assert.deepEqual(body.roles, ['read']); assert.equal(body.recipients[0].email, 'qa-student@example.invalid'); return { value: [{ id: 'qa-permission' }] };
      };
      assert.equal((await grantCourseAccess(db, enrollment.id, adminId, true, request)).status, 'granted');
      assert.equal((await grantCourseAccess(db, enrollment.id, adminId, true, request)).status, 'granted'); assert.equal(calls, 1);
      const pending = (await req(admin, '/admin/workspace')).enrollments.find((item: any) => item.email === 'other-qa@example.invalid' && item.status === 'pending');
      await assert.rejects(() => grantCourseAccess(db, pending.id, adminId, true, request), /Approve enrollment/);
      await db.prepare("UPDATE course_access_grants SET status = 'failed' WHERE enrollment_id = ?").run(enrollment.id);
      const failed = await grantCourseAccess(db, enrollment.id, adminId, true, async () => { throw new Error('QA remote failure'); }); assert.equal(failed.status, 'failed');
      assert.equal((await req(admin, '/admin/academy')).grants[0].status, 'failed');
      const status = await req(admin, '/admin/integrations/microsoft'); assert.equal(status.encryptionReady, true); assert.equal(status.configured, false); assert.equal('secret' in status, false);
    });
    await t.test('audit trail persists without recording secrets', async () => {
      const academy = await req(admin, '/admin/academy'); assert.ok(academy.events.some((event: any) => event.action === 'Payment verified')); assert.ok(academy.events.some((event: any) => event.action === 'Certificate earned'));
      assert.equal(JSON.stringify(academy).includes(password), false);
    });
    await t.test('Microsoft app settings encrypt secrets and expose only configuration status', async () => {
      const input = { clientId: '11111111-1111-1111-1111-111111111111', tenant: 'common', secret: 'Isolated-QA-provider-secret', current: password };
      await req(admin, '/admin/integrations/microsoft/config', { ...input, current: 'wrong' }, 'PUT', 400);
      await req(admin, '/admin/integrations/microsoft/config', input, 'PUT', 204);
      const saved = await db.prepare("SELECT value FROM academy_settings WHERE key = 'microsoft'").get();
      assert.equal(String(saved!.value).includes(input.secret), false);
      const status = await req(admin, '/admin/integrations/microsoft'); assert.equal(status.configured, true); assert.equal(status.secretSaved, true); assert.equal(JSON.stringify(status).includes(input.secret), false);
      await req(admin, '/admin/integrations/microsoft/config', { ...input, secret: '' }, 'PUT', 204);
      assert.equal((await db.prepare("SELECT value FROM academy_settings WHERE key = 'microsoft'").get())!.value, saved!.value);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close(); rmSync(directory, { recursive: true, force: true });
  }
});
