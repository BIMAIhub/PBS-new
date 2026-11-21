import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('course assignment, payment choices and account lifecycle use real records safely', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pbs-controls-test-'));
  for (const key of ['VERCEL', 'PBS_TURSO_DATABASE_URL', 'PBS_TURSO_AUTH_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'PBS_PUBLIC_ORIGIN', 'BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID', 'PBS_PAYMENT_UPI_ID']) delete process.env[key];
  process.env.PBS_DATA_DIR = directory; process.env.PBS_BOOTSTRAP_CATALOG = '0';
  process.env.PBS_BOOTSTRAP_ADMIN_EMAIL = 'controls-admin@example.invalid'; process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD = 'Controls-bootstrap-815!';
  const password = 'Isolated-control-password-941!';
  const { createPortalApp } = await import('../server/app.js');
  const { EnrollStudentForm } = await import('../src/live/AdminForms.js');
  const { PaymentFields } = await import('../src/live/EnrollmentForm.js');
  const { grantCourseAccess } = await import('../server/microsoft.js');
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
  let courseId = '', lessonId = '', taskId = '', liveId = '', first: any, second: any, pending: any;
  const pauseCourse = (paused: boolean, expectedPaused: boolean) => req(admin, `/admin/courses/${courseId}/pause`, { paused, expectedPaused, reason: 'Isolated QA schedule adjustment' }, 'PATCH', 204);
  const pauseEnrollment = (paused: boolean, expectedPaused: boolean) => req(admin, `/admin/enrollments/${first.enrollment.id}/pause`, { paused, expectedPaused, reason: 'Isolated student access change' }, 'PATCH', 204);
  const noop = () => {}, saved = async () => {};
  try {
    await t.test('isolated setup creates approved students and an applicant', async () => {
      await req(admin, '/auth/login', { identifier: process.env.PBS_BOOTSTRAP_ADMIN_EMAIL, password: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, role: 'admin' });
      await req(admin, '/auth/password', { current: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, next: password });
      courseId = (await req(admin, '/admin/courses', { title: 'Isolated course controls', category: 'QA', description: 'Temporary integration fixture', fee: 100000, published: true }, 'POST', 201)).course.id;
      const module = await req(admin, `/admin/courses/${courseId}/modules`, { title: 'QA module' }, 'POST', 201);
      lessonId = (await req(admin, `/admin/courses/${courseId}/modules/${module.id}/lessons`, { title: 'QA lesson', url: 'https://example.org/private-lesson.mp4' }, 'POST', 201)).id;
      taskId = (await req(admin, '/admin/tasks', { courseId, title: 'QA task', brief: 'Private lesson assignment', published: true })).id;
      liveId = (await req(admin, '/admin/live-classes', { courseId, title: 'QA live session', meetUrl: 'https://meet.google.com/abc-defg-hij', startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), published: true, accessConfirmed: true }, 'POST', 201)).id;
      first = await req(admin, '/admin/students', { courseId, name: 'Isolated first learner', email: 'controls-first@example.invalid', phone: '9899999991', total: 100000, amount: 25000, method: 'Bank transfer', reference: 'QA-controls-verified' }, 'POST', 201);
      second = await req(admin, '/admin/students', { courseId, name: 'Isolated other learner', email: 'controls-other@example.invalid', phone: '9899999992', total: 100000, amount: 0 }, 'POST', 201);
      for (const [client, record] of [[student, first], [other, second]] as const) {
        await req(client, '/auth/login', { identifier: record.student.email, password: record.temporaryPassword, role: 'student' });
        await req(client, '/auth/password', { current: record.temporaryPassword, next: password });
      }
      pending = await req(visitor, '/enrollments', { courseId, name: 'Isolated applicant', email: 'controls-applicant@example.invalid', phone: '9899999993', amount: 0 }, 'POST', 201);
      await req(student, `/student/lessons/${lessonId}/completion`, { completed: true }, 'POST', 204);
      await req(student, '/student/portfolio', { headline: 'Isolated QA portfolio', bio: 'Temporary record', projectUrl: 'https://example.org/qa', published: true }, 'PATCH');
    });

    await t.test('already assigned and pending courses remain visible with a management action', async () => {
      const workspace = await req(admin, '/admin/workspace');
      for (const [id, label] of [[first.student.id, 'Manage assigned course'], [pending.account.id, 'Review application']]) {
        const html = renderToStaticMarkup(createElement(EnrollStudentForm, { courses: workspace.courses, student: workspace.students.find((item: any) => item.id === id), onExisting: noop, onCreateCourse: noop, onClose: noop, onSaved: saved }));
        assert.ok(html.includes('Isolated course controls')); assert.ok(html.includes(label)); assert.ok(!html.includes('No available courses')); assert.match(html, /Agreed fee/); assert.match(html, /1,000/);
      }
      const fresh = renderToStaticMarkup(createElement(EnrollStudentForm, { courses: workspace.courses, onExisting: noop, onCreateCourse: noop, onClose: noop, onSaved: saved }));
      assert.match(fresh, /name="total"[^>]*value="1000"/);
      await req(admin, '/admin/students', { courseId, email: first.student.email, total: 100000, amount: 0 }, 'POST', 409);
      await req(admin, '/admin/students', { courseId, email: pending.account.email, total: 100000, amount: 0 }, 'POST', 409);
      assert.equal((await req(admin, '/admin/workspace')).enrollments.length, 3);
    });

    await t.test('missing UPI setup is visible and does not fabricate a payment destination', async () => {
      const catalog = await req(visitor, '/catalog');
      const html = renderToStaticMarkup(createElement(PaymentFields, { catalog, balance: 100000, optional: true }));
      assert.match(html, /UPI payment setup pending/); assert.match(html, /submit your application now/); assert.ok(!html.includes('upi://pay'));
      await req(visitor, '/enrollments', { courseId, name: 'Unconfigured payment', email: 'unconfigured@example.invalid', phone: '9899999995', amount: 10000, reference: 'QA-unconfigured' }, 'POST', 400);
    });

    await t.test('configured payments show an app link and full amount immediately while payment reporting stays optional', async () => {
      await req(admin, '/admin/payment-settings', { paymentUpiId: 'isolated-qa@upi', paymentName: 'Isolated QA payee', current: password }, 'PUT', 204);
      const catalog = await req(visitor, '/catalog');
      const html = renderToStaticMarkup(createElement(PaymentFields, { catalog, balance: 100000, optional: true }));
      assert.match(html, /Pay with UPI app/); assert.match(html, /Scan to pay/); assert.match(html, /upi:\/\/pay\?/); assert.match(html, /am=1000.00/);
      assert.match(html, /name="amount" value="0"/); assert.ok(!html.includes('name="reference"'));
      const required = renderToStaticMarkup(createElement(PaymentFields, { catalog, balance: 75000 }));
      assert.match(required, /name="amount"[^>]*value="750"/); assert.match(required, /name="reference"/);
      const applied = await req(visitor, '/enrollments', { courseId, name: 'Isolated paid applicant', email: 'controls-paid@example.invalid', phone: '9899999994', amount: 10000, reference: 'QA-controls-pending' }, 'POST', 201);
      assert.equal(applied.enrollment.requestedPayment, 10000); assert.equal(applied.enrollment.paid, 0); assert.equal(applied.enrollment.status, 'pending'); assert.equal(visitor.cookie, '');
    });

    await t.test('students and unauthenticated visitors cannot manage lifecycle controls', async () => {
      await req(visitor, `/admin/courses/${courseId}/pause`, { paused: true }, 'PATCH', 401);
      await req(student, `/admin/students/${second.student.id}/status`, { status: 'inactive', expectedStatus: 'active', reason: 'forbidden' }, 'PATCH', 403);
      await req(student, `/admin/students/${second.student.id}`, {}, 'DELETE', 403);
      await req(student, `/admin/enrollments/${second.enrollment.id}/pause`, { paused: true }, 'PATCH', 403);
    });

    await t.test('individual course pause blocks content, task and live links without affecting other students or receipts', async () => {
      await req(student, `/live-classes/${liveId}/join`, {});
      assert.equal((await req(student, '/student/tasks')).tasks.length, 1);
      await pauseEnrollment(true, false);
      const workspace = await req(student, '/student/workspace'); assert.equal(workspace.courses.length, 0); assert.equal(workspace.enrollments[0].accessPaused, true); assert.equal(workspace.receipts.length, 1); assert.equal(workspace.completions.length, 1);
      assert.equal((await req(student, '/student/tasks')).tasks.length, 0); assert.equal((await req(student, '/student/live-classes')).classes.length, 0);
      await req(student, `/courses/${courseId}/discussion`, undefined, 'GET', 404);
      await req(student, `/student/lessons/${lessonId}/completion`, { completed: true }, 'POST', 404);
      await req(student, `/student/tasks/${taskId}/submit`, { url: 'https://example.org/submission' }, 'POST', 404);
      await req(student, `/student/courses/${courseId}/certificate`, {}, 'POST', 404);
      await req(student, `/live-classes/${liveId}/join`, {}, 'POST', 404); await req(student, `/live-classes/${liveId}/calendar`, undefined, 'GET', 404);
      await assert.rejects(() => grantCourseAccess(db, first.enrollment.id, 'unused'), /resume course access/);
      assert.equal((await req(other, '/student/workspace')).courses.length, 1);
      await pauseEnrollment(false, true); assert.equal((await req(student, '/student/workspace')).courses.length, 1);
    });

    await t.test('whole-course pause keeps Explore details visible, stops new enrollment and preserves independent pauses', async () => {
      await pauseEnrollment(true, false); await pauseCourse(true, false);
      const catalog = await req(visitor, '/catalog'); assert.equal(catalog.courses[0].paused, true); assert.equal(catalog.courses[0].published, true);
      assert.equal((await req(visitor, `/catalog/${courseId}`)).paused, true);
      assert.equal((await req(other, '/student/workspace')).courses.length, 0);
      await req(visitor, '/enrollments', { courseId, name: 'Blocked applicant', email: 'blocked@example.invalid', phone: '9899999996', amount: 0 }, 'POST', 409);
      await req(admin, '/admin/students', { courseId, name: 'Blocked assignment', email: 'blocked-assignment@example.invalid', total: 100000, amount: 0 }, 'POST', 409);
      await req(admin, `/admin/enrollments/${pending.enrollment.id}/decision`, { decision: 'approved' }, 'POST', 409);
      await req(admin, `/admin/courses/${courseId}/pause`, { paused: false, expectedPaused: false, reason: '' }, 'PATCH', 409);
      await pauseCourse(false, true); assert.equal((await req(other, '/student/workspace')).courses.length, 1); assert.equal((await req(student, '/student/workspace')).courses.length, 0);
      await pauseEnrollment(false, true);
    });

    await t.test('deactivation signs out existing sessions, blocks sign-in and hides public portfolio', async () => {
      await req(visitor, `/portfolios/${first.student.id}`);
      await req(admin, `/admin/students/${first.student.id}/status`, { status: 'inactive', expectedStatus: 'active', reason: 'Isolated account hold' }, 'PATCH', 204);
      await req(student, '/student/workspace', undefined, 'GET', 401); assert.equal((await req(student, '/session')).account, null);
      await req(student, '/auth/login', { identifier: first.student.email, password, role: 'student' }, 'POST', 403);
      await req(visitor, `/portfolios/${first.student.id}`, undefined, 'GET', 404);
      await req(admin, '/admin/students', { courseId, email: first.student.email, total: 100000, amount: 0 }, 'POST', 409);
      await req(admin, `/admin/students/${first.student.id}/status`, { status: 'active', expectedStatus: 'active' }, 'PATCH', 409);
      await req(admin, `/admin/students/${first.student.id}/status`, { status: 'active', expectedStatus: 'inactive' }, 'PATCH', 204);
      await req(student, '/auth/login', { identifier: first.student.email, password, role: 'student' }); await req(visitor, `/portfolios/${first.student.id}`);
    });

    await t.test('delete requires password and exact email; restore retains fees and requires explicit reactivation', async () => {
      const body = { expectedStatus: 'active', current: password, confirmEmail: first.student.email, reason: 'Isolated deletion test' };
      await req(admin, `/admin/students/${first.student.id}`, { ...body, current: 'wrong-password' }, 'DELETE', 400);
      await req(admin, `/admin/students/${first.student.id}`, { ...body, confirmEmail: second.student.email }, 'DELETE', 400);
      await req(admin, `/admin/students/${first.student.id}`, body, 'DELETE', 204);
      await req(student, '/student/workspace', undefined, 'GET', 401); await req(visitor, `/portfolios/${first.student.id}`, undefined, 'GET', 404);
      const workspace = await req(admin, '/admin/workspace'), record = workspace.students.find((item: any) => item.id === first.student.id);
      assert.equal(record.accountStatus, 'deleted'); assert.equal(record.receipts[0].id, first.receipt.id); assert.equal(record.enrollments[0].paid, 25000); assert.equal(record.completedLessons, 1);
      await req(admin, `/admin/students/${first.student.id}/status`, { status: 'active', expectedStatus: 'deleted' }, 'PATCH', 409);
      await req(admin, `/admin/students/${first.student.id}/restore`, {}, 'POST', 204);
      await req(student, '/auth/login', { identifier: first.student.email, password, role: 'student' }, 'POST', 403);
      await req(admin, `/admin/students/${first.student.id}/status`, { status: 'active', expectedStatus: 'inactive' }, 'PATCH', 204);
      await req(student, '/auth/login', { identifier: first.student.email, password, role: 'student' }); assert.equal((await req(student, '/student/workspace')).receipts[0].id, first.receipt.id);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db.close(); rmSync(directory, { recursive: true, force: true });
  }
});
