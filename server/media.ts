import { createWriteStream, existsSync } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { Express } from 'express';
import { requireAccount } from './auth';
import { type Database, makeId, transaction, videoDirectory } from './database';
import { badRequest, field, notFound, RequestError, route } from './http';
import { httpsLink } from './inputs';
import { hasCourseAccess } from './records';
import { videoPlayback } from './video';

const videoTypes = { 'video/mp4': '.mp4', 'video/webm': '.webm' } as const;
const routes = '/api/admin/courses/:courseId/modules/:moduleId/lessons';
const configuredLimit = Number(process.env.PBS_MAX_UPLOAD_MB || '1024');
const uploadLimit = (Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 1024) * 1024 * 1024;

function getModule(db: Database, courseId: string, moduleId: string) {
  if (!db.prepare('SELECT id FROM modules WHERE id = ? AND course_id = ?').get(moduleId, courseId)) {
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

function saveLesson(db: Database, moduleId: string, lesson: ReturnType<typeof lessonFields>,
  media: { sourceUrl: string; fileName: string; contentType: string } | null, replaceId: string) {
  return transaction(db, () => {
    if (replaceId) {
      const prior = db.prepare('SELECT file_name AS fileName FROM lessons WHERE id = ? AND module_id = ?')
        .get(replaceId, moduleId) as { fileName: string } | undefined;
      if (!prior) throw notFound('This lesson is unavailable.');
      if (media) {
        db.prepare(`UPDATE lessons SET title = ?, duration = ?, description = ?, source_url = ?, file_name = ?, content_type = ?
          WHERE id = ?`).run(lesson.title, lesson.duration, lesson.description, media.sourceUrl, media.fileName, media.contentType, replaceId);
      } else {
        db.prepare('UPDATE lessons SET title = ?, duration = ?, description = ? WHERE id = ?')
          .run(lesson.title, lesson.duration, lesson.description, replaceId);
      }
      return { id: replaceId, oldFile: media ? prior.fileName : '' };
    }

    if (!media) throw badRequest('Add a video file or link.');
    const id = makeId();
    db.prepare(`INSERT INTO lessons
      (id, module_id, title, duration, description, source_url, file_name, content_type, position)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(MAX(position), 0) + 1 FROM lessons WHERE module_id = ?`)
      .run(id, moduleId, lesson.title, lesson.duration, lesson.description, media.sourceUrl, media.fileName, media.contentType, moduleId);
    return { id, oldFile: '' };
  });
}

async function removePriorFile(file: string) {
  if (/^[a-f\d-]+\.(mp4|webm)$/.test(file)) {
    await rm(path.join(videoDirectory, file), { force: true }).catch(error => console.error('PBS could not remove a replaced video:', error.code));
  }
}

export function mountMedia(app: Express, db: Database) {
  app.post(routes, route(async (req, res) => {
    requireAccount(db, req, 'admin');
    const moduleId = getModule(db, req.params.courseId, req.params.moduleId);
    const lesson = lessonFields(req.body);
    const replace = field(req.body?.replaceId, 'lesson ID', 80, false);
    const source = httpsLink(req.body?.url, 'video link', !replace);
    try {
      if (source) videoPlayback(source);
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : 'Enter a valid video link.');
    }
    const { id, oldFile } = saveLesson(db, moduleId, lesson, source ? { sourceUrl: source, fileName: '', contentType: '' } : null, replace);
    await removePriorFile(oldFile);
    res.status(replace ? 200 : 201).json({ id });
  }));

  app.post(`${routes}/file`, route(async (req, res) => {
    requireAccount(db, req, 'admin');
    const moduleId = getModule(db, req.params.courseId, req.params.moduleId);
    const lesson = lessonFields(req.query);
    const replace = field(req.query.replaceId, 'lesson ID', 80, false);
    const contentType = req.get('content-type')?.split(';')[0];
    if (contentType !== 'video/mp4' && contentType !== 'video/webm') throw badRequest('Upload an MP4 or WebM video.');
    const length = Number(req.get('content-length'));
    if (!Number.isSafeInteger(length) || length < 12) throw badRequest('Choose a video file with a known size.');
    if (length > uploadLimit) throw new RequestError(413, `This server accepts files up to ${Math.floor(uploadLimit / 1024 ** 2)} MB.`);
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
      const valid = contentType === 'video/mp4' ? header.subarray(4, 8).toString('ascii') === 'ftyp'
        : header.subarray(0, 4).toString('hex') === '1a45dfa3';
      if (!valid) throw badRequest('The uploaded bytes do not match the video format.');
      await rename(temp, target);
      requireAccount(db, req, 'admin');
      const { id, oldFile } = saveLesson(db, moduleId, lesson, { sourceUrl: '', fileName: name, contentType }, replace);
      saved = true;
      await removePriorFile(oldFile);
      res.status(replace ? 200 : 201).json({ id });
    } finally {
      await rm(temp, { force: true });
      if (!saved) await rm(target, { force: true });
    }
  }));

  app.get('/api/lessons/:id/video', route((req, res) => {
    const account = requireAccount(db, req);
    const lesson = db.prepare(`SELECT l.file_name AS fileName, l.content_type AS contentType, m.course_id AS courseId
      FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = ?`).get(req.params.id) as
      { fileName: string; contentType: string; courseId: string } | undefined;
    if (!lesson?.fileName || !/^[a-f\d-]+\.(mp4|webm)$/.test(lesson.fileName) ||
        !hasCourseAccess(db, account, lesson.courseId) || !existsSync(path.join(videoDirectory, lesson.fileName))) {
      throw notFound('This video is unavailable.');
    }
    res.type(lesson.contentType).sendFile(lesson.fileName, { root: videoDirectory, cacheControl: false });
  }));
}
