import { publicCredentialCourse } from './credential-course.js';
import { saveCertificateDesign } from './certificate-documents.js';
import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type WritableDatabase, makeId, now, transaction } from './database.js';
import { academyWorkspace, audit, certificateRecords, certificateTemplate, paymentSettings, saveSetting } from './academy-data.js';
import { badRequest, conflict, field, limitAttempts, notFound, RequestError, route } from './http.js';
import { enrollmentById, hasCourseAccess, requireCompletedLessons } from './records.js';
import { verifyPassword } from './passwords.js';
import { portalOrigin, sendMicrosoftMail } from './microsoft.js';
import { queueAutomation } from './mail.js';

export function mountAcademy(app: Express, db: WritableDatabase, hosted: boolean) {
  app.get('/api/admin/academy', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    res.json({ ...await academyWorkspace(db), payment: await paymentSettings(db),
      events: await db.prepare(`SELECT e.id, COALESCE(a.name, 'PBS') AS actor, e.action, e.target_id AS targetId,
        e.detail, e.created_at AS createdAt FROM academy_events e LEFT JOIN accounts a ON a.id = e.actor_id ORDER BY e.created_at DESC LIMIT 150`).all(),
    });
  }));
  app.get('/api/student/academy', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    res.json(await academyWorkspace(db, account.id));
  }));

  app.put('/api/admin/payment-settings', limitAttempts(6, hosted ? db : undefined), route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    if (!await verifyPassword(String(req.body?.current || ''), admin.passwordHash)) throw badRequest('The current password is incorrect.');
    const paymentUpiId = field(req.body?.paymentUpiId, 'UPI ID', 150, false);
    const paymentName = field(req.body?.paymentName, 'payee name', 120);
    if (paymentUpiId && !/^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$/i.test(paymentUpiId)) throw badRequest('Enter a valid UPI ID.');
    await transaction(db, async tx => {
      await saveSetting(tx, 'payments', JSON.stringify({ paymentUpiId, paymentName }));
      await audit(tx, admin.id, 'Payment destination updated', '', paymentUpiId || 'Student UPI payments paused.');
    });
    res.status(204).end();
  }));

  app.patch('/api/admin/enrollments/:id/details', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    await enrollmentById(db, req.params.id);
    const dueDate = field(req.body?.dueDate, 'due date', 10, false);
    if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(`${dueDate}T00:00:00Z`)) || new Date(`${dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== dueDate)) throw badRequest('Choose a valid due date.');
    const note = field(req.body?.internalNote, 'internal note', 3000, false);
    await transaction(db, async tx => {
      await tx.prepare(`INSERT INTO enrollment_details (enrollment_id, due_date, source, internal_note)
        VALUES (?, ?, 'unrecorded', ?) ON CONFLICT(enrollment_id) DO UPDATE SET due_date = excluded.due_date, internal_note = excluded.internal_note`)
        .run(req.params.id, dueDate, note);
      await audit(tx, admin.id, 'Enrollment follow-up updated', req.params.id, dueDate ? `Due ${dueDate}` : 'No due date.');
    });
    res.status(204).end();
  }));

  app.post('/api/admin/enrollments/:id/reminder', limitAttempts(12, hosted ? db : undefined), route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const requestKey = field(req.body?.requestKey, 'reminder request ID', 80);
    const channel = req.body?.channel === 'email' ? 'email' : 'portal';
    const id = makeId();
    const body = field(req.body?.body, 'reminder message', 3000);
    const prepared = await transaction(db, async tx => {
      const prior = await tx.prepare('SELECT id, enrollment_id, status FROM payment_reminders WHERE request_key = ?').get(requestKey);
      if (prior) {
        if (prior.enrollment_id !== req.params.id) throw conflict('This reminder request belongs to another enrollment.');
        return { prior };
      }
      const enrollment = await enrollmentById(tx, req.params.id);
      if (enrollment.status !== 'approved' || enrollment.paid >= enrollment.total) throw conflict('There is no approved outstanding balance to remind.');
      if (channel === 'email' && !await tx.prepare('SELECT 1 FROM microsoft_mail_connections WHERE admin_id = ?').get(admin.id)) throw conflict('Connect your Microsoft email account to send reminders, or choose portal message.');
      const date = now();
      await tx.prepare('INSERT INTO payment_reminders VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, enrollment.id, requestKey, channel, channel === 'portal' ? 'posted' : 'pending', body, date, '');
      await tx.prepare("INSERT INTO messages VALUES (?, ?, 'admin', ?, ?, ?)").run(makeId(), enrollment.studentId, 'Course fee reminder', body, date);
      await audit(tx, admin.id, 'Payment reminder created', enrollment.id, `${channel} reminder for ${enrollment.studentName}`);
      return { enrollment };
    });
    if (prepared.prior) return res.json({ id: prepared.prior.id, status: prepared.prior.status });
    let status = 'posted';
    let error = '';
    if (channel === 'email') {
      try {
        await sendMicrosoftMail(db, admin.id, prepared.enrollment!.email, 'PBS course fee reminder', `${body}\n\nSign in to PBS: ${portalOrigin(req)}`);
        status = 'accepted';
      } catch (problem) {
        status = problem instanceof RequestError ? 'failed' : 'unknown';
        error = problem instanceof RequestError ? problem.message : 'Email delivery could not be confirmed. Check Microsoft Sent Items before retrying.';
      }
      await db.prepare('UPDATE payment_reminders SET status = ?, error = ? WHERE id = ?').run(status, error, id);
    }
    res.json({ id, status, error });
  }));

  app.get('/api/admin/payment-ledger.csv', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const rows = await db.prepare(`SELECT a.name, a.email, c.title, e.status, COALESCE(d.source, 'unrecorded') AS source,
      e.submitted_at, e.total, COALESCE(SUM(r.amount), 0) AS paid, e.requested_payment,
      COALESCE(d.due_date, '') AS due_date, COALESCE(ep.list_price, e.total) AS list_price, COALESCE(ep.discount, 0) AS discount,
      COALESCE(ep.promotion_title, '') AS offer, COALESCE(ep.code, '') AS offer_code FROM enrollments e JOIN accounts a ON a.id = e.account_id
      JOIN courses c ON c.id = e.course_id LEFT JOIN receipts r ON r.enrollment_id = e.id
      LEFT JOIN enrollment_details d ON d.enrollment_id = e.id LEFT JOIN enrollment_prices ep ON ep.enrollment_id = e.id GROUP BY e.id ORDER BY e.submitted_at DESC`).all();
    const safe = (item: unknown) => `"${String(item ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
    const header = ['Student', 'Email', 'Course', 'Status', 'Enrollment source', 'Applied at', 'Fee INR', 'Verified INR', 'Balance INR', 'Reported INR', 'Due date', 'Listed fee INR', 'Discount INR', 'Offer', 'Offer code'];
    const csv = [header, ...rows.map(row => [row.name, row.email, row.title, row.status, row.source, row.submitted_at,
      Number(row.total) / 100, Number(row.paid) / 100, (Number(row.total) - Number(row.paid)) / 100, Number(row.requested_payment) / 100, row.due_date, Number(row.list_price) / 100, Number(row.discount) / 100, row.offer, row.offer_code])]
      .map(row => row.map(safe).join(',')).join('\r\n');
    res.set('Content-Disposition', 'attachment; filename="PBS-payment-ledger.csv"').type('text/csv').send(`\uFEFF${csv}`);
  }));

  app.get('/api/admin/certificate-template', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    res.json(await certificateTemplate(db, field(req.query.courseId, 'course ID', 80, false)));
  }));
  app.put('/api/admin/certificate-template', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const courseId = field(req.body?.courseId, 'course ID', 80, false);
    if (courseId && !await db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) throw notFound('This course is unavailable.');
    const current=await certificateTemplate(db,courseId);
    const color = (name: 'primaryColor'|'accentColor') => {
      const result = field(req.body?.[name]??current[name], 'certificate color', 7);
      if (!/^#[a-f0-9]{6}$/i.test(result)) throw badRequest('Choose valid certificate colors.');
      return result;
    };
    const design = field(req.body?.design??current.design, 'certificate design', 20);
    if (!['architectural', 'classic', 'minimal'].includes(design)) throw badRequest('Choose a certificate design.');
    await transaction(db, async tx => {
      await tx.prepare(`INSERT INTO certificate_templates VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(course_id) DO UPDATE SET title = excluded.title, issuer = excluded.issuer, signer = excluded.signer,
        signer_role = excluded.signer_role, design = excluded.design, primary_color = excluded.primary_color, accent_color = excluded.accent_color`)
        .run(courseId, field(req.body?.title??current.title, 'certificate title', 120), field(req.body?.issuer??current.issuer, 'issuer', 120),
          field(req.body?.signer??current.signer, 'signer name', 120), field(req.body?.signerRole??current.signerRole, 'signer role', 120), design, color('primaryColor'), color('accentColor'));
      await saveCertificateDesign(tx,courseId,req.body||{});
      await audit(tx, admin.id, 'Certificate design saved', courseId, design);
    });
    res.json(await certificateTemplate(db, courseId));
  }));
  app.post('/api/student/courses/:id/certificate', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    const earned = await transaction(db, async tx => {
      const enrolled = await hasCourseAccess(tx, account, req.params.id);
      if (!enrolled) throw notFound('This course is unavailable.');
      const prior = await tx.prepare('SELECT id FROM certificates WHERE account_id = ? AND course_id = ?').get(account.id, req.params.id);
      if (prior) return;
      await requireCompletedLessons(tx, account.id, req.params.id);
      const result = await tx.prepare('SELECT score FROM assessment_results WHERE account_id = ? AND course_id = ? AND passed = 1').get(account.id, req.params.id);
      if (!result) throw conflict('Pass the course assessment to earn your certificate.');
      const course = await tx.prepare('SELECT title FROM courses WHERE id = ?').get(req.params.id);
      const id = `PBS-CERT-${randomBytes(8).toString('hex').toUpperCase()}`;
      await tx.prepare(`INSERT INTO certificates (id, account_id, course_id, student_name, course_title, score, issued_at, public_token)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, account.id, req.params.id, account.name, String(course!.title), Number(result.score), now(), randomBytes(24).toString('base64url'));
      await audit(tx, account.id, 'Certificate earned', id, String(course!.title));
      return { id, course: String(course!.title) };
    });
    if (earned) await queueAutomation(db, 'certificate', `certificate:${earned.id}`, account.id, portalOrigin(req), { course: earned.course });
    const certificate = (await certificateRecords(db, account.id)).find(item => item.courseId === req.params.id);
    res.json(certificate);
  }));
  app.patch('/api/student/certificates/:id', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    const result = await db.prepare('UPDATE certificates SET published = ? WHERE id = ? AND account_id = ? AND revoked_at = ?')
      .run(Number(req.body?.published === true), req.params.id, account.id, '');
    if (!result.changes) throw notFound('This certificate is unavailable.');
    res.status(204).end();
  }));
  app.post('/api/admin/certificates/:id/revoke', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const reason = field(req.body?.reason, 'revocation reason', 1000);
    await transaction(db, async tx => {
      const result = await tx.prepare("UPDATE certificates SET revoked_at = ? WHERE id = ? AND revoked_at = ''").run(now(), req.params.id);
      if (!result.changes) throw notFound('This certificate is unavailable or already revoked.');
      await audit(tx, admin.id, 'Certificate revoked', req.params.id, reason);
    });
    res.status(204).end();
  }));
  app.get('/api/certificates/verify/:token', route(async (req, res) => {
    const record = await db.prepare(`SELECT id, student_name AS studentName, course_title AS courseTitle,
      course_id AS courseId, issued_at AS issuedAt, revoked_at AS revokedAt FROM certificates WHERE public_token = ? AND published = 1`).get(req.params.token);
    if (!record) throw notFound('This certificate is private or unavailable.');
    const history=await db.prepare('SELECT completed_at AS completedAt,mode,original_number AS originalNumber FROM legacy_training WHERE certificate_id=?').get(record.id);
    res.json({ ...record, historical:history||undefined, template: await certificateTemplate(db, String(record.courseId)),course:await publicCredentialCourse(db,String(record.courseId)) });
  }));
}
