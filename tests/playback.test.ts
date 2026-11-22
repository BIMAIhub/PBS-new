import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('inline Microsoft video and account-scoped resume preserve existing records', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pbs-playback-test-'));
  for (const key of ['VERCEL', 'PBS_TURSO_DATABASE_URL', 'PBS_TURSO_AUTH_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'PBS_PUBLIC_ORIGIN', 'BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID', 'PBS_PAYMENT_UPI_ID']) delete process.env[key];
  process.env.PBS_DATA_DIR = directory; process.env.PBS_BOOTSTRAP_CATALOG = '0';
  process.env.PBS_BOOTSTRAP_ADMIN_EMAIL = 'playback-admin@example.invalid'; process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD = 'Playback-bootstrap-184!';
  const password = 'Isolated-playback-password-957!';
  const { createPortalApp } = await import('../server/app.js');
  const { mountMedia } = await import('../server/media.js');
  const { apiError } = await import('../server/http.js');
  const { resolveMicrosoftVideo } = await import('../server/microsoft-video.js');
  const { videoPlayback, videoSourceKey } = await import('../server/video.js');
  const { provisionInitialAdministrator } = await import('../server/administrators.js');
  const { Classroom } = await import('../src/live/Classroom.js');
  const { playbackTime, resumeTime } = await import('../src/live/playback-types.js');
  const app = await createPortalApp(), db = app.locals.portalDatabase as import('../server/database.js').WritableDatabase;
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(), origin = `http://127.0.0.1:${typeof address === 'object' ? address!.port : 0}`;
  const mini = express(); let resolutions = 0;
  mountMedia(mini, db, false, async () => { resolutions++; return 'https://qa.files.1drv.com/lesson.mp4?temporary=isolated-test'; });
  mini.use(apiError);
  const miniServer = mini.listen(0, '127.0.0.1'); await new Promise<void>(resolve => miniServer.once('listening', resolve));
  const miniAddress = miniServer.address(), mediaOrigin = `http://127.0.0.1:${typeof miniAddress === 'object' ? miniAddress!.port : 0}`;
  type Client = { cookie: string }; const admin: Client = { cookie: '' }, student: Client = { cookie: '' }, other: Client = { cookie: '' }, visitor: Client = { cookie: '' };
  async function request(client: Client, endpoint: string, body?: any, method = body === undefined ? 'GET' : 'POST', expected = 200, base = origin) {
    const response = await fetch(base + '/api' + endpoint, { method, redirect: 'manual', headers: { 'X-PBS-Request': '1', ...(client.cookie ? { Cookie: client.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const cookie = response.headers.get('set-cookie'); if (cookie) client.cookie = cookie.split(';')[0];
    const raw = await response.text(), data = raw && response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : raw;
    assert.equal(response.status, expected, `${method} ${endpoint}: ${raw.slice(0, 220)}`); return { data, response };
  }
  const req = async (...args: Parameters<typeof request>) => (await request(...args)).data;
  let adminId = '', courseId = '', moduleId = '', oneDrive = '', secondLesson = '', studentRecord: any, otherRecord: any, saved: any, preserved: any;
  const source = 'https://1drv.ms/v/s!isolated-test-sharing-video?e=qa';
  const snapshots = async () => ({ accounts: await db.prepare('SELECT id, password_hash, email, phone, must_change FROM accounts ORDER BY id').all(), settings: await db.prepare('SELECT * FROM academy_settings ORDER BY key').all(), connection: await db.prepare('SELECT * FROM microsoft_connections').all(), storage: await db.prepare('SELECT * FROM course_storage').all(), enrollments: await db.prepare('SELECT * FROM enrollments ORDER BY id').all() });
  const save = async (body: any, expected = 200) => req(student, `/student/lessons/${oneDrive}/playback`, { mediaKey: videoSourceKey(source, ''), writerId: 'isolated-player-one', sequence: 1, revision: '', position: 85.125, duration: 300, ...body }, 'PUT', expected);
  try {
    await t.test('setup uses temporary fixtures, saved branding, payment settings and an existing student password', async () => {
      adminId = (await req(admin, '/auth/login', { identifier: process.env.PBS_BOOTSTRAP_ADMIN_EMAIL, password: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, role: 'admin' })).account.id;
      await req(admin, '/auth/password', { current: process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD, next: password });
      courseId = (await req(admin, '/admin/courses', { title: 'Isolated native video course', category: 'QA', fee: 100000, published: true }, 'POST', 201)).course.id;
      moduleId = (await req(admin, `/admin/courses/${courseId}/modules`, { title: 'Video module' }, 'POST', 201)).id;
      oneDrive = (await req(admin, `/admin/courses/${courseId}/modules/${moduleId}/lessons`, { title: 'OneDrive recording', url: source }, 'POST', 201)).id;
      secondLesson = (await req(admin, `/admin/courses/${courseId}/modules/${moduleId}/lessons`, { title: 'Second recording', url: 'https://example.org/qa.mp4' }, 'POST', 201)).id;
      studentRecord = await req(admin, '/admin/students', { courseId, name: 'Isolated playback learner', email: 'playback-student@example.invalid', total: 100000, amount: 0 }, 'POST', 201);
      const anotherCourse = (await req(admin, '/admin/courses', { title: 'Other isolated course', category: 'QA', fee: 100000, published: false }, 'POST', 201)).course.id;
      otherRecord = await req(admin, '/admin/students', { courseId: anotherCourse, name: 'Isolated other learner', email: 'playback-other@example.invalid', total: 100000, amount: 0 }, 'POST', 201);
      for (const [client, record] of [[student, studentRecord], [other, otherRecord]] as const) {
        await req(client, '/auth/login', { identifier: record.student.email, password: record.temporaryPassword, role: 'student' });
        await req(client, '/auth/password', { current: record.temporaryPassword, next: password });
      }
      await req(admin, '/admin/payment-settings', { paymentUpiId: 'qa-preserved@upi', paymentName: 'Existing QA payee', current: password }, 'PUT', 204);
      await db.prepare('INSERT INTO academy_settings VALUES (?, ?)').run('existing_custom_preference', JSON.stringify({ theme: '#176BB7', logo: 'saved-logo', header: 'saved-text' }));
      await db.prepare('INSERT INTO microsoft_connections VALUES (?, ?, ?, ?, ?)').run(adminId, 'owner@example.invalid', 'Saved Microsoft owner', 'opaque-qa-cache', new Date().toISOString());
      await db.prepare('INSERT INTO course_storage VALUES (?, ?, ?, ?, ?, ?, ?)').run(courseId, adminId, 'saved-drive', 'saved-folder', 'Existing course folder', 'https://onedrive.live.com/qa', 1);
      preserved = await snapshots();
    });

    await t.test('ordinary OneDrive/SharePoint shares become inline native video sources', async () => {
      for (const url of [source, 'https://onedrive.live.com/?id=AA!BB&authkey=qa', 'https://onedrive.live.com/embed?resid=AA!BB&authkey=qa', 'https://tenant-my.sharepoint.com/:v:/g/personal/qa/video']) {
        const parsed = videoPlayback(url); assert.equal(parsed.kind, 'video'); assert.equal(parsed.provider, 'microsoft');
      }
      assert.equal(videoPlayback('https://sharepoint.com.evil.invalid/qa.mp4').provider, undefined);
      const workspace = await req(student, '/student/workspace'), lesson = workspace.courses[0].modules[0].lessons[0];
      assert.equal(lesson.playback.url, `/api/lessons/${oneDrive}/video`); assert.equal(lesson.playback.kind, 'video'); assert.equal(lesson.playback.source, undefined);
      assert.equal(lesson.mediaKey, videoSourceKey(source, ''));
      const adminWorkspace = await req(admin, '/admin/workspace'); assert.equal(adminWorkspace.courses.find((item: any) => item.id === courseId).modules[0].lessons[0].playback.source, source);
      const html = renderToStaticMarkup(createElement(Classroom, { course: workspace.courses[0], completed: new Set<string>(), onClose: () => {} }));
      assert.ok(html.includes('<video')); assert.ok(html.includes('Play video')); assert.ok(html.includes('Playback speed')); assert.ok(html.includes('nodownload'));
      assert.ok(!html.includes('Watch on the video provider')); assert.ok(!html.includes('Open video')); assert.ok(!html.includes('href="https://1drv.ms'));
    });

    await t.test('Microsoft file resolution uses the saved owner and encoded share; folders and unsafe targets fail', async () => {
      let calls = 0;
      const graph: any = async (_db: unknown, owner: string, endpoint: string) => {
        calls++; assert.equal(owner, adminId); assert.ok(endpoint.startsWith(`/shares/u!${Buffer.from(source).toString('base64url')}/driveItem`));
        return { id: 'qa-video', file: { mimeType: 'video/mp4' }, video: { duration: 300000 }, '@microsoft.graph.downloadUrl': 'https://qa.files.1drv.com/lesson.mp4?temporary=isolated-test' };
      };
      assert.match(await resolveMicrosoftVideo(db, courseId, oneDrive, source, graph), /^https:\/\/qa.files.1drv.com/); assert.equal(calls, 1);
      await assert.rejects(() => resolveMicrosoftVideo(db, courseId, oneDrive, source, (async () => ({ folder: {} })) as any), /not a video file/);
      await assert.rejects(() => resolveMicrosoftVideo(db, courseId, oneDrive, source, (async () => ({ file: { mimeType: 'video/mp4' }, '@microsoft.graph.downloadUrl': 'https://unsafe.invalid/file.mp4' })) as any), /unsupported video location/);
    });

    await t.test('the inline media endpoint checks enrollment before issuing a file-stream redirect', async () => {
      const result = await request(student, `/lessons/${oneDrive}/video`, undefined, 'GET', 302, mediaOrigin);
      assert.equal(result.response.headers.get('location'), 'https://qa.files.1drv.com/lesson.mp4?temporary=isolated-test');
      await req(student, `/lessons/${oneDrive}/playback-status`, undefined, 'GET', 200, mediaOrigin); const prior = resolutions;
      await req(visitor, `/lessons/${oneDrive}/video`, undefined, 'GET', 401, mediaOrigin);
      await req(other, `/lessons/${oneDrive}/video`, undefined, 'GET', 404, mediaOrigin);
      assert.equal(resolutions, prior);
    });

    await t.test('a pause position saves with sub-second precision and is returned on a later visit', async () => {
      saved = (await save({})).progress; assert.equal(saved.position, 85.125);
      const restored = await req(student, `/student/courses/${courseId}/playback`);
      assert.equal(restored.lastLessonId, oneDrive); assert.equal(restored.positions[0].position, 85.125); assert.equal(restored.positions[0].duration, 300);
      assert.equal(restored.positions[0].mediaKey, videoSourceKey(source, '')); assert.ok(!JSON.stringify(restored).includes('1drv.ms'));
      assert.equal(resumeTime(restored.positions[0].position, 300), 85.125); assert.equal(resumeTime(299.5, 300), 299.5); assert.equal(resumeTime(300, 300), 0);
      assert.equal(playbackTime(85.125), '1:25'); assert.equal(playbackTime(3661), '1:01:01');
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM completions').get())!.n, 0);
    });

    await t.test('late retries and another window cannot silently replace a newer saved position', async () => {
      const repeated = (await save({ position: 2 })).progress; assert.equal(repeated.revision, saved.revision); assert.equal(repeated.position, 85.125);
      const changed = (await save({ sequence: 2, revision: saved.revision, position: 92 })).progress;
      await save({ writerId: 'other-window', sequence: 1, revision: saved.revision, position: 10 }, 409);
      const rewind = (await save({ sequence: 3, revision: changed.revision, position: 40.5 })).progress; assert.equal(rewind.position, 40.5); saved = rewind;
      const late = (await save({ sequence: 2, revision: changed.revision, position: 92 })).progress; assert.equal(late.position, 40.5);
    });

    await t.test('resume selects the last watched lesson and preserves each lesson position separately', async () => {
      await req(student, `/student/lessons/${secondLesson}/playback`, { mediaKey: videoSourceKey('https://example.org/qa.mp4', ''), writerId: 'isolated-player-one', sequence: 4, revision: '', position: 122.75, duration: 600 }, 'PUT');
      const restored = await req(student, `/student/courses/${courseId}/playback`); assert.equal(restored.positions.length, 2); assert.equal(restored.lastLessonId, secondLesson);
      assert.equal(restored.positions.find((item: any) => item.lessonId === oneDrive).position, 40.5);
    });

    await t.test('playback history is account-scoped and invalid values are rejected', async () => {
      await req(visitor, `/student/courses/${courseId}/playback`, undefined, 'GET', 401);
      await req(other, `/student/courses/${courseId}/playback`, undefined, 'GET', 404);
      await req(admin, `/student/courses/${courseId}/playback`, undefined, 'GET', 403);
      await req(other, `/student/lessons/${oneDrive}/playback`, { accountId: studentRecord.student.id, mediaKey: videoSourceKey(source, ''), writerId: 'attack', sequence: 1, position: 30, duration: 300, revision: '' }, 'PUT', 404);
      for (const values of [{ position: -2 }, { position: 301.5 }, { position: '42' }, { duration: null }, { duration: 0 }]) await save(values, 400);
      assert.equal((await req(student, `/student/courses/${courseId}/playback`)).positions.find((item: any) => item.lessonId === oneDrive).position, 40.5);
    });

    await t.test('course and account pauses block both media and progress without resetting history', async () => {
      await req(admin, `/admin/enrollments/${studentRecord.enrollment.id}/pause`, { paused: true, expectedPaused: false, reason: 'Isolated QA hold' }, 'PATCH', 204);
      await req(student, `/lessons/${oneDrive}/video`, undefined, 'GET', 404, mediaOrigin); await save({ sequence: 5, revision: saved.revision }, 404);
      await req(student, `/student/courses/${courseId}/playback`, undefined, 'GET', 404);
      await req(admin, `/admin/enrollments/${studentRecord.enrollment.id}/pause`, { paused: false, expectedPaused: true }, 'PATCH', 204);
      assert.equal((await req(student, `/student/courses/${courseId}/playback`)).positions.length, 2);
    });

    await t.test('replacing a recording never resumes at the old file timestamp', async () => {
      await req(admin, `/admin/courses/${courseId}/modules/${moduleId}/lessons`, { replaceId: oneDrive, title: 'Updated recording', url: 'https://example.org/replacement.mp4' }, 'POST', 200);
      const restored = await req(student, `/student/courses/${courseId}/playback`); assert.equal(restored.positions.some((item: any) => item.lessonId === oneDrive), false);
      await save({ sequence: 6, revision: saved.revision }, 409);
    });

    await t.test('playback and startup leave saved passwords, settings, connections and enrollment records unchanged', async () => {
      assert.deepEqual(await snapshots(), preserved);
      process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD = 'Different-bootstrap-must-not-reset-914!'; await provisionInitialAdministrator(db);
      assert.deepEqual(await snapshots(), preserved);
    });
  } finally {
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => miniServer.close(() => resolve()))]); db.close(); rmSync(directory, { recursive: true, force: true });
  }
});
