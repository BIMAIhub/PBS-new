import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { audit } from './academy-data.js';
import { type Database, type WritableDatabase, transaction } from './database.js';
import { badRequest, conflict, field, notFound, route } from './http.js';

async function moduleInCourse(db: Database, courseId: string, moduleId: string) {
  const module = await db.prepare('SELECT id,title FROM modules WHERE id=? AND course_id=?').get(moduleId, courseId);
  if (!module) throw notFound('This course module is unavailable.');
  return module;
}

async function moduleUsage(db: Database, moduleId: string) {
  const count = async (sql: string, ...args: (string | number)[]) => Number((await db.prepare(sql).get(...args))?.n || 0);
  return {
    lessons: await count('SELECT COUNT(*) AS n FROM lessons WHERE module_id=?', moduleId),
    assignments: await count('SELECT COUNT(*) AS n FROM learning_tasks WHERE module_id=?', moduleId),
    uploads: await count("SELECT COUNT(*) AS n FROM video_uploads WHERE module_id=? AND lesson_id='' AND expires_at>?", moduleId, Date.now())
      + await count("SELECT COUNT(*) AS n FROM drive_uploads WHERE module_id=? AND kind='video' AND attached_id='' AND (expires_at>? OR created_at>?)", moduleId, Date.now(), new Date(Date.now() - 86400000).toISOString()),
  };
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 2000 || value.some(id => typeof id !== 'string' || !id || id.length > 80) || new Set(value).size !== value.length) {
    throw badRequest('Include every module once in the new order.');
  }
  return value;
}
const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

export function mountCourseContent(app: Express, db: WritableDatabase) {
  const base = '/api/admin/courses/:courseId/modules';
  app.put(`${base}/order`, route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin'), order = ids(req.body?.moduleIds), expected = ids(req.body?.expectedIds);
    await transaction(db, async tx => {
      if (!await tx.prepare('SELECT 1 FROM courses WHERE id=?').get(req.params.courseId)) throw notFound('This course is unavailable.');
      const current = (await tx.prepare('SELECT id FROM modules WHERE course_id=? ORDER BY position,id').all(req.params.courseId)).map(row => String(row.id));
      if (!same([...current].sort(), [...order].sort())) throw conflict('The module list changed. Refresh the course before reordering.');
      if (same(current, order)) return;
      if (!same(current, expected)) throw conflict('Another edit changed the module order. Refresh the course and try again.');
      for (const [index, id] of order.entries()) await tx.prepare('UPDATE modules SET position=? WHERE id=? AND course_id=?').run(index + 1, id, req.params.courseId);
      await audit(tx, admin.id, 'Module order changed', req.params.courseId, `${order.length} modules`);
    });
    res.json({ moduleIds: order });
  }));

  app.patch(`${base}/:moduleId`, route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin'), title = field(req.body?.title, 'module title');
    await transaction(db, async tx => {
      const module = await moduleInCourse(tx, req.params.courseId, req.params.moduleId);
      if (req.body?.expectedTitle !== module.title) throw conflict('This module was edited elsewhere. Refresh the course before saving.');
      await tx.prepare('UPDATE modules SET title=? WHERE id=?').run(title, module.id);
      await audit(tx, admin.id, 'Module title updated', String(module.id), title);
    });
    res.json({ id: req.params.moduleId, title });
  }));

  app.get(`${base}/:moduleId/usage`, route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const module = await moduleInCourse(db, req.params.courseId, req.params.moduleId);
    res.json({ title: module.title, ...await moduleUsage(db, req.params.moduleId) });
  }));

  app.delete(`${base}/:moduleId`, route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    if (req.body?.confirm !== true) throw badRequest('Confirm deletion of this empty module.');
    await transaction(db, async tx => {
      const module = await moduleInCourse(tx, req.params.courseId, req.params.moduleId);
      if (req.body?.expectedTitle !== module.title) throw conflict('This module was edited elsewhere. Refresh before deleting it.');
      const usage = await moduleUsage(tx, req.params.moduleId);
      if (usage.lessons) throw conflict('Move every video to another module before deleting this module. No videos have been deleted.');
      if (usage.assignments) throw conflict('Move the assignments to another module in Assignments before deleting this module. No assignments have been deleted.');
      if (usage.uploads) throw conflict('This module has an unfinished upload. Finish it or wait for its upload session to expire before deleting the module.');
      // Deletion is deliberately limited to an empty module and its own descriptive/release metadata.
      await tx.prepare('DELETE FROM module_releases WHERE module_id=?').run(module.id);
      await tx.prepare('DELETE FROM modules WHERE id=?').run(module.id);
      await audit(tx, admin.id, 'Empty module deleted', String(module.id), String(module.title));
    });
    res.status(204).end();
  }));

  app.patch('/api/admin/courses/:courseId/lessons/:lessonId/module', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin'), destination = field(req.body?.moduleId, 'destination module', 80);
    const expected = field(req.body?.expectedModuleId, 'current module', 80);
    await transaction(db, async tx => {
      await moduleInCourse(tx, req.params.courseId, destination);
      const lesson = await tx.prepare('SELECT l.id,l.module_id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.id=? AND m.course_id=?').get(req.params.lessonId, req.params.courseId);
      if (!lesson) throw notFound('This course video is unavailable.');
      if (lesson.module_id === destination) return;
      if (lesson.module_id !== expected) throw conflict('This video was already moved. Refresh the course before moving it again.');
      const position = Number((await tx.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM lessons WHERE module_id=?').get(destination))!.n);
      // Keep the lesson identity, media, owners, completions and watch records. Only its place in the course changes.
      await tx.prepare('UPDATE lessons SET module_id=?,position=? WHERE id=?').run(destination, position, lesson.id);
      await tx.prepare('UPDATE video_uploads SET module_id=? WHERE lesson_id=?').run(destination, lesson.id);
      await tx.prepare("UPDATE drive_uploads SET module_id=? WHERE kind='video' AND attached_id=?").run(destination, lesson.id);
      await audit(tx, admin.id, 'Video moved to module', String(lesson.id), `${expected} → ${destination}`);
    });
    res.json({ id: req.params.lessonId, moduleId: destination });
  }));
}
