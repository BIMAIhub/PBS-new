import { createWriteStream, existsSync } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { Express } from 'express';
import { BlobNotFoundError, del, head, issueSignedToken, presignUrl } from '@vercel/blob';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, transaction, videoDirectory } from './database.js';
import { badRequest, field, notFound, RequestError, route } from './http.js';
import { httpsLink } from './inputs.js';
import { hasCourseAccess } from './records.js';
import { isMicrosoftVideo, videoPlayback } from './video.js';
import { resolveMicrosoftVideo } from './microsoft-video.js';
import { requireLessonRelease } from './learning-access.js';

const videoTypes = { 'video/mp4': '.mp4', 'video/webm': '.webm' } as const;
const routes = '/api/admin/courses/:courseId/modules/:moduleId/lessons';
const configuredLimit = Number(process.env.PBS_MAX_UPLOAD_MB || '1024');
const uploadLimit = (Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 1024) * 1024 * 1024;
const blobPrefix = 'pbs/videos/';
const blobName = (id: string, type: keyof typeof videoTypes) => `${blobPrefix}${id}${videoTypes[type]}`;
const validBlobName = (name: string) => /^pbs\/videos\/[a-f\d-]+\.(mp4|webm)$/.test(name);
type VideoType = keyof typeof videoTypes;
type Upload = { contentType: VideoType; size: number; expiresAt: number; lessonId: string };

function checkFile(type: unknown, length: number): VideoType {
  if (type !== 'video/mp4' && type !== 'video/webm') throw badRequest('Upload an MP4 or WebM video.');
  if (!Number.isSafeInteger(length) || length < 12) throw badRequest('Choose a video file with a known size.');
  if (length > uploadLimit) throw new RequestError(413, `This server accepts files up to ${Math.floor(uploadLimit / 1024 ** 2)} MB.`);
  return type;
}

function matchesVideoFormat(header: Buffer, type: VideoType) {
  return type === 'video/mp4' ? header.subarray(4, 8).toString('ascii') === 'ftyp'
    : header.subarray(0, 4).toString('hex') === '1a45dfa3';
}

async function readUrl(pathname: string, validUntil: number, operation: 'get' | 'head' = 'get') {
  const token = await issueSignedToken({ pathname, operations: [operation], validUntil });
  return (await presignUrl(token, { access: 'private', operation, pathname, validUntil })).presignedUrl;
}

