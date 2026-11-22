import { type Database } from './database.js';
import { graph } from './microsoft.js';
import { externalUrl, isMicrosoftVideo } from './video.js';
import { RequestError } from './http.js';

const resolved = new Map<string, { url: string; expiresAt: number }>();

// Resolve file bytes through the existing course owner's connection. Never send
// access tokens, sharing-page URLs or Microsoft credentials to the student UI.
export async function resolveMicrosoftVideo(db: Database, courseId: string, lessonId: string, source: string, request: typeof graph = graph) {
  if (!isMicrosoftVideo(source)) throw new RequestError(422, 'Use a OneDrive video file link.');
  const mapped = await db.prepare('SELECT admin_id FROM course_storage WHERE course_id = ?').get(courseId);
  const author = await db.prepare('SELECT admin_id FROM lesson_video_owners WHERE lesson_id = ?').get(lessonId);
  let owner = String(mapped?.admin_id || author?.admin_id || '');
  if (!owner) {
    const connected = await db.prepare('SELECT admin_id FROM microsoft_connections LIMIT 2').all();
    if (connected.length === 1) owner = String(connected[0].admin_id);
  }
  if (!owner || !await db.prepare('SELECT 1 FROM microsoft_connections WHERE admin_id = ?').get(owner)) {
    throw new RequestError(409, 'PBS needs to connect the course video owner in OneDrive & email, or upload this recording as an MP4/WebM lesson.');
  }
  const cacheKey = JSON.stringify([owner, source]), cached = request === graph ? resolved.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const url = externalUrl(source);
  if (['onedrive.live.com', 'www.onedrive.live.com'].includes(url.hostname) && url.pathname === '/embed' && url.searchParams.has('resid')) url.pathname = '/redir';
  const share = `u!${Buffer.from(url.href).toString('base64url')}`;
  const fields = '?$select=id,name,file,video,parentReference,@microsoft.graph.downloadUrl';
  let item = await request(db, owner, `/shares/${share}/driveItem${fields}`);
  item = item.remoteItem || item;
  if (!item['@microsoft.graph.downloadUrl'] && item.id && item.parentReference?.driveId) {
    item = await request(db, owner, `/drives/${encodeURIComponent(item.parentReference.driveId)}/items/${encodeURIComponent(item.id)}${fields}`);
  }
  if (!item.file || (!item.video && !String(item.file.mimeType || '').startsWith('video/'))) throw new RequestError(422, 'This OneDrive link is not a video file. PBS needs to choose the recording, not a folder or document.');
  if (typeof item['@microsoft.graph.downloadUrl'] !== 'string') throw new RequestError(502, 'Microsoft has not made this recording available for playback. PBS needs to check the file permissions.');
  const target = externalUrl(item['@microsoft.graph.downloadUrl']);
  if (target.port && target.port !== '443' || !['1drv.com', 'onedrive.live.com', 'sharepoint.com', 'sharepointonline.com'].some(domain => target.hostname === domain || target.hostname.endsWith(`.${domain}`))) {
    throw new RequestError(502, 'Microsoft returned an unsupported video location.');
  }
  if (request === graph) {
    for (const [key, value] of resolved) if (value.expiresAt <= Date.now()) resolved.delete(key);
    if (resolved.size >= 128) resolved.delete(resolved.keys().next().value!);
    resolved.set(cacheKey, { url: target.href, expiresAt: Date.now() + 45_000 });
  }
  return target.href;
}
