import { createHash } from 'node:crypto';
import type { Express } from 'express';
import { findAccount, requireAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, now, transaction } from './database.js';
import { audit, saveSetting, setting } from './academy-data.js';
import { publicBranding } from './branding.js';
import { conflict, field, limitAttempts, notFound, RequestError, route } from './http.js';
import { verifyPassword } from './passwords.js';
import { enrollments, receipts } from './records.js';
import { portalOrigin, sendMicrosoftMail } from './microsoft.js';
import type { AccessDelivery, AccessPackage } from '../src/live/admissions-types.js';

export function whatsappNumber(phone: string) {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && !phone.trim().startsWith('+')) digits = `91${digits}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
}
const currency = (paise: number) => `INR ${(paise / 100).toFixed(2)}`;

export async function migratePendingAdmissions(db: WritableDatabase) {
  if (await setting(db, 'approval_gate_v1')) return;
  await transaction(db, async tx => {
    if (await setting(tx, 'approval_gate_v1')) return;
    await tx.prepare(`INSERT OR IGNORE INTO student_admissions (account_id)
      SELECT a.id FROM accounts a WHERE a.role = 'student'
      AND EXISTS (SELECT 1 FROM enrollments e JOIN enrollment_details d ON d.enrollment_id = e.id WHERE e.account_id = a.id AND e.status = 'pending' AND d.source = 'student')
      AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.account_id = a.id AND e.status = 'approved')
      AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.account_id = a.id AND c.revoked_at = '')`).run();
    await tx.prepare("DELETE FROM sessions WHERE account_id IN (SELECT account_id FROM student_admissions WHERE approved_at = '')").run();
    await saveSetting(tx, 'approval_gate_v1', now());
  });
}

export async function accessPackage(db: Database, studentId: string, origin: string, password?: string): Promise<AccessPackage> {
  const student = await findAccount(db, studentId);
  if (!student || student.role !== 'student' || student.accountStatus !== 'active') throw notFound('This student is inactive or unavailable.');
  const approved = (await enrollments(db, studentId)).filter(item => item.status === 'approved');
  const historical = await db.prepare(`SELECT c.course_title AS title,h.completed_at AS completedAt,h.mode FROM legacy_training h JOIN certificates c ON c.id=h.certificate_id WHERE h.account_id=? AND c.revoked_at=''`).all(studentId);
  if (!approved.length && !historical.length) throw conflict('Approve an enrollment or verify a past training record before sharing student access.');
  const brand = await publicBranding(db);
  const summaries = await Promise.all(approved.map(async item => {
    const course = await db.prepare('SELECT description FROM courses WHERE id = ?').get(item.courseId);
    const summary = String(course?.description || '').replace(/\s+/g, ' ').slice(0, 220);
    return `${item.courseTitle}${summary ? `\n${summary}` : ''}\nAgreed fee: ${currency(item.total)} | Verified payments: ${currency(item.paid)} | Pending fee: ${currency(item.total - item.paid)}${item.requestedPayment ? `\nReported payment awaiting verification: ${currency(item.requestedPayment)} (not yet included in paid totals).` : ''}${item.dueDate ? `\nPayment due date: ${item.dueDate}` : ''}\nCourse information: ${origin}/courses/${encodeURIComponent(item.courseId)}`;
  }));
  const recent = (await receipts(db, studentId)).slice(0, 3);
  const signInUrl = `${origin}/`;
  const body = [`Hello ${student.name},`, approved.length ? `Your enrollment at ${brand.academyName} is approved.` : `Your past training record at ${brand.academyName} is verified. Your student portal and certificates are ready.`,
    `Sign in: ${signInUrl}`, `Email: ${student.email}`, `Student ID: ${student.id}`,
    password ? `Temporary password: ${password}\nSet a new password when you first sign in.` : 'Use your existing PBS password. Contact the academy if you need a password reset.',
    ...summaries, ...historical.map(item => `Verified past training: ${item.title}\nCompleted: ${item.completedAt} | Mode: ${item.mode}\nCertificates: ${origin}/?page=certificates\nEnable public verification in My certificates to share on LinkedIn. Current online lesson access is separate.`),
    approved.length && recent.length ? `Receipts: ${recent.map(item => `${item.number} (${currency(item.amount)})`).join(', ')}` : approved.length ? 'A receipt is issued after PBS verifies a payment.' : '',
    approved.length ? `Receipts and current fee statement: ${origin}/?page=fees\nBonafide enrollment letter: ${origin}/?page=downloads` : '',
    `Support: ${brand.supportEmail}`].filter(Boolean).join('\n\n');
  return { studentId, name: student.name, email: student.email, phone: student.phone, whatsappNumber: whatsappNumber(student.phone), signInUrl, password,
    subject: approved.length ? `${brand.shortName} enrollment approved — your student access` : `${brand.shortName} verified past training — your student access`, body };
}

// Delivery records contain status and a digest, never the temporary password or message body.
export async function deliverAccessEmail(db: WritableDatabase, adminId: string, kit: AccessPackage, requestKey: string, sendMail = sendMicrosoftMail): Promise<AccessDelivery> {
  if (!await db.prepare('SELECT 1 FROM microsoft_mail_connections WHERE admin_id = ?').get(adminId)) {
    return { status: 'unconfigured', error: 'Email was not sent. Connect Microsoft in OneDrive & email to send directly, or use the email draft or WhatsApp button.' };
  }
  const contentHash = createHash('sha256').update(`${kit.studentId}\n${kit.email}\n${kit.body}`).digest('hex');
  const prepared = await transaction(db, async tx => {
    const current = await findAccount(tx, kit.studentId);
    if (!current || current.role !== 'student' || current.email !== kit.email || (kit.password && (!current.mustChangePassword || !await verifyPassword(kit.password, current.passwordHash)))) {
      throw conflict('The student access details changed. Prepare a new message before sending.');
    }
    const prior = await tx.prepare('SELECT id, account_id, content_hash, status, error FROM access_deliveries WHERE request_key = ?').get(requestKey);
    if (prior) {
      if (prior.account_id !== kit.studentId || prior.content_hash !== contentHash) throw conflict('This delivery request belongs to different access details. Start a new sharing action.');
      return { id: String(prior.id), prior: { id: String(prior.id), status: prior.status, error: prior.error } as AccessDelivery };
    }
    const id = makeId();
    await tx.prepare('INSERT INTO access_deliveries (id, account_id, request_key, content_hash, email, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, kit.studentId, requestKey, contentHash, kit.email, 'pending', now());
    return { id };
  });
  if (prepared.prior) return prepared.prior;
  let status: AccessDelivery['status'] = 'accepted', error = '';
  try { await sendMail(db, adminId, kit.email, kit.subject, kit.body); }
  catch (problem) {
    status = problem instanceof RequestError ? 'failed' : 'unknown';
    error = problem instanceof RequestError ? problem.message : 'Delivery is uncertain. Check Microsoft Sent Items before sending another message.';
  }
  await transaction(db, async tx => {
    await tx.prepare('UPDATE access_deliveries SET status = ?, error = ? WHERE id = ?').run(status, error, prepared.id);
    await audit(tx, adminId, 'Student access email', kit.studentId, `${kit.email} · ${status}`);
  });
  return { id: prepared.id, status, ...(error ? { error } : {}) };
}

export function mountAdmissions(app: Express, db: WritableDatabase, hosted: boolean) {
  app.get('/api/admin/students/:id/access-package', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    res.json(await accessPackage(db, req.params.id, portalOrigin(req)));
  }));
  app.get('/api/admin/students/:id/access-deliveries', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    res.json({ deliveries: await db.prepare('SELECT id, email, status, created_at AS createdAt, error FROM access_deliveries WHERE account_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.id) });
  }));
  app.post('/api/admin/students/:id/access-email', limitAttempts(12, hosted ? db : undefined), route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const student = await findAccount(db, req.params.id);
    if (!student || student.role !== 'student') throw notFound('This student is unavailable.');
    const password = field(req.body?.temporaryPassword, 'temporary password', 128, false);
    if (password && (!student.mustChangePassword || !await verifyPassword(password, student.passwordHash))) {
      throw conflict('That temporary password is no longer valid. Use the current access details or create a new temporary password.');
    }
    const kit = await accessPackage(db, student.id, portalOrigin(req), password || undefined);
    res.json(await deliverAccessEmail(db, admin.id, kit, field(req.body?.requestKey, 'delivery request ID', 100)));
  }));
}