async function verifyBlob(pathname: string, upload: Upload) {
  const metadata = await head(pathname).catch(error => {
    if (error instanceof BlobNotFoundError) throw badRequest('Upload the video before saving the lesson.');
    throw error;
  });
  if (metadata.size !== upload.size || metadata.contentType !== upload.contentType) {
    throw badRequest('The stored file does not match the selected video.');
  }
  const response = await fetch(await readUrl(pathname, Date.now() + 60_000), {
    headers: { Range: 'bytes=0-11' }, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 206) {
    await response.body?.cancel();
    throw badRequest('PBS could not verify the uploaded video. Try the upload again.');
  }
  if (!matchesVideoFormat(Buffer.from(await response.arrayBuffer()), upload.contentType)) {
    throw badRequest('The uploaded bytes do not match the video format.');
  }
}

async function getUpload(db: Database, id: string, account: string, module: string) {
  const upload = await db.prepare(`SELECT content_type AS contentType, size, expires_at AS expiresAt, lesson_id AS lessonId
    FROM video_uploads WHERE id = ? AND account_id = ? AND module_id = ?`).get(id, account, module) as Upload | undefined;
  if (!upload || (!upload.lessonId && upload.expiresAt < Date.now())) {
    throw badRequest('Start a new video upload to continue.');
  }
  return upload;
}

async function getModule(db: Database, courseId: string, moduleId: string) {
  if (!await db.prepare('SELECT id FROM modules WHERE id = ? AND course_id = ?').get(moduleId, courseId)) {
    throw notFound('This course module is unavailable.');
  }
  return moduleId;
}

function lessonFields(input: Record<string, unknown> | undefined) {
  return {
    title: field(input?.title, 'lesson title'),
    duration: field(input?.duration, 'duration', 40, false),
    description: field(input?.description, 'description', 3000, false),
  };
}

async function saveLesson(db: Database, moduleId: string, lesson: ReturnType<typeof lessonFields>,
  media: { sourceUrl: string; fileName: string; contentType: string } | null, replaceId: string) {
  if (replaceId) {
    const prior = await db.prepare('SELECT file_name AS fileName FROM lessons WHERE id = ? AND module_id = ?')
      .get(replaceId, moduleId) as { fileName: string } | undefined;
    if (!prior) throw notFound('This lesson is unavailable.');
    if (media) {
      await db.prepare(`UPDATE lessons SET title = ?, duration = ?, description = ?, source_url = ?, file_name = ?, content_type = ?
        WHERE id = ?`).run(lesson.title, lesson.duration, lesson.description, media.sourceUrl, media.fileName, media.contentType, replaceId);
    } else {
      await db.prepare('UPDATE lessons SET title = ?, duration = ?, description = ? WHERE id = ?')
        .run(lesson.title, lesson.duration, lesson.description, replaceId);
    }
    return { id: replaceId, oldFile: media ? prior.fileName : '' };
  }

  if (!media) throw badRequest('Add a video file or link.');
  const id = makeId();
  await db.prepare(`INSERT INTO lessons
    (id, module_id, title, duration, description, source_url, file_name, content_type, position)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(MAX(position), 0) + 1 FROM lessons WHERE module_id = ?`)
    .run(id, moduleId, lesson.title, lesson.duration, lesson.description, media.sourceUrl, media.fileName, media.contentType, moduleId);
  return { id, oldFile: '' };
}

async function removePriorFile(file: string) {
  if (validBlobName(file)) {
    await del(file).catch(() => console.error('PBS could not remove a replaced cloud video.'));
  } else if (/^[a-f\d-]+\.(mp4|webm)$/.test(file)) {
    await rm(path.join(videoDirectory, file), { force: true }).catch(error => console.error('PBS could not remove a replaced video:', error.code));
  }
}

export function mountMedia(app: Express, db: WritableDatabase, hosted: boolean, microsoftVideo: typeof resolveMicrosoftVideo = resolveMicrosoftVideo) {
  const blobConfigured = Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
  const cloud = hosted || blobConfigured;
  app.post(routes, route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const moduleId = await getModule(db, req.params.courseId, req.params.moduleId);
    const lesson = lessonFields(req.body);
    const replace = field(req.body?.replaceId, 'lesson ID', 80, false);
    const source = httpsLink(req.body?.url, 'video link', !replace);
    try {
      if (source && videoPlayback(source).kind === 'link') throw new Error('Use an individual OneDrive, YouTube, Google Drive or Vimeo video, or a direct MP4/WebM link.');
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : 'Enter a valid video link.');
    }
    const { id, oldFile } = await transaction(db, async tx => {
      await requireAccount(tx, req, 'admin');
      await getModule(tx, req.params.courseId, moduleId);
      const saved = await saveLesson(tx, moduleId, lesson, source ? { sourceUrl: source, fileName: '', contentType: '' } : null, replace);
      if (source) {
        await tx.prepare('DELETE FROM lesson_video_owners WHERE lesson_id = ?').run(saved.id);
        if (isMicrosoftVideo(source)) await tx.prepare('INSERT INTO lesson_video_owners VALUES (?, ?)').run(saved.id, admin.id);
      }
      return saved;
    });
    await removePriorFile(oldFile);
    res.status(replace ? 200 : 201).json({ id });
  }));

  app.post(`${routes}/upload`, route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const moduleId = await getModule(db, req.params.courseId, req.params.moduleId);
    if (!cloud) {
      const size = typeof req.body?.size === 'number' ? req.body.size : 0, type = checkFile(req.body?.contentType, size), id = makeId(), expiresAt = Date.now() + 86400000;
      await transaction(db, async tx => {
        await getModule(tx, req.params.courseId, moduleId);
        await tx.prepare('INSERT INTO video_uploads (id, account_id, module_id, content_type, size, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(id,admin.id,moduleId,type,size,expiresAt);
      });
      return res.json({ storage: 'local', uploadId:id, expiresAt });
    }
    if (!blobConfigured) throw new RequestError(503, 'Connect private video storage before uploading files. You can add a video link now.');

    const size = typeof req.body?.size === 'number' ? req.body.size : 0;
    const contentType = checkFile(req.body?.contentType, size);
    const id = makeId();
    const pathname = blobName(id, contentType);
    const validUntil = Date.now() + 30 * 60_000;
    const constraints = { allowedContentTypes: [contentType], maximumSizeInBytes: size };
    const token = await issueSignedToken({ pathname, operations: ['put'], validUntil, ...constraints });
    const { presignedUrl } = await presignUrl(token, {
      access: 'private', operation: 'put', pathname, validUntil, ...constraints,
    });
    await transaction(db, async tx => {
      await getModule(tx, req.params.courseId, moduleId);
      await tx.prepare('INSERT INTO video_uploads (id, account_id, module_id, content_type, size, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, admin.id, moduleId, contentType, size, validUntil);
    });
    res.json({ storage: 'blob', uploadId: id, url: presignedUrl, expiresAt:validUntil });
  }));

  app.post(`${routes}/upload/:id`, route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const moduleId = await getModule(db, req.params.courseId, req.params.moduleId);
    const upload = await getUpload(db, req.params.id, admin.id, moduleId);
    if (upload.lessonId) return res.json({ id: upload.lessonId });

    const details = lessonFields(req.body);
    const replace = field(req.body?.replaceId, 'lesson ID', 80, false);
    const fileName = blobName(req.params.id, upload.contentType);
    await verifyBlob(fileName, upload);
    const result = await transaction(db, async tx => {
      await requireAccount(tx, req, 'admin');
      await getModule(tx, req.params.courseId, moduleId);
      const current = await getUpload(tx, req.params.id, admin.id, moduleId);
      if (current.lessonId) return { id: current.lessonId, oldFile: '' };
      const lesson = await saveLesson(tx, moduleId, details, { sourceUrl: '', fileName, contentType: current.contentType }, replace);
      await tx.prepare('UPDATE video_uploads SET lesson_id = ? WHERE id = ?').run(lesson.id, req.params.id);
      return lesson;
    });
    await removePriorFile(result.oldFile);
    res.status(replace ? 200 : 201).json({ id: result.id });
  }));

  app.post(`${routes}/file`, route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    if (cloud) throw badRequest('Use the cloud upload flow to save videos on this server.');
    const moduleId = await getModule(db, req.params.courseId, req.params.moduleId);
    const lesson = lessonFields(req.query);
    const replace = field(req.query.replaceId, 'lesson ID', 80, false);
    const contentType = checkFile(req.get('content-type')?.split(';')[0], Number(req.get('content-length')));
    const uploadId = field(req.query.uploadId,'upload session',80,false), upload = uploadId ? await getUpload(db,uploadId,admin.id,moduleId) : undefined;
    if(upload?.lessonId){req.resume();return res.json({id:upload.lessonId});}
    if(upload&&(upload.contentType!==contentType||upload.size!==Number(req.get('content-length'))))throw badRequest('This file does not match the prepared upload.');
    const name = `${makeId()}${videoTypes[contentType]}`;
    const target = path.join(videoDirectory, name);
    const temp = `${target}.partial`;
    let saved = false;
    try {
      await pipeline(req, createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
      const file = await open(temp);
      const header = Buffer.alloc(12);
      try {
        await file.read(header, 0, header.length, 0);
      } finally {
        await file.close();
      }
      if (!matchesVideoFormat(header, contentType)) throw badRequest('The uploaded bytes do not match the video format.');
      await rename(temp, target);
      const { id, oldFile, reused } = await transaction(db, async tx => {
        await requireAccount(tx, req, 'admin');
        await getModule(tx, req.params.courseId, moduleId);
        if(uploadId){const latest=await getUpload(tx,uploadId,admin.id,moduleId);if(latest.lessonId)return{id:latest.lessonId,oldFile:'',reused:true};}
        const result=await saveLesson(tx, moduleId, lesson, { sourceUrl: '', fileName: name, contentType }, replace);
        if(uploadId)await tx.prepare('UPDATE video_uploads SET lesson_id=? WHERE id=?').run(result.id,uploadId);
        return {...result,reused:false};
      });
      saved = !reused;
      await removePriorFile(oldFile);
      res.status(replace ? 200 : 201).json({ id });
    } finally {
      await rm(temp, { force: true });
      if (!saved) await rm(target, { force: true });
    }
  }));

  app.get('/api/lessons/:id/playback-status', route(async (req, res) => {
    const account = await requireAccount(db, req);
    const lesson = await db.prepare(`SELECT l.source_url AS sourceUrl, m.course_id AS courseId
      FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = ?`).get(req.params.id);
    if (!lesson || !await hasCourseAccess(db, account, String(lesson.courseId))) throw notFound('This video is unavailable.');
    await requireLessonRelease(db,account,req.params.id);
    if (lesson.sourceUrl && isMicrosoftVideo(String(lesson.sourceUrl))) await microsoftVideo(db, String(lesson.courseId), req.params.id, String(lesson.sourceUrl));
    res.json({ ready: true });
  }));

  app.get('/api/lessons/:id/video', route(async (req, res) => {
    const account = await requireAccount(db, req);
    const lesson = await db.prepare(`SELECT l.file_name AS fileName, l.source_url AS sourceUrl, l.content_type AS contentType, m.course_id AS courseId
      FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = ?`).get(req.params.id) as
      { fileName: string; sourceUrl: string; contentType: string; courseId: string } | undefined;
    if (!lesson || !await hasCourseAccess(db, account, lesson.courseId)) throw notFound('This video is unavailable.');
    await requireLessonRelease(db,account,req.params.id);
    if (!lesson.fileName && lesson.sourceUrl && isMicrosoftVideo(lesson.sourceUrl)) {
      // A video-element redirect stays inside the player and lets Microsoft serve
      // byte ranges for seeking without buffering an entire lesson in Vercel.
      return res.redirect(302, await microsoftVideo(db, lesson.courseId, req.params.id, lesson.sourceUrl));
    }
    if (!lesson.fileName) throw notFound('This video is unavailable.');
    if (validBlobName(lesson.fileName) && blobConfigured) {
      return res.redirect(302, await readUrl(lesson.fileName, Date.now() + 60 * 60_000, req.method === 'HEAD' ? 'head' : 'get'));
    }
    if (!/^[a-f\d-]+\.(mp4|webm)$/.test(lesson.fileName) || !existsSync(path.join(videoDirectory, lesson.fileName))) {
      throw notFound('This video is unavailable.');
    }
    res.type(lesson.contentType).sendFile(lesson.fileName, { root: videoDirectory, cacheControl: false });
  }));
}
