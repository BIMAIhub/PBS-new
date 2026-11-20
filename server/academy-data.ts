import type { Database } from './database.js';
import { makeId, now } from './database.js';
import type { CertificateRecord, CertificateTemplate } from '../src/live/academy-types.js';

export async function audit(db: Database, actor: string, action: string, target: string, detail: string) {
  await db.prepare('INSERT INTO academy_events VALUES (?, ?, ?, ?, ?, ?)').run(makeId(), actor, action, target, detail.slice(0, 1000), now());
}

export async function setting(db: Database, key: string) {
  return String((await db.prepare('SELECT value FROM academy_settings WHERE key = ?').get(key))?.value || '');
}

export async function saveSetting(db: Database, key: string, value: string) {
  await db.prepare('INSERT INTO academy_settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export async function paymentSettings(db: Database) {
  const saved = await setting(db, 'payments');
  return saved ? JSON.parse(saved) as { paymentUpiId: string; paymentName: string } : {
    paymentUpiId: process.env.PBS_PAYMENT_UPI_ID?.trim() || '',
    paymentName: process.env.PBS_PAYMENT_NAME?.trim() || 'Pragmatic BIM Solution',
  };
}

export const defaultTemplate: CertificateTemplate = {
  courseId: '', title: 'Certificate of completion', issuer: 'Pragmatic BIM Solution',
  signer: 'Academic Director', signerRole: 'Authorized signatory', design: 'architectural',
  primaryColor: '#176BB7', accentColor: '#D4A94D',
};

export async function certificateTemplate(db: Database, courseId: string): Promise<CertificateTemplate> {
  const row = await db.prepare(`SELECT course_id AS courseId, title, issuer, signer, signer_role AS signerRole,
    design, primary_color AS primaryColor, accent_color AS accentColor FROM certificate_templates
    WHERE course_id IN (?, '') ORDER BY CASE WHEN course_id = ? THEN 0 ELSE 1 END LIMIT 1`).get(courseId, courseId);
  return row ? row as unknown as CertificateTemplate : defaultTemplate;
}

export async function certificateRecords(db: Database, accountId?: string) {
  const rows = await db.prepare(`SELECT id, account_id AS studentId, course_id AS courseId,
    student_name AS studentName, course_title AS courseTitle, score, issued_at AS issuedAt,
    public_token AS publicToken, published, revoked_at AS revokedAt FROM certificates
    ${accountId ? 'WHERE account_id = ?' : ''} ORDER BY issued_at DESC`).all(...(accountId ? [accountId] : []));
  return Promise.all(rows.map(async row => ({ ...row, published: Boolean(row.published), template: await certificateTemplate(db, String(row.courseId)) } as unknown as CertificateRecord)));
}

export async function enrollmentDetails(db: Database, id: string) {
  const row = await db.prepare(`SELECT due_date AS dueDate, source, internal_note AS internalNote FROM enrollment_details WHERE enrollment_id = ?`).get(id);
  return row || { dueDate: '', source: 'unrecorded', internalNote: '' };
}

export async function academyWorkspace(db: Database, accountId?: string) {
  const where = accountId ? 'WHERE e.account_id = ?' : '';
  const params = accountId ? [accountId] : [];
  return {
    certificates: await certificateRecords(db, accountId),
    reminders: await db.prepare(`SELECT r.id, r.enrollment_id AS enrollmentId, r.channel, r.status,
      r.body, r.sent_at AS sentAt, r.error FROM payment_reminders r JOIN enrollments e ON e.id = r.enrollment_id
      ${where} ORDER BY r.sent_at DESC LIMIT 100`).all(...params),
    details: await db.prepare(`SELECT e.id AS enrollmentId, COALESCE(d.due_date, '') AS dueDate,
      COALESCE(d.source, 'unrecorded') AS source ${accountId ? '' : ", COALESCE(d.internal_note, '') AS internalNote"}
      FROM enrollments e LEFT JOIN enrollment_details d ON e.id = d.enrollment_id ${where}`).all(...params),
    grants: await db.prepare(`SELECT g.enrollment_id AS enrollmentId, g.email, g.status, g.error,
      g.updated_at AS updatedAt, CASE WHEN g.status = 'granted' THEN COALESCE(s.web_url, '') ELSE '' END AS webUrl
      FROM course_access_grants g JOIN enrollments e ON e.id = g.enrollment_id
      LEFT JOIN course_storage s ON s.course_id = e.course_id ${where}`).all(...params),
  };
}
