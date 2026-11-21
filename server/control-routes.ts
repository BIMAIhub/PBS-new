import type { Express } from 'express';
import { findAccount, requireAccount } from './auth.js';
import { type WritableDatabase, makeId, now, transaction } from './database.js';
import { audit } from './academy-data.js';
import { courseById, enrollmentById } from './records.js';
import { badRequest, conflict, field, limitAttempts, notFound, route } from './http.js';
import { verifyPassword } from './passwords.js';

export function mountControls(app: Express, db: WritableDatabase, hosted: boolean) {
  app.patch('/api/admin/students/:id/status', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const status = req.body?.status;
    if (status !== 'active' && status !== 'inactive') throw badRequest('Choose Active or Inactive.');
    const reason = field(req.body?.reason, 'reason', 500, status === 'inactive');
    await transaction(db, async tx => {
      const admin = await requireAccount(tx, req, 'admin'), student = await findAccount(tx, req.params.id);
      if (!student || student.role !== 'student') throw notFound('This student is unavailable.');
      if (student.accountStatus === 'deleted') throw conflict('Restore this student before changing account access.');
      if (req.body?.expectedStatus !== student.accountStatus) throw conflict('The account status changed. Refresh the student record.');
      if (student.accountStatus === status) return;
      await tx.prepare(`INSERT INTO account_controls VALUES (?, ?, ?, ?) ON CONFLICT(account_id)
        DO UPDATE SET status = excluded.status, reason = excluded.reason, updated_at = excluded.updated_at`).run(student.id, status, reason, now());
      await tx.prepare('DELETE FROM sessions WHERE account_id = ?').run(student.id);
      await audit(tx, admin.id, status === 'active' ? 'Student reactivated' : 'Student deactivated', student.id, reason);
    }); res.status(204).end();
  }));

  // Recoverable deletion retains issued receipts and the audit trail.
  app.delete('/api/admin/students/:id', limitAttempts(20, hosted ? db : undefined), route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    if (!await verifyPassword(String(req.body?.current || ''), admin.passwordHash)) throw badRequest('The current admin password is incorrect.');
    const reason = field(req.body?.reason, 'reason', 500);
    await transaction(db, async tx => {
      const latest = await requireAccount(tx, req, 'admin'), student = await findAccount(tx, req.params.id);
      if (latest.passwordHash !== admin.passwordHash) throw conflict('Your password changed. Sign in again.');
      if (!student || student.role !== 'student') throw notFound('This student is unavailable.');
      if (String(req.body?.confirmEmail || '').trim().toLowerCase() !== student.email.toLowerCase()) throw badRequest('Type the student email to confirm deletion.');
      if (req.body?.expectedStatus !== student.accountStatus) throw conflict('The account status changed. Refresh the student record.');
      if (student.accountStatus === 'deleted') return;
      await tx.prepare(`INSERT INTO account_controls VALUES (?, 'deleted', ?, ?) ON CONFLICT(account_id)
        DO UPDATE SET status = 'deleted', reason = excluded.reason, updated_at = excluded.updated_at`).run(student.id, reason, now());
      await tx.prepare('DELETE FROM sessions WHERE account_id = ?').run(student.id);
      await audit(tx, admin.id, 'Student moved to deleted records', student.id, reason);
    }); res.status(204).end();
  }));

  app.post('/api/admin/students/:id/restore', route(async (req, res) => {
    await transaction(db, async tx => {
      const admin = await requireAccount(tx, req, 'admin'), student = await findAccount(tx, req.params.id);
      if (!student || student.role !== 'student') throw notFound('This student is unavailable.');
      if (student.accountStatus !== 'deleted') throw conflict('This student is no longer in deleted records. Refresh the roster.');
      await tx.prepare("UPDATE account_controls SET status = 'inactive', reason = 'Restored by admin; awaiting reactivation', updated_at = ? WHERE account_id = ?").run(now(), student.id);
      await audit(tx, admin.id, 'Student restored as inactive', student.id, 'Account access requires explicit reactivation.');
    }); res.status(204).end();
  }));

  app.patch('/api/admin/courses/:id/pause', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    if (typeof req.body?.paused !== 'boolean') throw badRequest('Choose Pause or Resume.');
    const paused = req.body.paused, reason = field(req.body?.reason, 'reason', 500, paused);
    await transaction(db, async tx => {
      const admin = await requireAccount(tx, req, 'admin'), course = await courseById(tx, req.params.id);
      if (Boolean(req.body?.expectedPaused) !== course.paused) throw conflict('The course status changed. Refresh the course.');
      if (course.paused === paused) return;
      await tx.prepare(`INSERT INTO course_controls VALUES (?, ?, ?, ?) ON CONFLICT(course_id)
        DO UPDATE SET paused = excluded.paused, reason = excluded.reason, updated_at = excluded.updated_at`).run(course.id, Number(paused), reason, now());
      const time = now(), change = makeId();
      await tx.prepare(`INSERT INTO notifications (id, account_id, title, body, kind, page, created_at)
        SELECT ? || ':' || account_id, account_id, ?, ?, 'course', 'courses', ? FROM enrollments
        WHERE course_id = ? AND status = 'approved'`).run(change, paused ? 'Course paused by PBS' : 'Your course has resumed', `${course.title}${reason ? ': ' + reason : ''}`, time, course.id);
      await audit(tx, admin.id, paused ? 'Course paused' : 'Course resumed', course.id, reason);
    }); res.status(204).end();
  }));

  app.patch('/api/admin/enrollments/:id/pause', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    if (typeof req.body?.paused !== 'boolean') throw badRequest('Choose Pause or Resume.');
    const paused = req.body.paused, reason = field(req.body?.reason, 'reason', 500, paused);
    await transaction(db, async tx => {
      const admin = await requireAccount(tx, req, 'admin'), enrollment = await enrollmentById(tx, req.params.id);
      if (enrollment.status !== 'approved') throw conflict('Approve the enrollment before managing course access.');
      if (Boolean(req.body?.expectedPaused) !== Boolean(enrollment.accessPaused)) throw conflict('Course access changed. Refresh the student record.');
      if (Boolean(enrollment.accessPaused) === paused) return;
      await tx.prepare(`INSERT INTO enrollment_controls VALUES (?, ?, ?, ?) ON CONFLICT(enrollment_id)
        DO UPDATE SET paused = excluded.paused, reason = excluded.reason, updated_at = excluded.updated_at`).run(enrollment.id, Number(paused), reason, now());
      await tx.prepare(`INSERT INTO notifications (id, account_id, title, body, kind, page, created_at)
        VALUES (?, ?, ?, ?, 'course', 'courses', ?)`).run(makeId(), enrollment.studentId, paused ? 'Your course access is paused' : 'Your course access has resumed', `${enrollment.courseTitle}${reason ? ': ' + reason : ''}`, now());
      await audit(tx, admin.id, paused ? 'Student course access paused' : 'Student course access resumed', enrollment.id, reason);
    }); res.status(204).end();
  }));
}
