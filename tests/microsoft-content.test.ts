import { test } from 'node:test';
import assert from 'node:assert/strict';
import { microsoftDownloadLocation, readMicrosoftContentLocation } from '../server/microsoft-content.js';

test('Microsoft content redirects produce native playback URLs without following or leaking credentials', async () => {
  let cancelled = false, calls = 0;
  const transport: typeof fetch = async (input, init) => {
    calls++; assert.equal(input, 'https://graph.microsoft.com/v1.0/drives/course-drive/items/video%21one/content');
    assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'manual');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer isolated-qa-token');
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 302, headers: { location: 'https://qa.files.1drv.com/video.mp4?temporary=isolated-test' } });
  };
  const result = await readMicrosoftContentLocation('isolated-qa-token', '/drives/course-drive/items/video%21one/content', transport);
  assert.equal(result, 'https://qa.files.1drv.com/video.mp4?temporary=isolated-test'); assert.equal(calls, 1); assert.equal(cancelled, true);
});

test('content redirects accept encoded shares and Microsoft SharePoint delivery', async () => {
  const result = await readMicrosoftContentLocation('isolated-qa-token', '/shares/u!aHR0cHM6Ly8xZHJ2Lm1z/driveItem/content', async () => new Response(null, { status: 307, headers: { location: 'https://qa.sharepoint.com/download.aspx?file=qa' } }));
  assert.equal(result, 'https://qa.sharepoint.com/download.aspx?file=qa');
});

test('personal OneDrive delivery hosts support native playback and content redirects', async () => {
  for (const host of ['my.microsoftpersonalcontent.com', 'storage.live.com', 'qa.storage.live.com', 'public.qa.livefilestore.com', 'qa.storage.msn.com']) {
    const location = `https://${host}/personal/recording.mp4?tempauth=isolated-test`;
    assert.equal(microsoftDownloadLocation(location), location);
    assert.equal(await readMicrosoftContentLocation('isolated-qa-token', '/drives/a/items/b/content', async (_input, init) => {
      assert.equal(init?.redirect, 'manual');
      return new Response(null, { status: 302, headers: { location } });
    }), location);
  }
});

test('Microsoft permission errors preserve the access denial and omit raw provider details', async () => {
  for (const status of [401, 403]) {
    await assert.rejects(() => readMicrosoftContentLocation('isolated-qa-token', '/drives/a/items/b/content', async () => new Response(JSON.stringify({ error: { code: 'accessDenied', message: 'Private provider detail: isolated-qa-token' } }), { status })), (error: any) => {
      assert.equal(error.status, 502); assert.match(error.message, /denied access.*accessDenied/); assert.ok(!error.message.includes('Private provider')); assert.ok(!error.message.includes('isolated-qa-token')); return true;
    });
  }
});

test('missing files and throttling provide actionable errors without private payloads', async () => {
  await assert.rejects(() => readMicrosoftContentLocation('qa', '/drives/a/items/b/content', async () => new Response('{}', { status: 404 })), /could not find this recording/);
  await assert.rejects(() => readMicrosoftContentLocation('qa', '/drives/a/items/b/content', async () => new Response('{"error":{"code":"<private>"}}', { status: 429 })), (error: any) => error.status === 503 && error.message.includes('(429)') && !error.message.includes('<private>'));
});

test('an omitted Location header is a playback response error, not a permissions assertion', async () => {
  await assert.rejects(() => readMicrosoftContentLocation('qa', '/drives/a/items/b/content', async () => new Response(null, { status: 302 })), /did not return a video playback address/);
});

test('unexpected binary responses are cancelled without buffering a complete recording', async () => {
  let cancelled = false;
  await assert.rejects(() => readMicrosoftContentLocation('qa', '/drives/a/items/b/content', async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200, headers: { 'content-type': 'video/mp4' } })), /seekable video address/);
  assert.equal(cancelled, true);
});

test('invalid content paths are rejected before sending an access token', async () => {
  let calls = 0;
  for (const path of ['https://unsafe.invalid/content', '//unsafe.invalid/content', '/me/sendMail', '/drives/a/items/b/content?redirect=unsafe', '/shares/not-an-encoded-link/driveItem/content']) {
    await assert.rejects(() => readMicrosoftContentLocation('qa', path, async () => { calls++; throw new Error('Should never fetch'); }), /request is invalid/);
  }
  assert.equal(calls, 0);
});

test('untrusted, insecure and credential-bearing playback targets stay blocked', async () => {
  for (const url of ['http://qa.files.1drv.com/video.mp4', 'https://1drv.com.unsafe.invalid/video.mp4', 'https://my.microsoftpersonalcontent.com.unsafe.invalid/video.mp4', 'https://unsafe-microsoftpersonalcontent.com/video.mp4', 'https://storage.live.com.unsafe.invalid/video.mp4', 'https://localhost/video.mp4', 'https://127.0.0.1/video.mp4', 'https://qa.files.1drv.com:8443/video.mp4', 'https://my.microsoftpersonalcontent.com:8443/video.mp4', 'https://user:password@qa.files.1drv.com/video.mp4', 'https://my.microsoftpersonalcontent.com@unsafe.invalid/video.mp4']) {
    assert.throws(() => microsoftDownloadLocation(url), /video location/);
    await assert.rejects(() => readMicrosoftContentLocation('qa', '/drives/a/items/b/content', async () => new Response(null, { status: 302, headers: { location: url } })), /video location/);
  }
});

test('unsupported location diagnostics expose only the hostname', () => {
  assert.throws(() => microsoftDownloadLocation('https://unknown.invalid/private-recording?tempauth=private-token'), (error: any) => {
    assert.match(error.message, /unsupported video location \(unknown\.invalid\)/);
    assert.ok(!error.message.includes('private-recording')); assert.ok(!error.message.includes('private-token'));
    return true;
  });
});
