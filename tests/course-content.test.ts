import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { signInApproved } from './admission-fixtures.js';
import { previouslyWatched } from './viewing-fixtures.js';

test('course content editing preserves existing media, progress and academy records', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pbs-course-content-'));
  for (const key of ['VERCEL','PBS_TURSO_DATABASE_URL','PBS_TURSO_AUTH_TOKEN','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','PBS_PUBLIC_ORIGIN','BLOB_STORE_ID','BLOB_READ_WRITE_TOKEN']) delete process.env[key];
  process.env.PBS_DATA_DIR = directory; process.env.PBS_BOOTSTRAP_CATALOG = '0';
  process.env.PBS_BOOTSTRAP_ADMIN_EMAIL = 'content-admin@example.invalid';
  process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD = 'Content-bootstrap-938!';
  process.env.PBS_INTEGRATION_KEY = 'd'.repeat(64);
  const password = 'Content-isolated-password-284!';
  const { createPortalApp } = await import('../server/app.js');
  const app = await createPortalApp(), db = app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const address = server.address(), origin = `http://127.0.0.1:${typeof address === 'object' ? address!.port : 0}`;
  type Client = { cookie: string }; const admin: Client = { cookie: '' }, student: Client = { cookie: '' }, visitor: Client = { cookie: '' };
  async function req(client: Client, url: string, body?: any, method = body === undefined ? 'GET' : 'POST', expected = 200) {
    const response = await fetch(origin + '/api' + url, { method, headers: { 'X-PBS-Request': '1', ...(client.cookie ? { Cookie: client.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.headers.get('set-cookie')) client.cookie = response.headers.get('set-cookie')!.split(';')[0];
    const text = await response.text(); assert.equal(response.status, expected, `${method} ${url}: ${text.slice(0, 350)}`);
    return text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
  }
  let course = '', otherCourse = '', first = '', second = '', empty = '', foreign = '', lesson = '', studentId = '', adminId = '';
  let preserved: Record<string, unknown>;
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const table of ['accounts','enrollments','receipts','academy_settings','course_storage','microsoft_connections','microsoft_mail_connections']) result[table] = await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
    return result;
  };
  const order = async () => (await req(admin, '/admin/workspace')).courses.find((c: any) => c.id === course).modules.map((m: any) => m.id);
  const base = () => `/admin/courses/${course}/modules`;
  async function seedPlayback(id: string) {
    const { videoSourceKey } = await import('../server/video.js');
    const row = await db.prepare('SELECT source_url,file_name FROM lessons WHERE id=?').get(id);
    const key = videoSourceKey(String(row!.source_url), String(row!.file_name)), at = new Date().toISOString();
    await previouslyWatched(db, studentId, id);
    await db.prepare('INSERT INTO completions VALUES (?,?,?)').run(studentId, id, at);
    await db.prepare('INSERT INTO lesson_video_owners VALUES (?,?)').run(id, adminId);
    await db.prepare('INSERT INTO lesson_media_durations VALUES (?,?,?)').run(id, key, 100);
    await db.prepare('INSERT INTO lesson_progress VALUES (?,?,?,?,?,?,?,?,?)').run(studentId, id, key, 80, 100, 'existing-revision', 'existing-writer', 1, at);
    await db.prepare('INSERT INTO lesson_watch_sessions VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), studentId, id, key, 100, 80, Date.now(), 1);
    return key;
  }
  async function assertRemoved(id: string) {
    assert.equal(await db.prepare('SELECT 1 FROM lessons WHERE id=?').get(id), undefined);
    for (const table of ['lesson_watch_sessions','lesson_watch_totals','lesson_media_durations','lesson_progress','lesson_video_owners','completions','video_uploads']) {
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE lesson_id=?`).get(id))!.n, 0, `${table} still refers to removed lesson`);
    }
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM drive_uploads WHERE kind='video' AND attached_id=?").get(id))!.n, 0);
  }
  try {
    await t.test('isolated setup records an existing video, learner and configured course folder', async () => {
      adminId = (await req(admin, '/auth/login', { identifier: process.env.PBS_BOOTSTRAP_ADMIN_EMAIL, password: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, role: 'admin' })).account.id;
      await req(admin, '/auth/password', { current: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, next: password });
      await req(admin, '/admin/profile', { name: 'Existing administrator', email: 'existing-admin@example.invalid', current: password }, 'PATCH');
      const create = async (title: string) => (await req(admin, '/admin/courses', { title, category: 'BIM', fee: 100000, published: true }, 'POST', 201)).course.id;
      course = await create('Existing course'); otherCourse = await create('Other course');
      first = (await req(admin, base(), { title: 'Foundations' }, 'POST', 201)).id;
      second = (await req(admin, base(), { title: 'Coordination' }, 'POST', 201)).id;
      empty = (await req(admin, base(), { title: 'Empty module' }, 'POST', 201)).id;
      foreign = (await req(admin, `/admin/courses/${otherCourse}/modules`, { title: 'Other course module' }, 'POST', 201)).id;
      lesson = (await req(admin, `${base()}/${first}/lessons`, { title: 'Existing video', duration: '10 min', description: 'Original notes', url: 'https://example.org/existing.mp4' }, 'POST', 201)).id;
      const enrolled = await req(admin, '/admin/students', { name: 'Existing student', email: 'existing-student@example.invalid', phone: '9890000000', courseId: course, total: 100000, amount: 20000, reference: 'QA-CONTENT-PAYMENT', method: 'UPI' }, 'POST', 201);
      await signInApproved(req, student, enrolled, password); studentId = (await req(student, '/session')).account.id;
      await db.prepare('INSERT INTO course_storage VALUES (?,?,?,?,?,?,?)').run(course, adminId, 'existing-drive', 'existing-folder', 'Existing videos', 'https://example.org/existing-folder', 1);
      await db.prepare('INSERT INTO lesson_video_owners VALUES (?,?)').run(lesson, adminId);
      await previouslyWatched(db, studentId, lesson);
      await db.prepare('INSERT INTO completions VALUES (?,?,?)').run(studentId, lesson, new Date().toISOString());
      preserved = await snapshot();
    });
    await t.test('content mutations require an administrator and stay within the selected course', async () => {
      await req(visitor, `${base()}/${first}`, { title: 'Bad', expectedTitle: 'Foundations' }, 'PATCH', 401);
      await req(student, `${base()}/${first}`, { title: 'Bad', expectedTitle: 'Foundations' }, 'PATCH', 403);
      await req(student, `${base()}/order`, { moduleIds: [first, second, empty], expectedIds: [first, second, empty] }, 'PUT', 403);
      await req(student, `${base()}/${empty}`, { confirm: true, expectedTitle: 'Empty module' }, 'DELETE', 403);
      await req(student, `/admin/courses/${course}/lessons/${lesson}/module`, { moduleId: second, expectedModuleId: first }, 'PATCH', 403);
      await req(admin, `${base()}/${foreign}`, { title: 'Bad', expectedTitle: 'Other course module' }, 'PATCH', 404);
    });
    await t.test('renaming changes only the module title and rejects an outdated edit', async () => {
      const originalLesson = await db.prepare('SELECT * FROM lessons WHERE id=?').get(lesson);
      await db.prepare('INSERT INTO module_details VALUES (?,?,?)').run(first, 'Existing summary', '["Existing objective"]');
      await db.prepare('INSERT INTO module_releases VALUES (?,?,?,?,?,?,?)').run(first, '', 'open', '', '', 0, 'existing-rule');
      await req(admin, `${base()}/${first}`, { title: 'Foundations revised', expectedTitle: 'Foundations' }, 'PATCH');
      await req(admin, `${base()}/${first}`, { title: 'Stale rename', expectedTitle: 'Foundations' }, 'PATCH', 409);
      assert.deepEqual(await db.prepare('SELECT * FROM lessons WHERE id=?').get(lesson), originalLesson);
      assert.equal((await db.prepare('SELECT summary FROM module_details WHERE module_id=?').get(first))!.summary, 'Existing summary');
      assert.equal((await db.prepare('SELECT revision FROM module_releases WHERE module_id=?').get(first))!.revision, 'existing-rule');
    });
    await t.test('reordering validates the complete list and is visible to learners without recreating content', async () => {
      const before = await db.prepare('SELECT * FROM lessons ORDER BY id').all();
      await req(admin, `${base()}/order`, { moduleIds: [second, empty, first], expectedIds: [first, second, empty] }, 'PUT');
      assert.deepEqual(await order(), [second, empty, first]);
      await req(admin, `${base()}/order`, { moduleIds: [second, empty, first], expectedIds: [first, second, empty] }, 'PUT');
      await req(admin, `${base()}/order`, { moduleIds: [first, second, empty], expectedIds: [first, second, empty] }, 'PUT', 409);
      await req(admin, `${base()}/order`, { moduleIds: [second, first, first], expectedIds: [second, empty, first] }, 'PUT', 400);
      await req(admin, `${base()}/order`, { moduleIds: [second, foreign, first], expectedIds: [second, empty, first] }, 'PUT', 409);
      await req(admin, `${base()}/order`, { moduleIds: [first], expectedIds: [second, empty, first] }, 'PUT', 409);
      assert.deepEqual((await req(student, '/student/workspace')).courses.find((c: any) => c.id === course).modules.map((m: any) => m.id), [second, empty, first]);
      assert.deepEqual(await db.prepare('SELECT * FROM lessons ORDER BY id').all(), before);
    });
    await t.test('moving retains the video identity, link, owners, completions and watched ranges', async () => {
      const before = await db.prepare('SELECT * FROM lessons WHERE id=?').get(lesson);
      const watched = await db.prepare('SELECT * FROM lesson_watch_totals WHERE lesson_id=?').all(lesson);
      const completions = await db.prepare('SELECT * FROM completions WHERE lesson_id=?').all(lesson);
      await req(admin, `/admin/modules/${second}/release`, { batchId: '', mode: 'manual', released: false }, 'PUT', 204);
      await req(admin, `/admin/courses/${course}/lessons/${lesson}/module`, { moduleId: foreign, expectedModuleId: first }, 'PATCH', 404);
      await req(admin, `/admin/courses/${otherCourse}/lessons/${lesson}/module`, { moduleId: foreign, expectedModuleId: first }, 'PATCH', 404);
      await req(admin, `/admin/courses/${course}/lessons/${lesson}/module`, { moduleId: second, expectedModuleId: first }, 'PATCH');
      await req(admin, `/admin/courses/${course}/lessons/${lesson}/module`, { moduleId: second, expectedModuleId: first }, 'PATCH');
      assert.deepEqual({ ...await db.prepare('SELECT * FROM lessons WHERE id=?').get(lesson) }, { ...before, module_id: second, position: 1 });
      assert.deepEqual(await db.prepare('SELECT * FROM lesson_watch_totals WHERE lesson_id=?').all(lesson), watched);
      assert.deepEqual(await db.prepare('SELECT * FROM completions WHERE lesson_id=?').all(lesson), completions);
      assert.equal((await db.prepare('SELECT admin_id FROM lesson_video_owners WHERE lesson_id=?').get(lesson))!.admin_id, adminId);
      await req(student, `/lessons/${lesson}/playback-status`, undefined, 'GET', 403);
      await req(admin, `/admin/courses/${course}/lessons/${lesson}/module`, { moduleId: first, expectedModuleId: first }, 'PATCH', 409);
    });
    await t.test('metadata edits retain the current media and replacing a link touches only the chosen video', async () => {
      const route = `${base()}/${second}/lessons`;
      await req(admin, route, { replaceId: lesson, title: 'Updated lesson title', duration: '12 min', description: 'Updated notes', url: '' });
      assert.equal((await db.prepare('SELECT source_url FROM lessons WHERE id=?').get(lesson))!.source_url, 'https://example.org/existing.mp4');
      assert.ok(await db.prepare('SELECT 1 FROM completions WHERE lesson_id=?').get(lesson));
      await req(admin, route, { replaceId: lesson, title: 'Updated lesson title', duration: '12 min', description: 'Updated notes', url: 'https://example.org/replacement.mp4' });
      assert.equal((await db.prepare('SELECT source_url FROM lessons WHERE id=?').get(lesson))!.source_url, 'https://example.org/replacement.mp4');
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM lessons').get())!.n, 1);
    });
    await t.test('module removal requires explicit content confirmation and blocks unfinished uploads', async () => {
      const deletion = { confirm: true, expectedTitle: 'Coordination' };
      await req(admin, `${base()}/${second}`, deletion, 'DELETE', 409);
      await db.prepare('INSERT INTO learning_tasks (id,course_id,module_id,title,brief,created_at) VALUES (?,?,?,?,?,?)').run('existing-task', course, empty, 'Existing assignment', 'Keep this task', new Date().toISOString());
      await req(admin, `${base()}/${empty}`, { confirm: true, expectedTitle: 'Empty module' }, 'DELETE', 409);
      await db.prepare('UPDATE learning_tasks SET module_id=? WHERE id=?').run(second, 'existing-task');
      const upload = await req(admin, `${base()}/${empty}/lessons/upload`, { contentType: 'video/mp4', size: 24 });
      assert.equal((await req(admin, `${base()}/${empty}/usage`)).uploads, 1);
      await req(admin, `${base()}/${empty}`, { confirm: true, expectedTitle: 'Empty module' }, 'DELETE', 409);
      await db.prepare('UPDATE video_uploads SET expires_at=? WHERE id=?').run(Date.now() - 1, upload.uploadId);
      await db.prepare('INSERT INTO drive_uploads VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('pending-drive',adminId,adminId,'video',course,'',empty,'','existing-drive','existing-folder','','existing.mp4',24,'video/mp4','sealed-session',Date.now()-1,'',new Date().toISOString());
      await req(admin, `${base()}/${empty}`, { confirm: true, expectedTitle: 'Empty module' }, 'DELETE', 409);
      await db.prepare('UPDATE drive_uploads SET created_at=? WHERE id=?').run(new Date(Date.now() - 172800000).toISOString(), 'pending-drive');
      await req(admin, `${base()}/${empty}`, { expectedTitle: 'Empty module' }, 'DELETE', 400);
      await req(admin, `${base()}/${empty}`, { confirm: true, expectedTitle: 'Old title' }, 'DELETE', 409);
      await req(admin, `${base()}/${empty}`, { confirm: true, expectedTitle: 'Empty module' }, 'DELETE', 204);
      assert.equal(await db.prepare('SELECT 1 FROM modules WHERE id=?').get(empty), undefined);
      assert.ok(await db.prepare('SELECT 1 FROM lessons WHERE id=?').get(lesson));
      assert.ok(await db.prepare('SELECT 1 FROM learning_tasks WHERE id=?').get('existing-task'));
      await req(admin, `${base()}/${empty}/lessons`, { title: 'Late request', url: 'https://example.org/late.mp4' }, 'POST', 404);
    });
    await t.test('removing one video validates the latest item and leaves shared source files and other lessons intact', async () => {
      const retained = await db.prepare('SELECT * FROM lessons WHERE id=?').get(lesson);
      const retainedWatch = await db.prepare('SELECT * FROM lesson_watch_totals WHERE lesson_id=?').all(lesson);
      const id = (await req(admin, `${base()}/${first}/lessons`, { title: 'Remove this video', duration: '10 min', url: 'https://example.org/shared.mp4' }, 'POST', 201)).id;
      const { videoDirectory } = await import('../server/database.js');
      const file = `${crypto.randomUUID()}.mp4`, location = path.join(videoDirectory, file);
      writeFileSync(location, Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex'));
      await db.prepare("UPDATE lessons SET source_url='',file_name=?,content_type='video/mp4' WHERE id=?").run(file, id);
      const sharedId = crypto.randomUUID();
      await db.prepare('INSERT INTO lessons VALUES (?,?,?,?,?,?,?,?,?)').run(sharedId, first, 'Keep shared file lesson', '', '', '', file, 'video/mp4', 2);
      const key = await seedPlayback(id), url = `/admin/courses/${course}/lessons/${id}`;
      const body = { confirm: true, expectedModuleId: first, expectedTitle: 'Remove this video', expectedMediaKey: key };
      await db.prepare('INSERT INTO video_uploads VALUES (?,?,?,?,?,?,?)').run('removed-video-upload', adminId, first, 'video/mp4', 24, Date.now() + 10000, id);
      await db.prepare('INSERT INTO drive_uploads VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('completed-video-upload',adminId,adminId,'video',course,'',first,'','existing-drive','existing-folder','existing-item','existing.mp4',24,'video/mp4','',Date.now()-1,id,new Date().toISOString());
      await req(visitor, url, body, 'DELETE', 401); await req(student, url, body, 'DELETE', 403);
      await req(admin, `/admin/courses/${otherCourse}/lessons/${id}`, body, 'DELETE', 404);
      await req(admin, url, { ...body, confirm: false }, 'DELETE', 400);
      await req(admin, url, { ...body, expectedModuleId: second }, 'DELETE', 409);
      await req(admin, url, { ...body, expectedMediaKey: 'old-video' }, 'DELETE', 409);
      await req(admin, url, body, 'DELETE', 204); await assertRemoved(id);
      assert.ok(existsSync(location), 'Deleting a course entry must keep its original file');
      assert.ok(await db.prepare('SELECT 1 FROM lessons WHERE id=?').get(sharedId));
      assert.deepEqual(await db.prepare('SELECT * FROM lessons WHERE id=?').get(lesson), retained);
      assert.deepEqual(await db.prepare('SELECT * FROM lesson_watch_totals WHERE lesson_id=?').all(lesson), retainedWatch);
      await req(student, `/lessons/${id}/video`, undefined, 'GET', 404);
    });
    await t.test('a populated module can be deleted atomically while assignments and their reviews are kept', async () => {
      const id = (await req(admin, base(), { title: 'Remove populated module' }, 'POST', 201)).id;
      const videos: string[] = [];
      for (const title of ['First removed recording', 'Second removed recording']) {
        const video = (await req(admin, `${base()}/${id}/lessons`, { title, url: 'https://example.org/kept-original.mp4' }, 'POST', 201)).id;
        videos.push(video); await seedPlayback(video);
      }
      await db.prepare('INSERT INTO module_details VALUES (?,?,?)').run(id, 'Removed module description', '[]');
      await db.prepare('INSERT INTO module_releases VALUES (?,?,?,?,?,?,?)').run(id, '', 'manual', '', '', 0, 'removed-rule');
      await db.prepare('INSERT INTO learning_tasks (id,course_id,module_id,title,brief,published,created_at) VALUES (?,?,?,?,?,1,?)').run('keep-submitted-task', course, id, 'Keep this assignment', 'Keep brief and submitted work', new Date().toISOString());
      await db.prepare('INSERT INTO task_submissions (id,task_id,account_id,url,note,feedback,submitted_at,reviewed_at) VALUES (?,?,?,?,?,?,?,?)').run('keep-reviewed-submission','keep-submitted-task',studentId,'https://example.org/student-work','Existing work','Existing review',new Date().toISOString(),new Date().toISOString());
      const task = await db.prepare('SELECT * FROM learning_tasks WHERE id=?').get('keep-submitted-task');
      const submission = await db.prepare('SELECT * FROM task_submissions WHERE id=?').get('keep-reviewed-submission');
      const retained = await db.prepare('SELECT * FROM lessons WHERE id=?').get(lesson);
      const url = `${base()}/${id}`, usage = await req(admin, `${url}/usage`);
      const body = { confirm: true, expectedTitle: usage.title, includeVideos: true, expectedLessonIds: usage.lessonIds, keepAssignments: true };
      assert.equal(usage.lessons, 2); assert.equal(usage.assignments, 1);
      await req(student, url, body, 'DELETE', 403);
      await req(admin, url, { ...body, expectedLessonIds: [videos[0]] }, 'DELETE', 409);
      await req(admin, url, { ...body, expectedLessonIds: [videos[0], videos[0]] }, 'DELETE', 400);
      await req(admin, url, { ...body, keepAssignments: false }, 'DELETE', 409);
      for (const video of videos) assert.ok(await db.prepare('SELECT 1 FROM lessons WHERE id=?').get(video));
      await req(admin, url, body, 'DELETE', 204);
      assert.equal(await db.prepare('SELECT 1 FROM modules WHERE id=?').get(id), undefined);
      assert.equal(await db.prepare('SELECT 1 FROM module_releases WHERE module_id=?').get(id), undefined);
      assert.equal(await db.prepare('SELECT 1 FROM module_details WHERE module_id=?').get(id), undefined);
      for (const video of videos) await assertRemoved(video);
      assert.deepEqual({ ...await db.prepare('SELECT * FROM learning_tasks WHERE id=?').get('keep-submitted-task') }, { ...task, module_id: '' });
      assert.deepEqual(await db.prepare('SELECT * FROM task_submissions WHERE id=?').get('keep-reviewed-submission'), submission);
      assert.deepEqual(await db.prepare('SELECT * FROM lessons WHERE id=?').get(lesson), retained);
      const publicOutline = await req(visitor, `/catalog/${course}`);
      assert.ok(!publicOutline.modules.some((module: any) => module.id === id));
    });
    await t.test('the editor keeps drag handles and video controls without up/down buttons', async () => {
      const { ModuleEditor } = await import('../src/live/ModuleEditor.js');
      const details = (await req(admin, '/admin/workspace')).courses.find((c: any) => c.id === course);
      const html = renderToStaticMarkup(createElement(ModuleEditor, { course: details, actions: { edit() {}, remove() {}, video() {}, move() {}, removeVideo() {} }, onChanged: async () => {} }));
      assert.match(html, /Reorder module 1/); assert.doesNotMatch(html, /pbs-module-arrow|up\/down buttons/);
      assert.doesNotMatch(html, /aria-label="Move [^"]+ (up|down)"/);
      for (const label of ['Edit module','Delete module','Edit video','Move video','Remove video']) assert.ok(html.includes(label));
    });
    await t.test('accounts, password hashes, settings, enrollments, receipts and Microsoft mappings remain identical', async () => {
      assert.deepEqual(await snapshot(), preserved);
      assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).length, 0);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(directory, { recursive: true, force: true });
  }
});
