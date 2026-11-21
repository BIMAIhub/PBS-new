import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('PBS approval credentials, private feedback and financial records', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pbs-admissions-test-'));
  for (const key of ['VERCEL', 'PBS_TURSO_DATABASE_URL', 'PBS_TURSO_AUTH_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'PBS_PUBLIC_ORIGIN', 'BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID']) delete process.env[key];
  process.env.PBS_DATA_DIR = directory; process.env.PBS_BOOTSTRAP_CATALOG = '0';
  process.env.PBS_BOOTSTRAP_ADMIN_EMAIL = 'admissions-admin@example.invalid'; process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD = 'Admissions-bootstrap-456!';
  const password = 'Isolated-learning-password-458!';
  const { createPortalApp } = await import('../server/app.js');
  const { accessPackage, deliverAccessEmail, migratePendingAdmissions, whatsappNumber } = await import('../server/admissions.js');
  const { hashPassword } = await import('../server/passwords.js');
  const app = await createPortalApp(), db = app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(), origin = `http://127.0.0.1:${typeof address === 'object' ? address!.port : 0}`;
  type Client = { cookie: string }; const admin: Client = { cookie: '' }, student: Client = { cookie: '' }, other: Client = { cookie: '' }, visitor: Client = { cookie: '' };
  async function req(client: Client, endpoint: string, body?: any, method = body === undefined ? 'GET' : 'POST', expected = 200) {
    const response = await fetch(origin + '/api' + endpoint, { method, headers: { 'X-PBS-Request': '1', ...(client.cookie ? { Cookie: client.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const cookie = response.headers.get('set-cookie'); if (cookie) client.cookie = cookie.split(';')[0];
    const raw = await response.text(), data = raw && response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : raw;
    assert.equal(response.status, expected, `${method} ${endpoint}: ${raw.slice(0, 250)}`); return data;
  }
  const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAFAAUADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDjqKKK+7PiAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Z'; // Generated colour fixture, never a production review/photo.
  let adminId = '', courseId = '', lessonId = '', applied: any, approval: any, firstReceipt: any, currentReview: any;
  const reviewInput = () => ({ courseId, qualification: 'QA engineering qualification', photoDataUrl: photo, courseRating: 5, websiteRating: 4, body: 'Isolated course feedback for moderation testing.', websiteFeedback: 'Private website improvement suggestion.', placed: true, company: 'Isolated QA employer', consent: false });
  try {
    await t.test('new public applications issue a tracking code and no signed-in session', async () => {
      adminId = (await req(admin, '/auth/login', { identifier: process.env.PBS_BOOTSTRAP_ADMIN_EMAIL, password: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, role: 'admin' })).account.id;
      await req(admin, '/auth/password', { current: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, next: password });
      courseId = (await req(admin, '/admin/courses', { title: 'Isolated admissions course', category: 'QA', description: 'A real-record integration test in a temporary database.', fee: 100000, published: true }, 'POST', 201)).course.id;
      const module = await req(admin, `/admin/courses/${courseId}/modules`, { title: 'QA module' }, 'POST', 201);
      lessonId = (await req(admin, `/admin/courses/${courseId}/modules/${module.id}/lessons`, { title: 'QA lesson', url: 'https://example.org/qa.mp4' }, 'POST', 201)).id;
      await req(admin, `/admin/courses/${courseId}/assessment`, { passingScore: 70, questions: [{ prompt: 'Complete QA?', options: ['Yes', 'No'], answer: 0 }] }, 'PUT', 204);
      applied = await req(student, '/enrollments', { courseId, name: 'Isolated admissions learner', email: 'admissions-learner@example.invalid', phone: '9899999999', password, amount: 0 }, 'POST', 201);
      assert.equal(applied.application.code, applied.enrollment.id); assert.equal(applied.application.status, 'pending'); assert.equal(student.cookie, '');
      assert.equal((await req(student, '/session')).account, null); await req(student, '/student/workspace', undefined, 'GET', 401);
      await req(student, '/auth/login', { identifier: applied.account.email, password, role: 'student' }, 'POST', 401);
      assert.equal((await req(visitor, '/enrollments/lookup', { email: applied.account.email, code: applied.application.code })).status, 'pending');
      assert.equal((await req(visitor, '/catalog')).courses[0].approvedEnrollments, 0);
    });
    await t.test('even a known pending password or pre-existing session cannot bypass approval', async () => {
      await db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(await hashPassword(password), applied.account.id);
      await req(student, '/auth/login', { identifier: applied.account.email, password, role: 'student' }, 'POST', 403);
      const token = Buffer.alloc(32, 7).toString('base64url'); await db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(createHash('sha256').update(token).digest('hex'), applied.account.id, Date.now() + 60000);
      student.cookie = `pbs_session=${token}`; assert.equal((await req(student, '/session')).account, null); await req(student, '/student/feedback', undefined, 'GET', 401); student.cookie = '';
    });
    await t.test('approval creates first-time credentials once and reports unconfigured email honestly', async () => {
      approval = await req(admin, `/admin/enrollments/${applied.enrollment.id}/decision`, { decision: 'approved', sendEmail: true });
      assert.ok(approval.access.password); assert.equal(approval.delivery.status, 'unconfigured'); assert.equal(approval.access.email, applied.account.email);
      assert.equal(approval.access.whatsappNumber, '919899999999'); assert.equal(approval.access.signInUrl, origin + '/'); assert.match(approval.access.body, /Pending fee: INR 1000.00/); assert.ok(approval.access.body.includes(approval.access.password));
      const priorHash = (await db.prepare('SELECT password_hash FROM accounts WHERE id = ?').get(applied.account.id))!.password_hash;
      const repeated = await req(admin, `/admin/enrollments/${applied.enrollment.id}/decision`, { decision: 'approved', sendEmail: true }); assert.equal(repeated.access, undefined);
      assert.equal((await db.prepare('SELECT password_hash FROM accounts WHERE id = ?').get(applied.account.id))!.password_hash, priorHash);
      const catalog = await req(visitor, '/catalog'); assert.equal(catalog.community.historicalLearners, 25); assert.equal(catalog.community.approvedLearners, 1); assert.equal(catalog.courses[0].approvedEnrollments, 1);
      assert.equal(whatsappNumber('+44 7700 900123'), '447700900123'); assert.equal(whatsappNumber('not a number'), '');
      await req(visitor, `/admin/students/${applied.account.id}/access-package`, undefined, 'GET', 401);
    });
    await t.test('email retries do not duplicate messages and delivery history contains no password', async () => {
      await db.prepare('INSERT INTO microsoft_connections VALUES (?, ?, ?, ?, ?)').run(adminId, 'qa-sender@example.invalid', 'Isolated sender', 'unused-test-cache', new Date().toISOString());
      let sends = 0;
      const transport: any = async (_db: unknown, id: string, to: string, subject: string, body: string) => { sends++; assert.equal(id, adminId); assert.equal(to, applied.account.email); assert.match(subject, /approved/); assert.ok(body.includes(approval.access.password)); };
      assert.equal((await deliverAccessEmail(db, adminId, approval.access, 'qa-email-1', transport)).status, 'accepted');
      assert.equal((await deliverAccessEmail(db, adminId, approval.access, 'qa-email-1', transport)).status, 'accepted'); assert.equal(sends, 1);
      let uncertain = 0; const timeout: any = async () => { uncertain++; throw new Error('isolated timeout'); };
      assert.equal((await deliverAccessEmail(db, adminId, approval.access, 'qa-email-2', timeout)).status, 'unknown');
      assert.equal((await deliverAccessEmail(db, adminId, approval.access, 'qa-email-2', timeout)).status, 'unknown'); assert.equal(uncertain, 1);
      const records = JSON.stringify(await db.prepare('SELECT * FROM access_deliveries').all()); assert.equal(records.includes(approval.access.password), false); assert.equal(records.includes(approval.access.body), false);
      await assert.rejects(() => deliverAccessEmail(db, adminId, { ...approval.access, email: 'wrong@example.invalid' }, 'qa-wrong-recipient', transport), /changed/);
      await db.prepare('DELETE FROM microsoft_connections WHERE admin_id = ?').run(adminId);
    });
    await t.test('first sign-in requires a new password and permanent passwords cannot be emailed', async () => {
      const login = await req(student, '/auth/login', { identifier: applied.account.email, password: approval.access.password, role: 'student' }); assert.equal(login.account.mustChangePassword, true);
      await req(student, '/student/workspace', undefined, 'GET', 403);
      await req(student, '/auth/password', { current: approval.access.password, next: password });
      await req(student, '/student/workspace');
      await req(admin, `/admin/students/${applied.account.id}/access-email`, { requestKey: 'qa-stale-temp', temporaryPassword: approval.access.password }, 'POST', 409);
      await req(admin, `/admin/students/${applied.account.id}/access-email`, { requestKey: 'qa-permanent', temporaryPassword: password }, 'POST', 409);
      const kit = await accessPackage(db, applied.account.id, origin); assert.equal(kit.password, undefined); assert.equal(kit.body.includes(password), false);
    });
    await t.test('receipt balances are immutable snapshots and pending fees match verified payments', async () => {
      await req(admin, `/admin/enrollments/${applied.enrollment.id}/details`, { dueDate: '2026-12-01', internalNote: '' }, 'PATCH', 204);
      firstReceipt = (await req(admin, `/admin/enrollments/${applied.enrollment.id}/payment`, { amount: 20000, method: 'Bank transfer', reference: 'ADMISSION-QA-001' })).receipt;
      assert.equal(firstReceipt.feeTotal, 100000); assert.equal(firstReceipt.paidToDate, 20000); assert.equal(firstReceipt.balanceAfter, 80000); assert.equal(firstReceipt.dueDate, '2026-12-01');
      const second = (await req(admin, `/admin/enrollments/${applied.enrollment.id}/payment`, { amount: 30000, method: 'Bank transfer', reference: 'ADMISSION-QA-002' })).receipt; assert.equal(second.balanceAfter, 50000);
      const current = await req(student, '/student/workspace'); assert.equal(current.receipts.find((item: any) => item.id === firstReceipt.id).balanceAfter, 80000); assert.equal(current.enrollments[0].total - current.enrollments[0].paid, 50000);
      assert.equal(current.enrollments[0].dueDate, '2026-12-01');
    });
    await t.test('feedback requires completion and a real image; completion date and name come from records', async () => {
      await req(student, '/student/feedback', reviewInput(), 'POST', 409);
      await req(student, `/student/lessons/${lessonId}/completion`, { completed: true }, 'POST', 204);
      await req(student, `/student/courses/${courseId}/assessment`, { answers: [0] });
      const eligible = await req(student, '/student/feedback'); assert.equal(eligible.eligible.length, 1);
      await req(student, '/student/feedback', { ...reviewInput(), photoDataUrl: '' }, 'POST', 400);
      await req(student, '/student/feedback', { ...reviewInput(), company: '' }, 'POST', 400);
      await req(student, '/student/feedback', { ...reviewInput(), completedAt: '2099-01-01', studentName: 'Forged name' }, 'POST', 201);
      currentReview = (await req(student, '/student/feedback')).feedback[0]; assert.equal(currentReview.studentName, applied.account.name); assert.equal(currentReview.completedAt, eligible.eligible[0].completedAt); assert.equal(currentReview.status, 'pending');
      assert.ok((await req(admin, '/notifications')).items.some((item: any) => item.title === 'Student feedback to review'));
      assert.equal((await req(visitor, '/catalog')).feedback.length, 0);
    });
    await t.test('admin replies privately, consent is required for publication and stale reviews cannot be published', async () => {
      await req(admin, `/admin/feedback/${currentReview.id}`, { revision: currentReview.revision, status: 'published', verified: true }, 'PATCH', 409);
      await req(admin, `/admin/feedback/${currentReview.id}`, { revision: currentReview.revision, status: 'private', reply: 'Thank you for the website suggestion.' }, 'PATCH', 204);
      const privateReview = (await req(student, '/student/feedback')).feedback[0]; assert.ok(privateReview.reply); assert.equal((await req(visitor, '/catalog')).feedback.length, 0);
      await req(student, '/student/feedback', { ...reviewInput(), revision: privateReview.revision, consent: true }, 'POST', 201);
      await req(admin, `/admin/feedback/${currentReview.id}`, { revision: privateReview.revision, status: 'published', verified: true }, 'PATCH', 409);
      currentReview = (await req(admin, '/admin/feedback')).feedback[0];
      await req(admin, `/admin/feedback/${currentReview.id}`, { revision: currentReview.revision, status: 'published', verified: false }, 'PATCH', 409);
      await req(admin, `/admin/feedback/${currentReview.id}`, { revision: currentReview.revision, status: 'published', verified: true, reply: 'Thank you for sharing your experience.' }, 'PATCH', 204);
      const publicReview = (await req(visitor, `/catalog/${courseId}`)).feedback[0]; assert.equal(publicReview.studentName, applied.account.name); assert.equal(publicReview.qualification, reviewInput().qualification); assert.equal(publicReview.company, reviewInput().company);
      const exposed = JSON.stringify(publicReview); assert.equal(exposed.includes(applied.account.email), false); assert.equal(exposed.includes('Private website improvement'), false); assert.equal('websiteFeedback' in publicReview, false); assert.equal('revision' in publicReview, false);
    });
    await t.test('feedback pages validate cursors and do not repeat the last row', async () => {
      await req(admin, '/admin/feedback?cursor=invalid', undefined, 'GET', 400);
      const last = (await req(admin, '/admin/feedback')).feedback[0];
      const next = await req(admin, `/admin/feedback?cursor=${encodeURIComponent(`${last.submittedAt}~${last.id}`)}`);
      assert.equal(next.feedback.length, 0);
    });
    await t.test('permission withdrawal removes the public review immediately and is account-scoped', async () => {
      const otherCreated = await req(admin, '/admin/students', { name: 'Other isolated reviewer', email: 'other-reviewer@example.invalid', courseId, total: 0, amount: 0 }, 'POST', 201);
      await req(other, '/auth/login', { identifier: otherCreated.student.email, password: otherCreated.access.password, role: 'student' }); await req(other, '/auth/password', { current: otherCreated.access.password, next: password });
      await req(other, `/student/feedback/${currentReview.id}/withdraw`, {}, 'POST', 404);
      currentReview = (await req(student, '/student/feedback')).feedback[0]; await req(student, `/student/feedback/${currentReview.id}/withdraw`, {}, 'POST', 204);
      assert.equal((await req(visitor, '/catalog')).feedback.length, 0);
      await req(admin, `/admin/feedback/${currentReview.id}`, { revision: currentReview.revision, status: 'published', verified: true }, 'PATCH', 409);
      assert.equal((await req(visitor, '/catalog')).courses[0].approvedEnrollments, 2);
      await req(student, '/admin/feedback', undefined, 'GET', 403); await req(visitor, '/admin/feedback', undefined, 'GET', 401);
    });
    await t.test('legacy pending applicants lose sessions while approved student access remains active', async () => {
      const legacy = await req(admin, '/admin/students', { name: 'Isolated legacy applicant', email: 'legacy-pending@example.invalid', courseId, total: 0, amount: 0 }, 'POST', 201);
      await db.prepare("UPDATE enrollments SET status = 'pending', approved_at = '' WHERE id = ?").run(legacy.enrollment.id);
      await db.prepare("UPDATE enrollment_details SET source = 'student' WHERE enrollment_id = ?").run(legacy.enrollment.id);
      await db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('legacy-isolated-session', legacy.student.id, Date.now() + 60000);
      await db.prepare("DELETE FROM academy_settings WHERE key = 'approval_gate_v1'").run();
      await migratePendingAdmissions(db);
      assert.equal((await db.prepare('SELECT approved_at FROM student_admissions WHERE account_id = ?').get(legacy.student.id))!.approved_at, '');
      assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM sessions WHERE account_id = ?').get(legacy.student.id))!.total, 0);
      await req(student, '/student/workspace');
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(directory, { recursive: true, force: true }); }
});
