import type { Express } from 'express';
import { findAccount, publicAccount, requireAccount, sessionAccount, startSession } from './auth';
import { type Database, makeId, makeStudentId, now, transaction } from './database';
import { badRequest, conflict, emailAddress, field, limitAttempts, notFound, RequestError, route } from './http';
import { httpsLink, paymentClaim, phoneNumber } from './inputs';
import { hashPassword, validPassword } from './passwords';
import {
  checkReference, courseById, courses, enrollmentById, getAssessment, hasCourseAccess,
  portfolio, requireCompletedLessons, studentWorkspace
} from './records';

export function mountStudent(app: Express, db: Database) {
  app.get('/api/catalog', route((_req, res) => {
    res.json({
      courses: courses(db, true),
      paymentUpiId: process.env.PBS_PAYMENT_UPI_ID?.trim() || '',
      paymentName: process.env.PBS_PAYMENT_NAME?.trim() || 'Pragmatic BIM Solution',
    });
  }));

  app.post('/api/enrollments/lookup', limitAttempts(16), route((req, res) => {
    const email = emailAddress(req.body?.email);
    const id = field(req.body?.code, 'application code', 64);
    const enrollment = db.prepare(`SELECT e.status FROM enrollments e
      JOIN accounts a ON a.id = e.account_id WHERE e.id = ? AND a.email = ? COLLATE NOCASE`)
      .get(id, email);
    if (!enrollment) throw notFound('No application matches that email and application code.');
    res.json({ status: enrollment.status });
  }));

  app.post('/api/enrollments', limitAttempts(12), route(async (req, res) => {
    const courseId = field(req.body?.courseId, 'course', 80);
    const course = courseById(db, courseId);
    if (!course.published) throw notFound('This course is unavailable for enrollment.');
    const claim = paymentClaim(req.body, course.fee);
    if (claim.amount && !process.env.PBS_PAYMENT_UPI_ID?.trim()) {
      throw badRequest('Contact PBS to arrange payment for this course.');
    }
    const signedIn = sessionAccount(db, req);
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
      if (db.prepare('SELECT id FROM accounts WHERE email = ?').get(email)) {
        throw conflict('Sign in with your existing PBS account to apply.');
      }
      signup = { email, name, phone, hash: await hashPassword(password) };
    }

    const enrollment = transaction(db, () => {
      const available = courseById(db, courseId);
      if (!available.published || available.fee !== course.fee) throw conflict('This course changed. Refresh the catalog and try again.');
      if (signup) {
        db.prepare(`INSERT INTO accounts (id, role, name, email, phone, roll_number, password_hash, created_at)
          VALUES (?, 'student', ?, ?, ?, ?, ?, ?)`)
          .run(id, signup.name, signup.email, signup.phone, id, signup.hash, now());
      }
      const previous = db.prepare('SELECT id, status FROM enrollments WHERE account_id = ? AND course_id = ?')
        .get(id, course.id) as { id: string; status: string } | undefined;
      if (previous?.status === 'approved') throw conflict('You are already enrolled in this course.');
      if (previous?.status === 'pending') throw conflict('You already have a pending application for this course.');
      const enrollmentId = previous?.id || makeId();
      checkReference(db, claim.reference, enrollmentId);
      db.prepare(`INSERT INTO enrollments (id, account_id, course_id, total, status, requested_payment, reference, submitted_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT(account_id, course_id) DO UPDATE SET
        total = excluded.total, status = 'pending', requested_payment = excluded.requested_payment,
        reference = excluded.reference, submitted_at = excluded.submitted_at, notes = '', approved_at = ''`)
        .run(enrollmentId, id, course.id, course.fee, claim.amount, claim.reference, now());
      return enrollmentById(db, enrollmentId);
    });
    if (signup) startSession(db, req, res, id, false);
    res.status(201).json({ enrollment, account: publicAccount(findAccount(db, id)!) });
  }));

  app.get('/api/student/workspace', route((req, res) => {
    const account = requireAccount(db, req, 'student');
    res.json(studentWorkspace(db, publicAccount(account)));
  }));

  app.post('/api/student/enrollments/:id/payment', route((req, res) => {
    const account = requireAccount(db, req, 'student');
    if (!process.env.PBS_PAYMENT_UPI_ID?.trim()) throw badRequest('Contact PBS to arrange payment.');
    const enrollment = transaction(db, () => {
      const current = enrollmentById(db, req.params.id);
      if (current.studentId !== account.id || current.status !== 'approved') throw notFound('This enrollment is unavailable.');
      const claim = paymentClaim(req.body, current.total - current.paid);
      if (!claim.amount) throw badRequest('Enter a payment amount and reference.');
      if (current.requestedPayment) throw conflict('A payment is already awaiting review for this course.');
      checkReference(db, claim.reference, current.id);
      if (db.prepare('SELECT id FROM receipts WHERE reference = ? COLLATE NOCASE').get(claim.reference)) {
        throw conflict('This payment reference has already been recorded.');
      }
      db.prepare('UPDATE enrollments SET requested_payment = ?, reference = ?, notes = ? WHERE id = ?')
        .run(claim.amount, claim.reference, '', current.id);
      return enrollmentById(db, current.id);
    });
    res.json({ enrollment });
  }));

  app.post('/api/student/lessons/:id/completion', route((req, res) => {
    const account = requireAccount(db, req, 'student');
    const lesson = db.prepare(`SELECT m.course_id AS courseId FROM lessons l JOIN modules m ON m.id = l.module_id
      WHERE l.id = ?`).get(req.params.id) as { courseId: string } | undefined;
    if (!lesson || !hasCourseAccess(db, account, lesson.courseId)) throw notFound('This lesson is unavailable.');
    if (req.body?.completed === true) {
      db.prepare('INSERT OR IGNORE INTO completions VALUES (?, ?, ?)').run(account.id, req.params.id, now());
    } else if (req.body?.completed === false) {
      db.prepare('DELETE FROM completions WHERE account_id = ? AND lesson_id = ?').run(account.id, req.params.id);
    } else throw badRequest('Choose a lesson completion status.');
    res.status(204).end();
  }));

  app.get('/api/courses/:id/discussion', route((req, res) => {
    const account = requireAccount(db, req);
    if (!hasCourseAccess(db, account, req.params.id)) throw notFound('This course is unavailable.');
    res.json({
      posts: db.prepare(`SELECT p.id, a.name, a.role, p.body, p.sent_at AS sentAt
        FROM course_posts p JOIN accounts a ON a.id = p.account_id WHERE p.course_id = ?
        ORDER BY p.sent_at DESC LIMIT 100`).all(req.params.id),
    });
  }));

  app.post('/api/courses/:id/discussion', limitAttempts(18), route((req, res) => {
    const account = requireAccount(db, req);
    courseById(db, req.params.id);
    if (!hasCourseAccess(db, account, req.params.id)) throw notFound('This course is unavailable.');
    db.prepare('INSERT INTO course_posts VALUES (?, ?, ?, ?, ?)')
      .run(makeId(), req.params.id, account.id, field(req.body?.body, 'discussion message', 2000), now());
    res.status(204).end();
  }));

  app.patch('/api/student/profile', route((req, res) => {
    const account = requireAccount(db, req, 'student');
    const name = field(req.body?.name, 'full name', 120);
    const phone = phoneNumber(req.body?.phone);
    db.prepare('UPDATE accounts SET name = ?, phone = ? WHERE id = ?').run(name, phone, account.id);
    res.json({ account: publicAccount(findAccount(db, account.id)!) });
  }));

  app.post('/api/student/assignments', route((req, res) => {
    const account = requireAccount(db, req, 'student');
    const courseId = field(req.body?.courseId, 'course', 80);
    if (!hasCourseAccess(db, account, courseId)) throw notFound('This course is unavailable.');
    const url = httpsLink(req.body?.url, 'project link');
    const note = field(req.body?.note, 'project notes', 2000, false);
    db.prepare(`INSERT INTO assignments (id, account_id, course_id, url, note, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, course_id) DO UPDATE SET
      url = excluded.url, note = excluded.note, submitted_at = excluded.submitted_at, feedback = '', reviewed_at = ''`)
      .run(makeId(), account.id, courseId, url, note, now());
    res.status(204).end();
  }));

  app.post('/api/student/messages', route((req, res) => {
    const account = requireAccount(db, req, 'student');
    db.prepare(`INSERT INTO messages VALUES (?, ?, 'student', ?, ?, ?)`)
      .run(makeId(), account.id, field(req.body?.subject, 'subject', 140), field(req.body?.body, 'message', 3000), now());
    res.status(204).end();
  }));

  app.get('/api/student/courses/:id/assessment', route((req, res) => {
    const account = requireAccount(db, req, 'student');
    if (!hasCourseAccess(db, account, req.params.id)) throw notFound('This course is unavailable.');
    requireCompletedLessons(db, account.id, req.params.id);
    const assessment = getAssessment(db, req.params.id);
    res.json({
      passingScore: assessment.passingScore,
      questions: assessment.questions.map(({ prompt, options }) => ({ prompt, options })),
    });
  }));

  app.post('/api/student/courses/:id/assessment', route((req, res) => {
    const account = requireAccount(db, req, 'student');
    if (!hasCourseAccess(db, account, req.params.id)) throw notFound('This course is unavailable.');
    const { questions, passingScore } = getAssessment(db, req.params.id);
    const answers = req.body?.answers;
    if (!Array.isArray(answers) || answers.length !== questions.length ||
        answers.some((answer, index) => !Number.isInteger(answer) || answer < 0 || answer >= questions[index].options.length)) {
      throw badRequest('Answer every question before submitting.');
    }
    const result = transaction(db, () => {
      requireCompletedLessons(db, account.id, req.params.id);
      const correct = questions.filter((question, index) => question.answer === answers[index]).length;
      const score = Math.round(correct / questions.length * 100);
      const passed = score >= passingScore;
      const submittedAt = now();
      db.prepare(`INSERT INTO assessment_results VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(course_id, account_id) DO UPDATE SET score = excluded.score, passed = excluded.passed,
        submitted_at = excluded.submitted_at WHERE assessment_results.passed = 0 OR excluded.passed = 1`)
        .run(req.params.id, account.id, score, Number(passed), submittedAt);
      return { score, passed, submittedAt };
    });
    res.json(result);
  }));

  app.patch('/api/student/portfolio', route((req, res) => {
    const account = requireAccount(db, req, 'student');
    const published = req.body?.published === true;
    const headline = field(req.body?.headline, 'portfolio headline', 160, published);
    const bio = field(req.body?.bio, 'portfolio summary', 5000, false);
    const url = httpsLink(req.body?.projectUrl, 'project link', false);
    db.prepare(`INSERT INTO portfolios VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET headline = excluded.headline, bio = excluded.bio,
      project_url = excluded.project_url, published = excluded.published`)
      .run(account.id, headline, bio, url, Number(published));
    res.json({ portfolio: portfolio(db, account.id) });
  }));

  app.get('/api/portfolios/:id', route((req, res) => {
    const student = findAccount(db, req.params.id);
    const profile = student ? portfolio(db, student.id) : null;
    if (!student || student.role !== 'student' || !profile?.published) throw notFound('This portfolio is unavailable.');
    res.json({ name: student.name, portfolio: profile });
  }));
}
