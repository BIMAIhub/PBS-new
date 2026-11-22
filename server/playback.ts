import type { Express } from 'express';
import type { CoursePlayback, PlaybackPosition } from '../src/live/playback-types.js';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, now, transaction } from './database.js';
import { badRequest, conflict, field, integer, limitAttempts, notFound, route } from './http.js';
import { hasCourseAccess } from './records.js';
import { videoSourceKey } from './video.js';

const columns = `p.lesson_id AS lessonId, p.source_key AS mediaKey, p.position, p.duration, p.revision, p.updated_at AS updatedAt`;

export async function coursePlayback(db: Database, accountId: string, courseId: string): Promise<CoursePlayback> {
  const rows = await db.prepare(`SELECT ${columns}, l.source_url AS sourceUrl, l.file_name AS fileName
    FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id JOIN modules m ON m.id = l.module_id
    WHERE p.account_id = ? AND m.course_id = ? ORDER BY p.updated_at DESC, p.lesson_id`).all(accountId, courseId);
  const positions = rows.filter(row => row.mediaKey === videoSourceKey(String(row.sourceUrl), String(row.fileName)))
    .map(({ sourceUrl: _source, fileName: _file, ...row }) => row as unknown as PlaybackPosition);
  return { lastLessonId: positions[0]?.lessonId || '', positions };
}

export function mountPlayback(app: Express, db: WritableDatabase, hosted: boolean) {
  app.get('/api/student/courses/:id/playback', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    if (!await hasCourseAccess(db, account, req.params.id)) throw notFound('This course is unavailable.');
    res.json(await coursePlayback(db, account.id, req.params.id));
  }));
  app.put('/api/student/lessons/:id/playback', limitAttempts(720, hosted ? db : undefined), route(async (req, res) => {
    await requireAccount(db, req, 'student');
    const position = req.body?.position, duration = req.body?.duration;
    if (typeof position !== 'number' || typeof duration !== 'number' || !Number.isFinite(position) || !Number.isFinite(duration) || position < 0 || duration <= 0 || duration > 604800 || position > duration + 1) throw badRequest('The video position is invalid.');
    const mediaKey = field(req.body?.mediaKey, 'recording version', 64), expected = field(req.body?.revision, 'saved revision', 80, false);
    const writer = field(req.body?.writerId, 'player session', 80), sequence = integer(req.body?.sequence, 'save sequence', 1, Number.MAX_SAFE_INTEGER);
    const saved = await transaction(db, async tx => {
      const account = await requireAccount(tx, req, 'student');
      const lesson = await tx.prepare(`SELECT l.source_url AS sourceUrl, l.file_name AS fileName, m.course_id AS courseId
        FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = ?`).get(req.params.id);
      if (!lesson || !await hasCourseAccess(tx, account, String(lesson.courseId))) throw notFound('This lesson is unavailable.');
      if (mediaKey !== videoSourceKey(String(lesson.sourceUrl), String(lesson.fileName))) throw conflict('This recording has changed. Reopen the classroom to continue.');
      const prior = await tx.prepare(`SELECT ${columns}, p.writer_id AS writer, p.sequence FROM lesson_progress p WHERE p.account_id = ? AND p.lesson_id = ? AND p.source_key = ?`).get(account.id, req.params.id, mediaKey);
      if (prior?.writer === writer && Number(prior.sequence) >= sequence) {
        const { writer: _writer, sequence: _sequence, ...record } = prior; return record;
      }
      if (String(prior?.revision || '') !== expected) throw conflict('A newer viewing position was saved. Refresh your saved place.');
      const record = { lessonId: req.params.id, mediaKey, position: Math.min(position, duration), duration, revision: makeId(), updatedAt: now() };
      await tx.prepare(`INSERT INTO lesson_progress VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, lesson_id) DO UPDATE SET source_key = excluded.source_key, position = excluded.position,
        duration = excluded.duration, revision = excluded.revision, writer_id = excluded.writer_id,
        sequence = excluded.sequence, updated_at = excluded.updated_at`).run(account.id, record.lessonId, mediaKey, record.position, duration, record.revision, writer, sequence, record.updatedAt);
      return record;
    });
    res.json({ progress: saved });
  }));
}
