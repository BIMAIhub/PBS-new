import type { Express } from 'express';
import { findAccount, publicAccount, renewAccountSession, requireAccount } from './auth.js';
import { type WritableDatabase, makeId, makeStudentId, now, transaction } from './database.js';
import { badRequest, conflict, emailAddress, field, integer, limitAttempts, notFound, route } from './http.js';
import { httpsLink, paymentClaim, paymentReference, phoneNumber } from './inputs.js';
import { hashPassword, temporaryPassword, verifyPassword } from './passwords.js';
import { accessPackage, deliverAccessEmail } from './admissions.js';
import { adminWorkspace, courseById, courseDetails, enrollmentById, getAssessment, issueReceipt } from './records.js';
import { academyWorkspace, audit } from './academy-data.js';
import { grantCourseAccess, portalOrigin } from './microsoft.js';
import { saveLiveClass } from './live-classes.js';

export function mountAdmin(app: Express, db: WritableDatabase, hosted: boolean) {
  app.patch('/api/admin/profile', limitAttempts(10, hosted ? db : undefined), route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const name = field(req.body?.name, 'full name', 120);
    const email = emailAddress(req.body?.email);
    const current = typeof req.body?.current === 'string' ? req.body.current : '';
    if (!await verifyPassword(current, admin.passwordHash)) throw badRequest('The current password is incorrect.');

    await transaction(db, async tx => {
      const active = await requireAccount(tx, req, 'admin');
      if (active.passwordHash !== admin.passwordHash) throw conflict('Your password changed during this request. Sign in again.');
      if (await tx.prepare('SELECT 1 FROM accounts WHERE email = ? AND id <> ?').get(email, active.id)) {
        throw conflict('This email is already used by another account.');
      }
      await tx.prepare('UPDATE accounts SET name = ?, email = ? WHERE id = ?').run(name, email, active.id);
      if (email !== active.email) await renewAccountSession(tx, req, res, active.id);
    });
    res.json({ account: publicAccount((await findAccount(db, admin.id))!) });
  }));

  app.get('/api/admin/workspace', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    res.json(await adminWorkspace(db));
  }));

  app.get('/api/admin/export', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    res.attachment('PBS-records.json').json({ exportedAt: now(), ...await adminWorkspace(db), academy: await academyWorkspace(db),
      certificateTemplates: await db.prepare('SELECT * FROM certificate_templates').all(),
      events: await db.prepare('SELECT * FROM academy_events ORDER BY created_at DESC').all() });
  }));

  app.post('/api/admin/courses', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const id = makeId();
    await db.prepare('INSERT INTO courses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, ...courseValues(req.body), now());
    res.status(201).json({ course: await courseDetails(db, await courseById(db, id)) });
  }));

  app.patch('/api/admin/courses/:id', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    await courseById(db, req.params.id);
    await db.prepare(`UPDATE courses SET title = ?, description = ?, category = ?, instructor = ?, schedule = ?,
      fee = ?, published = ? WHERE id = ?`).run(...courseValues(req.body), req.params.id);
    res.json({ course: await courseDetails(db, await courseById(db, req.params.id)) });
  }));

  app.post('/api/admin/courses/:id/modules', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const id = makeId();
    const title = field(req.body?.title, 'module title');
    await transaction(db, async tx => {
      await courseById(tx, req.params.id);
      await tx.prepare(`INSERT INTO modules (id, course_id, title, position)
        SELECT ?, ?, ?, COALESCE(MAX(position), 0) + 1 FROM modules WHERE course_id = ?`)
        .run(id, req.params.id, title, req.params.id);
    });
    res.status(201).json({ id, title });
  }));

  app.post('/api/admin/courses/:id/links', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    await courseById(db, req.params.id);
    const kind = req.body?.kind;
    if (kind !== 'resource' && kind !== 'session') throw badRequest('Choose a resource or live session.');
    if (kind === 'session') {
      const start = Date.parse(field(req.body?.startsAt, 'session date', 50));
      const session = await saveLiveClass(db, admin.id, { ...req.body, courseId: req.params.id, meetUrl: req.body?.url,
        endsAt: req.body?.endsAt || (Number.isFinite(start) ? new Date(start + 60 * 60_000).toISOString() : ''), published: req.body?.published === true, accessConfirmed: req.body?.accessConfirmed === true });
      res.status(201).json({ id: session.id }); return;
    }
    const title = field(req.body?.title, 'title');
    const url = httpsLink(req.body?.url, 'link');
    let startsAt = '';
    const id = makeId();
    await db.prepare('INSERT INTO course_links VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, req.params.id, kind, title, url, startsAt);
    res.status(201).json({ id });
  }));

  app.get('/api/admin/courses/:id/assessment', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    res.json(await getAssessment(db, req.params.id));
  }));

  app.put('/api/admin/courses/:id/assessment', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    await courseById(db, req.params.id);
    const input = req.body?.questions;
    if (!Array.isArray(input) || input.length < 1 || input.length > 50) throw badRequest('Add between 1 and 50 assessment questions.');
    const questions = input.map(question => {
      if (!Array.isArray(question?.options) || question.options.length < 2 || question.options.length > 6) {
        throw badRequest('Each question needs two to six options.');
      }
      return {
        prompt: field(question.prompt, 'question', 600),
        options: question.options.map(option => field(option, 'answer option', 300)),
        answer: integer(question.answer, 'correct answer', 0, question.options.length - 1),
      };
    });
    const passingScore = integer(req.body?.passingScore, 'passing score', 1, 100);
    await db.prepare(`INSERT INTO assessments VALUES (?, ?, ?) ON CONFLICT(course_id) DO UPDATE SET
      questions = excluded.questions, passing_score = excluded.passing_score`)
      .run(req.params.id, JSON.stringify(questions), passingScore);
    res.status(204).end();
  }));

  app.post('/api/admin/students', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const email = emailAddress(req.body?.email);
    const courseId = field(req.body?.courseId, 'course', 80);
    const course = await courseById(db, courseId);
    const total = integer(req.body?.total ?? course.fee, 'course fee');
    const claim = paymentClaim(req.body, total);
    const existing = await db.prepare('SELECT id, role FROM accounts WHERE email = ?')
      .get(email) as { id: string; role: string } | undefined;
    if (existing?.role === 'admin') throw conflict('This email is already used by an administrator.');
    const id = existing?.id || makeStudentId();
    const name = existing ? '' : field(req.body?.name, 'full name', 120);
    const phone = phoneNumber(req.body?.phone);
    const rollNumber = field(req.body?.rollNumber, 'roll number', 60, false) || id;
    const activate = existing && Boolean(await db.prepare("SELECT 1 FROM student_admissions WHERE account_id = ? AND approved_at = ''").get(id));
    const password = !existing || activate ? temporaryPassword() : undefined;
    const hash = password ? await hashPassword(password) : undefined;
    const result = await transaction(db, async tx => {
      if (!existing) {
        await tx.prepare(`INSERT INTO accounts (id, role, name, email, phone, roll_number, password_hash, must_change, created_at)
          VALUES (?, 'student', ?, ?, ?, ?, ?, 1, ?)`).run(id, name, email, phone, rollNumber, hash!, now());
      } else if (activate) {
        await tx.prepare('UPDATE accounts SET password_hash = ?, must_change = 1 WHERE id = ?').run(hash!, id);
        await tx.prepare('UPDATE student_admissions SET approved_at = ? WHERE account_id = ?').run(now(), id);
        await tx.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);
      }
      const prior = await tx.prepare('SELECT id, status FROM enrollments WHERE account_id = ? AND course_id = ?')
        .get(id, course.id) as { id: string; status: string } | undefined;
      if (prior?.status === 'approved') throw conflict('This student is already enrolled in the course.');
      if (prior?.status === 'pending') throw conflict('Review the existing application from Enrollments.');
      const enrollmentId = prior?.id || makeId();
      const date = now();
      await tx.prepare(`INSERT INTO enrollments (id, account_id, course_id, total, status, submitted_at, approved_at)
        VALUES (?, ?, ?, ?, 'approved', ?, ?) ON CONFLICT(account_id, course_id) DO UPDATE SET
        total = excluded.total, status = 'approved', approved_at = excluded.approved_at, notes = '',
        requested_payment = 0, reference = ''`).run(enrollmentId, id, course.id, total, date, date);
      const receipt = claim.amount ? await issueReceipt(tx, enrollmentId, claim.amount,
        field(req.body?.method, 'payment method', 60), claim.reference, admin.id) : undefined;
      await tx.prepare(`INSERT INTO enrollment_details (enrollment_id, source) VALUES (?, 'admin')
        ON CONFLICT(enrollment_id) DO UPDATE SET source = 'admin'`).run(enrollmentId);
      await audit(tx, admin.id, 'Student enrolled by admin', enrollmentId, course.title);
      return { student: publicAccount((await findAccount(tx, id))!), enrollment: await enrollmentById(tx, enrollmentId), receipt };
    });
    const courseAccess = await grantCourseAccess(db, result.enrollment.id, admin.id, true).catch(() => ({ status: 'failed' }));
    const access = await accessPackage(db, id, portalOrigin(req), password);
    const delivery = req.body?.sendEmail === true ? await deliverAccessEmail(db, admin.id, access, `enroll:${result.enrollment.id}:${result.enrollment.approvedAt}`).catch(() => ({ status: 'unknown', error: 'Enrollment saved. Check Sent Items before sharing these details again.' })) : undefined;
    res.status(201).json({ ...result, temporaryPassword: password, access, delivery, courseAccess });
  }));

  app.post('/api/admin/students/:id/reset-password', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const student = await findAccount(db, req.params.id);
    if (!student || student.role !== 'student') throw notFound('This student is unavailable.');
    await accessPackage(db, student.id, portalOrigin(req));
    const password = temporaryPassword();
    const hash = await hashPassword(password);
    await transaction(db, async tx => {
      await tx.prepare('UPDATE accounts SET password_hash = ?, must_change = 1 WHERE id = ?').run(hash, student.id);
      await tx.prepare('DELETE FROM sessions WHERE account_id = ?').run(student.id);
    });
    const access = await accessPackage(db, student.id, portalOrigin(req), password);
    const delivery = req.body?.sendEmail === true ? await deliverAccessEmail(db, admin.id, access, `reset:${makeId()}`).catch(() => ({ status: 'unknown', error: 'Password reset saved. Check Sent Items before sharing these details again.' })) : undefined;
    res.json({ temporaryPassword: password, access, delivery });
  }));

  app.patch('/api/admin/students/:id', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const student = await findAccount(db, req.params.id);
    if (!student || student.role !== 'student') throw notFound('This student is unavailable.');
    await db.prepare('UPDATE accounts SET name = ?, email = ?, phone = ?, roll_number = ? WHERE id = ?')
      .run(field(req.body?.name, 'full name', 120), emailAddress(req.body?.email),
        phoneNumber(req.body?.phone), field(req.body?.rollNumber, 'roll number', 60), student.id);
    res.json({ student: publicAccount((await findAccount(db, student.id))!) });
  }));

  app.patch('/api/admin/students/:id/placement', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const student = await findAccount(db, req.params.id);
    if (!student || student.role !== 'student') throw notFound('This student is unavailable.');
    await db.prepare(`INSERT INTO placements VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET
      status = excluded.status, target_role = excluded.target_role, notes = excluded.notes`)
      .run(student.id, field(req.body?.status, 'placement status', 100),
        field(req.body?.targetRole, 'target role', 160, false), field(req.body?.notes, 'notes', 2000, false));
    res.status(204).end();
  }));

  app.post('/api/admin/enrollments/:id/decision', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const decision = req.body?.decision;
    if (decision !== 'approved' && decision !== 'rejected') throw badRequest('Choose an enrollment decision.');
    const note = field(req.body?.notes, 'decision notes', 1000, false);
    const candidate = decision === 'approved' ? temporaryPassword() : undefined;
    const candidateHash = candidate ? await hashPassword(candidate) : undefined;
    const result = await transaction(db, async tx => {
      const enrollment = await enrollmentById(tx, req.params.id);
      if (enrollment.status === decision) return { enrollment };
      if (enrollment.status !== 'pending') throw conflict('This application has already been reviewed.');
      await tx.prepare('UPDATE enrollments SET status = ?, approved_at = ?, notes = ? WHERE id = ?')
        .run(decision, decision === 'approved' ? now() : '', note, enrollment.id);
      const activate = decision === 'approved' && Boolean(await tx.prepare("SELECT 1 FROM student_admissions WHERE account_id = ? AND approved_at = ''").get(enrollment.studentId));
      if (activate) {
        await tx.prepare('UPDATE student_admissions SET approved_at = ? WHERE account_id = ?').run(now(), enrollment.studentId);
        await tx.prepare('UPDATE accounts SET password_hash = ?, must_change = 1 WHERE id = ?').run(candidateHash!, enrollment.studentId);
        await tx.prepare('DELETE FROM sessions WHERE account_id = ?').run(enrollment.studentId);
      }
      const receipt = decision === 'approved' && req.body?.recordPayment === true && enrollment.requestedPayment
        ? await issueReceipt(tx, enrollment.id, enrollment.requestedPayment, 'UPI', enrollment.reference, admin.id)
        : undefined;
      if (receipt || decision === 'rejected') {
        await tx.prepare("UPDATE enrollments SET requested_payment = 0, reference = '' WHERE id = ?").run(enrollment.id);
      }
      await audit(tx, admin.id, `Enrollment ${decision}`, enrollment.id, enrollment.studentName);
      return { enrollment: await enrollmentById(tx, enrollment.id), receipt, temporaryPassword: activate ? candidate : undefined, changed: true };
    });
    const courseAccess = decision === 'approved' ? await grantCourseAccess(db, result.enrollment.id, admin.id, true).catch(() => ({ status: 'failed' })) : undefined;
    const access = decision === 'approved' && result.changed ? await accessPackage(db, result.enrollment.studentId, portalOrigin(req), result.temporaryPassword) : undefined;
    const delivery = access && req.body?.sendEmail === true ? await deliverAccessEmail(db, admin.id, access, `approve:${result.enrollment.id}:${result.enrollment.approvedAt}`).catch(() => ({ status: 'unknown', error: 'Approval saved. Check Sent Items before sharing these details again.' })) : undefined;
    res.json({ ...result, access, delivery, courseAccess });
  }));

  app.post('/api/admin/enrollments/:id/payment', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const amount = integer(req.body?.amount, 'payment amount', 1);
    const reference = paymentReference(req.body?.reference);
    const method = field(req.body?.method, 'payment method', 60);
    const receipt = await transaction(db, async tx => {
      const record = await issueReceipt(tx, req.params.id, amount, method, reference, admin.id);
      await tx.prepare(`UPDATE enrollments SET requested_payment = 0, reference = '', notes = ''
        WHERE id = ? AND reference = ? COLLATE NOCASE`).run(req.params.id, reference);
      return record;
    });
    res.json({ receipt });
  }));

  app.post('/api/admin/enrollments/:id/reject-payment', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const enrollment = await enrollmentById(db, req.params.id);
    if (enrollment.status !== 'approved' || !enrollment.requestedPayment) throw conflict('There is no payment to review.');
    await db.prepare("UPDATE enrollments SET requested_payment = 0, reference = '', notes = ? WHERE id = ?")
      .run(field(req.body?.notes, 'payment review notes', 1000), enrollment.id);
    res.status(204).end();
  }));

  app.post('/api/admin/messages', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const student = await findAccount(db, field(req.body?.studentId, 'student', 80));
    if (!student || student.role !== 'student') throw notFound('This student is unavailable.');
    await db.prepare(`INSERT INTO messages VALUES (?, ?, 'admin', ?, ?, ?)`)
      .run(makeId(), student.id, field(req.body?.subject, 'subject', 140), field(req.body?.body, 'message', 3000), now());
    res.status(204).end();
  }));

  app.patch('/api/admin/assignments/:id', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const result = await db.prepare('UPDATE assignments SET feedback = ?, reviewed_at = ? WHERE id = ?')
      .run(field(req.body?.feedback, 'feedback', 4000), now(), req.params.id);
    if (!result.changes) throw notFound('This submission is unavailable.');
    res.status(204).end();
  }));
}

function courseValues(body: Record<string, unknown> | undefined) {
  return [
    field(body?.title, 'course title'),
    field(body?.description, 'description', 3000, false),
    field(body?.category, 'category', 80),
    field(body?.instructor, 'instructor', 120, false),
    field(body?.schedule, 'schedule', 160, false),
    integer(body?.fee, 'fee'),
    Number(body?.published === true),
  ] as const;
}
