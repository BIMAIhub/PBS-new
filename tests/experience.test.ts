import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('PBS discovery, offers, profiles, notifications and curriculum', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pbs-experience-test-'));
  for (const key of ['VERCEL', 'PBS_TURSO_DATABASE_URL', 'PBS_TURSO_AUTH_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'PBS_PUBLIC_ORIGIN', 'GEMINI_API_KEY', 'BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID']) delete process.env[key];
  process.env.PBS_DATA_DIR = directory;
  process.env.PBS_BOOTSTRAP_CATALOG = '1';
  process.env.PBS_BOOTSTRAP_ADMIN_EMAIL = 'experience-admin@example.invalid';
  process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD = 'Experience-bootstrap-928!';
  process.env.AI_GATEWAY_API_KEY = 'isolated-qa-gateway-key';
  const password = 'Experience-test-password-765!';
  const { createPortalApp } = await import('../server/app.js');
  const { provisionReferenceCatalog } = await import('../server/commerce.js');
  const { generateLearningText } = await import('../server/ai.js');
  const app = await createPortalApp(), db = app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); const base = `http://127.0.0.1:${typeof address === 'object' ? address!.port : 0}/api`;
  type Client = { cookie: string }; const admin: Client = { cookie: '' }, student: Client = { cookie: '' }, other: Client = { cookie: '' }, anonymous: Client = { cookie: '' };
  async function req(client: Client, endpoint: string, body?: any, method = body === undefined ? 'GET' : 'POST', expected = 200) {
    const binary = Buffer.isBuffer(body);
    const response = await fetch(base + endpoint, { method, headers: { 'X-PBS-Request': '1', ...(client.cookie ? { Cookie: client.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': binary ? 'application/pdf' : 'application/json' }) }, ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }) });
    const cookie = response.headers.get('set-cookie'); if (cookie) client.cookie = cookie.split(';')[0];
    const bytes = Buffer.from(await response.arrayBuffer()); const data = response.headers.get('content-type')?.includes('json') && bytes.length ? JSON.parse(bytes.toString()) : bytes;
    assert.equal(response.status, expected, `${method} ${endpoint}: ${bytes.toString().slice(0, 400)}`); return data;
  }
  let courseId = '', studentId = '', enrollmentId = '', certificate: any, moduleId = '', lessonId = '', draftId = '', taskId = '';
  const content = { description: 'Practical BIM coordination training', outcomes: ['Prepare a coordinated Revit model'], requirements: ['A Revit installation'], modules: [{ title: 'Model setup and coordination', summary: 'Set project units and review linked models.', objectives: ['Configure units', 'Review linked models'], assignment: { title: 'Prepare a linked project', brief: 'Create a project, configure units and document the linked-model setup.', deliverables: ['Project model', 'Setup explanation'] } }], capstone: { title: 'Coordinated project handover', brief: 'Present a model and an explanation of your coordination workflow.', deliverables: ['Model link', 'Coordination report'] } };
  try {
    await t.test('reference catalog is published once and contains no seeded student or recording', async () => {
      const catalog = await req(anonymous, '/catalog'); assert.equal(catalog.courses.length, 1); assert.match(catalog.courses[0].title, /Revit MEP/);
      courseId = catalog.courses[0].id; assert.equal(catalog.courses[0].fee, 1499900); assert.equal(catalog.courses[0].price.total, 1199920); assert.equal(catalog.offers[0].percent, 20);
      await provisionReferenceCatalog(db); assert.equal((await req(anonymous, '/catalog')).courses.length, 1);
      assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM accounts WHERE role = 'student'").get())!.total, 0);
      assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM lessons').get())!.total, 0);
      const info = await req(anonymous, `/catalog/${courseId}`); assert.equal(info.modules.length, 2); assert.ok(info.page.outcomes.length);
      await req(admin, '/auth/login', { identifier: process.env.PBS_BOOTSTRAP_ADMIN_EMAIL, password: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, role: 'admin' });
      await req(admin, '/auth/password', { current: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, next: password });
    });
    await t.test('offers use the best eligible discount and reject invalid fees', async () => {
      const id = (await req(admin, '/admin/promotions', { title: 'QA 30 percent', description: 'Test offer', kind: 'coupon', code: 'TEST30', percent: 30, active: true, maxUses: 0 })).id;
      const quote = await req(anonymous, '/enrollments/quote', { courseId, code: 'TEST30' }); assert.equal(quote.total, 1049930); assert.equal(quote.percent, 30);
      await req(anonymous, '/enrollments/quote', { courseId, code: 'INVALID' }, 'POST', 400);
      const baseInput = { courseId, name: 'Experience QA Learner', email: 'experience-student@example.invalid', password, amount: 0, code: 'TEST30' };
      await req(student, '/enrollments', { ...baseInput, quotedTotal: 1 }, 'POST', 409);
      assert.equal((await db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(baseInput.email)), undefined);
      const applied = await req(student, '/enrollments', { ...baseInput, quotedTotal: quote.total }, 'POST', 201);
      studentId = applied.account.id; enrollmentId = applied.enrollment.id; assert.equal(applied.enrollment.discount, 449970); assert.equal(applied.enrollment.promotionCode, 'TEST30');
      await req(admin, `/admin/promotions/${id}`, { title: 'QA changed offer', kind: 'coupon', code: 'TEST30', percent: 15, active: true, maxUses: 0 }, 'PUT');
      assert.equal((await req(student, '/student/workspace')).enrollments[0].total, 1049930);
    });
    await t.test('referrals reject self-use and reserve limited offers transactionally', async () => {
      await req(admin, '/admin/promotions', { title: 'QA referral', kind: 'referral', code: 'REFER35', percent: 35, ownerId: studentId, active: true, maxUses: 1 });
      await req(student, '/enrollments/quote', { courseId, code: 'REFER35' }, 'POST', 400);
      assert.equal((await req(student, '/student/referrals')).promotions[0].code, 'REFER35');
      const calls = [1, 2].map(async index => {
        const response = await fetch(base + '/enrollments', { method: 'POST', headers: { 'X-PBS-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId, name: `Referral QA ${index}`, email: `referral-${index}@example.invalid`, password, amount: 0, code: 'REFER35', quotedTotal: 974935 }) }); return response.status;
      });
      assert.deepEqual((await Promise.all(calls)).sort(), [201, 400]);
      assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM enrollment_prices WHERE code = ?').get('REFER35'))!.total, 1);
    });
    await t.test('targeted codes require the assigned email and public endpoints hide private offer data', async () => {
      await req(admin, '/admin/promotions', { title: 'QA personal offer', kind: 'coupon', code: 'PRIVATE40', percent: 40, assignedEmail: 'eligible@example.invalid', active: true });
      await req(anonymous, '/enrollments/quote', { courseId, code: 'PRIVATE40', email: 'wrong@example.invalid' }, 'POST', 400);
      assert.equal((await req(anonymous, '/enrollments/quote', { courseId, code: 'PRIVATE40', email: 'eligible@example.invalid' })).percent, 40);
      assert.equal(JSON.stringify(await req(anonymous, '/catalog')).includes('eligible@example.invalid'), false);
      await req(student, '/admin/promotions', undefined, 'GET', 403);
    });
    await t.test('notifications are account-scoped and persist read and popup acknowledgement', async () => {
      const applied = await req(other, '/enrollments', { courseId, name: 'Other Experience QA', email: 'other-experience@example.invalid', password, amount: 0 }, 'POST', 201);
      await req(student, '/student/messages', { subject: 'QA course question', body: 'Please check my course application.' }, 'POST', 204);
      const inbox = await req(admin, '/notifications'); assert.ok(inbox.items.some((item: any) => item.title === 'QA course question')); assert.ok(inbox.unread > 0);
      const id = inbox.items[0].id;
      await req(student, `/notifications/${encodeURIComponent(id)}`, { read: true }, 'PATCH', 404);
      await req(student, '/notifications/seen', { ids: [id] }, 'POST', 204);
      assert.equal((await req(admin, '/notifications')).items.find((item: any) => item.id === id).shownAt, '');
      await req(admin, '/notifications/seen', { ids: [id] }, 'POST', 204); assert.ok((await req(admin, '/notifications')).items.find((item: any) => item.id === id).shownAt);
      await req(admin, '/notifications/read-all', {}, 'POST', 204); assert.equal((await req(admin, '/notifications')).unread, 0);
      assert.equal((await req(other, '/notifications')).items.some((item: any) => item.title === 'QA course question'), false);
      await req(admin, `/admin/enrollments/${enrollmentId}/decision`, { decision: 'approved', recordPayment: false });
      assert.ok((await req(student, '/notifications')).items.some((item: any) => item.kind === 'enrollment'));
    });
    await t.test('profile and PDF CV are private until both portfolio and CV sharing are enabled', async () => {
      await req(student, '/student/profile/details', { name: 'Experience QA Learner', phone: '+919800000000', headline: 'BIM learner', location: 'QA City', about: 'My work', skills: ['Revit', 'Coordination'], showCv: false }, 'PATCH');
      await req(student, '/student/profile/cv?filename=bad.pdf', Buffer.from('not-a-pdf-file'), 'POST', 400);
      const { jsPDF } = await import('jspdf'); const pdf = new jsPDF(); pdf.text('Isolated QA curriculum vitae', 20, 20); const bytes = Buffer.from(pdf.output('arraybuffer'));
      const uploaded = await req(student, '/student/profile/cv?filename=QA-CV.pdf', bytes, 'POST', 201); assert.equal(uploaded.cvName, 'QA-CV.pdf'); assert.equal('cv_path' in uploaded, false);
      await req(anonymous, `/portfolios/${studentId}/cv`, undefined, 'GET', 404);
      await req(other, '/student/profile/cv', undefined, 'GET', 404);
      const privatePdf = await req(student, '/student/profile/cv'); assert.equal(privatePdf.subarray(0, 5).toString(), '%PDF-');
    });
    await t.test('portfolio builder saves atomically and publishes only selected profile and credential fields', async () => {
      const sections = { layout: 'gallery', accentColor: '#176BB7', projects: [{ title: 'QA coordinated model', summary: 'A test project', tools: 'Revit', url: 'https://example.org/project' }], experience: [{ title: 'QA role', organization: 'QA practice', period: '2026', description: 'Model coordination' }], education: [] };
      const builder = { headline: 'BIM practitioner', bio: 'My project practice', projectUrl: '', linkedin: 'https://www.linkedin.com/in/qa', github: '', website: '', published: true, showCv: true, sections };
      await req(student, '/student/portfolio/builder', { ...builder, sections: { ...sections, projects: [{ title: 'Bad link', summary: '', tools: '', url: 'javascript:alert(1)' }] } }, 'PUT', 400);
      await req(anonymous, `/portfolios/${studentId}`, undefined, 'GET', 404);
      await req(student, '/student/portfolio/builder', builder, 'PUT', 204);
      const portfolio = await req(anonymous, `/portfolios/${studentId}`); assert.equal(portfolio.sections.layout, 'gallery'); assert.equal(portfolio.profile.cvAvailable, true); assert.equal(portfolio.profile.location, 'QA City'); assert.equal('phone' in portfolio.profile, false); assert.equal('email' in portfolio, false); assert.equal(JSON.stringify(portfolio).includes('cv_path'), false);
      assert.equal((await req(anonymous, `/portfolios/${studentId}/cv`)).subarray(0, 5).toString(), '%PDF-');
      await req(student, '/student/profile/details', { name: 'Experience QA Learner', phone: '', skills: [], showCv: false }, 'PATCH'); await req(anonymous, `/portfolios/${studentId}/cv`, undefined, 'GET', 404);
      await req(student, '/student/profile/cv', undefined, 'DELETE', 204); assert.equal((await req(student, '/student/profile/details')).cvName, '');
    });
    await t.test('AI curriculum generation is a validated draft and applies once after review', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input, init) => {
        if (String(input).startsWith('https://ai-gateway.vercel.sh/')) {
          const body = JSON.parse(String(init?.body)); assert.equal(body.model, 'google/gemini-2.5-flash-lite'); assert.equal(body.response_format.type, 'json_object');
          return new Response(JSON.stringify({ model: 'google/gemini-2.5-flash-lite', choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return originalFetch(input, init);
      }) as typeof fetch;
      try {
        await req(student, `/admin/courses/${courseId}/curriculum/draft`, { brief: 'Do not allow students to generate curricula.' }, 'POST', 403);
        const before = (await req(admin, '/admin/workspace')).courses[0].modules.length;
        const draft = await req(admin, `/admin/courses/${courseId}/curriculum/draft`, { brief: 'Prepare a module on linked-model setup and a practical assignment.' }); draftId = draft.id;
        assert.equal((await req(admin, '/admin/workspace')).courses[0].modules.length, before);
        await req(admin, `/admin/curriculum/${draftId}/apply`, { content: { ...content, modules: [] } }, 'POST', 400);
        await req(admin, `/admin/curriculum/${draftId}/apply`, { content, publishTasks: true, updateDescription: false });
        assert.equal((await req(admin, `/admin/curriculum/${draftId}/apply`, { content, publishTasks: true })).alreadyApplied, true);
        const course = (await req(admin, '/admin/workspace')).courses[0]; assert.equal(course.modules.length, before + 1); moduleId = course.modules.at(-1).id;
        assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM lessons').get())!.total, 0);
      } finally { globalThis.fetch = originalFetch; }
    });
    await t.test('module assignments enforce enrollment and return instructor feedback', async () => {
      const tasks = (await req(student, '/student/tasks')).tasks; assert.equal(tasks.length, 2); taskId = tasks[0].id;
      assert.equal((await req(other, '/student/tasks')).tasks.length, 0);
      await req(other, `/student/tasks/${taskId}/submit`, { url: 'https://example.org/submission' }, 'POST', 404);
      await req(student, `/student/tasks/${taskId}/submit`, { url: 'https://example.org/submission', note: 'QA project submission' }, 'POST', 204);
      const submission = (await req(admin, '/admin/curriculum')).submissions[0]; assert.equal(submission.studentName, 'Experience QA Learner');
      await req(student, `/admin/task-submissions/${submission.id}`, { feedback: 'Not allowed' }, 'PATCH', 403);
      await req(admin, `/admin/task-submissions/${submission.id}`, { feedback: 'Clear setup. Review naming conventions.' }, 'PATCH', 204);
      assert.equal((await req(student, '/student/tasks')).tasks[0].submission.feedback, 'Clear setup. Review naming conventions.');
      assert.ok((await req(student, '/notifications')).items.some((item: any) => item.title === 'Assignment feedback available'));
    });
    await t.test('certificate-ready notifications require real lesson completion and a passed assessment', async () => {
      assert.equal((await req(student, '/notifications')).items.some((item: any) => item.kind === 'certificate'), false);
      lessonId = (await req(admin, `/admin/courses/${courseId}/modules/${moduleId}/lessons`, { title: 'QA linked model lesson', duration: '5 min', description: '', url: 'https://example.org/lesson.mp4' }, 'POST', 201)).id;
      await req(admin, `/admin/courses/${courseId}/assessment`, { questions: [{ prompt: 'Should linked model coordinates be reviewed?', options: ['Yes', 'No'], answer: 0 }], passingScore: 75 }, 'PUT', 204);
      await req(student, `/student/courses/${courseId}/certificate`, {}, 'POST', 409);
      await req(student, `/student/lessons/${lessonId}/completion`, { completed: true }, 'POST', 204);
      await req(student, `/student/courses/${courseId}/assessment`, { answers: [0] });
      const ready = await req(student, '/notifications'); assert.equal(ready.items.filter((item: any) => item.kind === 'certificate').length, 1);
      assert.equal((await req(student, '/notifications')).items.filter((item: any) => item.kind === 'certificate').length, 1);
      certificate = await req(student, `/student/courses/${courseId}/certificate`, {});
      assert.equal((await req(anonymous, `/portfolios/${studentId}`)).certificates.length, 0);
      await req(student, `/student/certificates/${certificate.id}`, { published: true }, 'PATCH', 204);
      assert.equal((await req(anonymous, `/portfolios/${studentId}`)).certificates[0].id, certificate.id);
      const publicCourse = await req(anonymous, `/catalog/${courseId}`); assert.equal(JSON.stringify(publicCourse).includes('https://example.org/lesson.mp4'), false);
    });
    await t.test('AI service errors do not expose credentials and daily limits stop provider calls', async () => {
      await assert.rejects(() => generateLearningText('QA system', 'QA prompt', false, async () => new Response('private provider body', { status: 402 })), /credits or a spending limit/);
      const adminId = (await req(admin, '/session')).account.id;
      for (let index = 0; index < 20; index++) await db.prepare("INSERT INTO curriculum_drafts (id, course_id, admin_id, brief, content, created_at, status) VALUES (?, ?, ?, '', '', ?, 'failed')").run(`qa-limit-${index}`, courseId, adminId, new Date().toISOString());
      await req(admin, `/admin/courses/${courseId}/curriculum/draft`, { brief: 'A request above the daily limit.' }, 'POST', 429);
      assert.equal(JSON.stringify(await req(admin, '/admin/curriculum')).includes(process.env.AI_GATEWAY_API_KEY!), false);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db.close(); rmSync(directory, { recursive: true, force: true });
  }
});
