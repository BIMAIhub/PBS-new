import type { Express } from 'express';
import { findAccount, publicAccount, requireAccount, sessionAccount, startSession } from './auth.js';
import { type WritableDatabase, makeId, makeStudentId, now, transaction } from './database.js';
import { badRequest, conflict, emailAddress, field, limitAttempts, notFound, RequestError, route } from './http.js';
import { httpsLink, paymentClaim, phoneNumber } from './inputs.js';
import { hashPassword, validPassword } from './passwords.js';
import { audit, paymentSettings } from './academy-data.js';
import {
  checkReference, courseById, courses, enrollmentById, getAssessment, hasCourseAccess,
  portfolio, requireCompletedLessons, studentWorkspace
} from './records.js';

export function mountStudent(app: Express, db: WritableDatabase, hosted: boolean) {
  app.get('/api/catalog', route(async (_req, res) => {
    res.json({
      courses: await courses(db, true),
      ...await paymentSettings(db),
    });
  }));

  app.post('/api/enrollments/lookup', limitAttempts(16, hosted ? db : undefined), route(async (req, res) => {
    const email = emailAddress(req.body?.email);
    const id = field(req.body?.code, 'application code', 64);
    const enrollment = await db.prepare(`SELECT e.status FROM enrollments e
      JOIN accounts a ON a.id = e.account_id WHERE e.id = ? AND a.email = ? COLLATE NOCASE`)
      .get(id, email);
    if (!enrollment) throw notFound('No application matches that email and application code.');
    res.json({ status: enrollment.status });
  }));

  app.post('/api/enrollments', limitAttempts(12, hosted ? db : undefined), route(async (req, res) => {
    const courseId = field(req.body?.courseId, 'course', 80);
    const course = await courseById(db, courseId);
    if (!course.published) throw notFound('This course is unavailable for enrollment.');
    const claim = paymentClaim(req.body, course.fee);
    if (claim.amount && !(await paymentSettings(db)).paymentUpiId) {
      throw badRequest('Contact PBS to arrange payment for this course.');
    }
    const signedIn = await sessionAccount(db, req);
    if (signedIn && (signedIn.role !== 'student' || signedIn.mustChangePassword)) {
      throw new RequestError(403, 'Sign in with a student account to apply.');
    }
    const id = signedIn?.id || makeStudentId();
    let signup: { email: string; name: string; phone: string; hash: string } | undefined;
    if (!signedIn) {
      const email = emailAddress(req.body?.email);
      const name = field(req.body?.name, 'full name', 120);
      const phone = phoneNumber(req.body?.phone);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!validPassword(password)) throw badRequest('Use a password with at least 12 characters.');
      if (await db.prepare('SELECT id FROM accounts WHERE email = ?').get(email)) {
        throw conflict('Sign in with your existing PBS account to apply.');
      }
      signup = { email, name, phone, hash: await hashPassword(password) };
    }

    const enrollment = await transaction(db, async tx => {
      const available = await courseById(tx, courseId);
      if (!available.published || available.fee !== course.fee) throw conflict('This course changed. Refresh the catalog and try again.');
      if (signup) {
        await tx.prepare(`INSERT INTO accounts (id, role, name, email, phone, roll_number, password_hash, created_at)
          VALUES (?, 'student', ?, ?, ?, ?, ?, ?)`)
          .run(id, signup.name, signup.email, signup.phone, id, signup.hash, now());
      }
      const previous = await tx.prepare('SELECT id, status FROM enrollments WHERE account_id = ? AND course_id = ?')
        .get(id, course.id) as { id: string; status: string } | undefined;
      if (previous?.status === 'approved') throw conflict('You are already enrolled in this course.');
      if (previous?.status === 'pending') throw conflict('You already have a pending application for this course.');
      const enrollmentId = previous?.id || makeId();
      await checkReference(tx, claim.reference, enrollmentId);
      await tx.prepare(`INSERT INTO enrollments (id, account_id, course_id, total, status, requested_payment, reference, submitted_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT(account_id, course_id) DO UPDATE SET
        total = excluded.total, status = 'pending', requested_payment = excluded.requested_payment,
        reference = excluded.reference, submitted_at = excluded.submitted_at, notes = '', approved_at = ''`)
        .run(enrollmentId, id, course.id, course.fee, claim.amount, claim.reference, now());
      await tx.prepare(`INSERT INTO enrollment_details (enrollment_id, source) VALUES (?, 'student')
        ON CONFLICT(enrollment_id) DO UPDATE SET source = 'student'`).run(enrollmentId);
      await audit(tx, id, 'Enrollment application submitted', enrollmentId, course.title);
      return await enrollmentById(tx, enrollmentId);
    });
    if (signup) await startSession(db, req, res, id, false);
    res.status(201).json({ enrollment, account: publicAccount((await findAccount(db, id))!) });
  }));

  app.get('/api/student/workspace', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    res.json(await studentWorkspace(db, publicAccount(account)));
  }));

  app.post('/api/student/enrollments/:id/payment', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    if (!(await paymentSettings(db)).paymentUpiId) throw badRequest('Contact PBS to arrange payment.');
    const enrollment = await transaction(db, async tx => {
      const current = await enrollmentById(tx, req.params.id);
      if (current.studentId !== account.id || current.status !== 'approved') throw notFound('This enrollment is unavailable.');
      const claim = paymentClaim(req.body, current.total - current.paid);
      if (!claim.amount) throw badRequest('Enter a payment amount and reference.');
      if (current.requestedPayment) throw conflict('A payment is already awaiting review for this course.');
      await checkReference(tx, claim.reference, current.id);
      if (await tx.prepare('SELECT id FROM receipts WHERE reference = ? COLLATE NOCASE').get(claim.reference)) {
        throw conflict('This payment reference has already been recorded.');
      }
      await tx.prepare('UPDATE enrollments SET requested_payment = ?, reference = ?, notes = ? WHERE id = ?')
        .run(claim.amount, claim.reference, '', current.id);
      await audit(tx, account.id, 'Payment reference submitted', current.id, `INR ${(claim.amount / 100).toFixed(2)} awaiting verification`);
      return await enrollmentById(tx, current.id);
    });
    res.json({ enrollment });
  }));

  app.post('/api/student/lessons/:id/completion', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    const lesson = await db.prepare(`SELECT m.course_id AS courseId FROM lessons l JOIN modules m ON m.id = l.module_id
      WHERE l.id = ?`).get(req.params.id) as { courseId: string } | undefined;
    if (!lesson || !await hasCourseAccess(db, account, lesson.courseId)) throw notFound('This lesson is unavailable.');
    if (req.body?.completed === true) {
      await db.prepare('INSERT OR IGNORE INTO completions VALUES (?, ?, ?)').run(account.id, req.params.id, now());
    } else if (req.body?.completed === false) {
      await db.prepare('DELETE FROM completions WHERE account_id = ? AND lesson_id = ?').run(account.id, req.params.id);
    } else throw badRequest('Choose a lesson completion status.');
    res.status(204).end();
  }));

  app.get('/api/courses/:id/discussion', route(async (req, res) => {
    const account = await requireAccount(db, req);
    if (!await hasCourseAccess(db, account, req.params.id)) throw notFound('This course is unavailable.');
    res.json({
      posts: await db.prepare(`SELECT p.id, a.name, a.role, p.body, p.sent_at AS sentAt
        FROM course_posts p JOIN accounts a ON a.id = p.account_id WHERE p.course_id = ?
        ORDER BY p.sent_at DESC LIMIT 100`).all(req.params.id),
    });
  }));

  app.post('/api/courses/:id/discussion', limitAttempts(18, hosted ? db : undefined), route(async (req, res) => {
    const account = await requireAccount(db, req);
    await courseById(db, req.params.id);
    if (!await hasCourseAccess(db, account, req.params.id)) throw notFound('This course is unavailable.');
    await db.prepare('INSERT INTO course_posts VALUES (?, ?, ?, ?, ?)')
      .run(makeId(), req.params.id, account.id, field(req.body?.body, 'discussion message', 2000), now());
    res.status(204).end();
  }));

  app.patch('/api/student/profile', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    const name = field(req.body?.name, 'full name', 120);
    const phone = phoneNumber(req.body?.phone);
    await db.prepare('UPDATE accounts SET name = ?, phone = ? WHERE id = ?').run(name, phone, account.id);
    res.json({ account: publicAccount((await findAccount(db, account.id))!) });
  }));

  app.post('/api/student/assignments', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    const courseId = field(req.body?.courseId, 'course', 80);
    if (!await hasCourseAccess(db, account, courseId)) throw notFound('This course is unavailable.');
    const url = httpsLink(req.body?.url, 'project link');
    const note = field(req.body?.note, 'project notes', 2000, false);
    await db.prepare(`INSERT INTO assignments (id, account_id, course_id, url, note, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, course_id) DO UPDATE SET
      url = excluded.url, note = excluded.note, submitted_at = excluded.submitted_at, feedback = '', reviewed_at = ''`)
      .run(makeId(), account.id, courseId, url, note, now());
    res.status(204).end();
  }));

  app.post('/api/student/messages', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    await db.prepare(`INSERT INTO messages VALUES (?, ?, 'student', ?, ?, ?)`)
      .run(makeId(), account.id, field(req.body?.subject, 'subject', 140), field(req.body?.body, 'message', 3000), now());
    res.status(204).end();
  }));

  app.get('/api/student/courses/:id/assessment', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    if (!await hasCourseAccess(db, account, req.params.id)) throw notFound('This course is unavailable.');
    await requireCompletedLessons(db, account.id, req.params.id);
    const assessment = await getAssessment(db, req.params.id);
    res.json({
      passingScore: assessment.passingScore,
      questions: assessment.questions.map(({ prompt, options }) => ({ prompt, options })),
    });
  }));

  app.post('/api/student/courses/:id/assessment', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    if (!await hasCourseAccess(db, account, req.params.id)) throw notFound('This course is unavailable.');
    const { questions, passingScore } = await getAssessment(db, req.params.id);
    const answers = req.body?.answers;
    if (!Array.isArray(answers) || answers.length !== questions.length ||
        answers.some((answer, index) => !Number.isInteger(answer) || answer < 0 || answer >= questions[index].options.length)) {
      throw badRequest('Answer every question before submitting.');
    }
    const result = await transaction(db, async tx => {
      await requireCompletedLessons(tx, account.id, req.params.id);
      const correct = questions.filter((question, index) => question.answer === answers[index]).length;
      const score = Math.round(correct / questions.length * 100);
      const passed = score >= passingScore;
      const submittedAt = now();
      await tx.prepare(`INSERT INTO assessment_results VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(course_id, account_id) DO UPDATE SET score = excluded.score, passed = excluded.passed,
        submitted_at = excluded.submitted_at WHERE assessment_results.passed = 0 OR excluded.passed = 1`)
        .run(req.params.id, account.id, score, Number(passed), submittedAt);
      return { score, passed, submittedAt };
    });
    res.json(result);
  }));

  app.patch('/api/student/portfolio', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    const published = req.body?.published === true;
    const headline = field(req.body?.headline, 'portfolio headline', 160, published);
    const bio = field(req.body?.bio, 'portfolio summary', 5000, false);
    const url = httpsLink(req.body?.projectUrl, 'project link', false);
    const linkedin = httpsLink(req.body?.linkedin, 'LinkedIn profile', false);
    const github = httpsLink(req.body?.github, 'GitHub profile', false);
    const website = httpsLink(req.body?.website, 'website', false);
    await transaction(db, async tx => {
    await tx.prepare(`INSERT INTO portfolios VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET headline = excluded.headline, bio = excluded.bio,
      project_url = excluded.project_url, published = excluded.published`)
      .run(account.id, headline, bio, url, Number(published));
    await tx.prepare(`INSERT INTO portfolio_links VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET
      linkedin = excluded.linkedin, github = excluded.github, website = excluded.website`).run(account.id, linkedin, github, website);
    });
    res.json({ portfolio: await portfolio(db, account.id) });
  }));

  app.get('/api/portfolios/:id', route(async (req, res) => {
    const student = await findAccount(db, req.params.id);
    const profile = student ? await portfolio(db, student.id) : null;
    if (!student || student.role !== 'student' || !profile?.published) throw notFound('This portfolio is unavailable.');
    res.json({ name: student.name, portfolio: profile });
  }));
}
