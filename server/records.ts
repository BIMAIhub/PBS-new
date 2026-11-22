import type {
  Account, AssessmentQuestion, AssessmentResult, Assignment, Completion, Course, CourseSummary,
  Enrollment, Lesson, Message, Portfolio, Receipt, StudentRecord
} from '../src/live/types.js';
import { accountFields, publicAccount } from './auth.js';
import { type Database, makeId, now } from './database.js';
import { conflict, notFound, badRequest } from './http.js';
import { videoPlayback, videoSourceKey } from './video.js';
import { audit } from './academy-data.js';
import { studentLiveData } from './live-classes.js';
import { activeCourseAccess } from './access-controls.js';

const courseFields = `id, title, description, category, instructor, schedule, fee, published,
  COALESCE((SELECT paused FROM course_controls WHERE course_id = courses.id), 0) AS paused,
  COALESCE((SELECT reason FROM course_controls WHERE course_id = courses.id), '') AS pauseReason`;
const enrollmentFields = `e.id, e.account_id AS studentId, a.name AS studentName, a.email,
  e.course_id AS courseId, c.title AS courseTitle, e.status, e.total, e.requested_payment AS requestedPayment,
  e.reference, e.submitted_at AS submittedAt, e.approved_at AS approvedAt, e.notes, COALESCE(ed.due_date, '') AS dueDate,
  COALESCE((SELECT paused FROM enrollment_controls WHERE enrollment_id = e.id), 0) AS accessPaused,
  COALESCE((SELECT reason FROM enrollment_controls WHERE enrollment_id = e.id), '') AS pauseReason,
  COALESCE((SELECT paused FROM course_controls WHERE course_id = e.course_id), 0) AS coursePaused,
  COALESCE(ep.list_price, e.total) AS listPrice, COALESCE(ep.discount, 0) AS discount,
  COALESCE(ep.promotion_title, '') AS promotionTitle, COALESCE(ep.code, '') AS promotionCode,
  COALESCE((SELECT SUM(r.amount) FROM receipts r WHERE r.enrollment_id = e.id), 0) AS paid`;
const enrollmentJoin = `FROM enrollments e JOIN accounts a ON a.id = e.account_id JOIN courses c ON c.id = e.course_id
  LEFT JOIN enrollment_prices ep ON ep.enrollment_id = e.id LEFT JOIN enrollment_details ed ON ed.enrollment_id = e.id`;
const receiptFields = `r.id, r.sequence, e.account_id AS studentId,
  COALESCE(NULLIF(r.student_name, ''), a.name) AS studentName, COALESCE(NULLIF(r.course_title, ''), c.title) AS courseTitle,
  r.enrollment_id AS enrollmentId, r.amount, r.method, r.reference, r.issued_at AS issuedAt,
  COALESCE(rb.total_fee, e.total) AS feeTotal,
  COALESCE(rb.paid_to_date, (SELECT SUM(r2.amount) FROM receipts r2 WHERE r2.enrollment_id = r.enrollment_id AND r2.sequence <= r.sequence)) AS paidToDate,
  COALESCE(rb.balance, e.total - (SELECT SUM(r3.amount) FROM receipts r3 WHERE r3.enrollment_id = r.enrollment_id AND r3.sequence <= r.sequence)) AS balanceAfter,
  COALESCE(rb.due_date, '') AS dueDate`;
const receiptJoin = `FROM receipts r JOIN enrollments e ON e.id = r.enrollment_id
  JOIN accounts a ON a.id = e.account_id JOIN courses c ON c.id = e.course_id
  LEFT JOIN receipt_balances rb ON rb.receipt_id = r.id`;

export async function courses(db: Database, publishedOnly = false): Promise<CourseSummary[]> {
  const rows = await db.prepare(`SELECT ${courseFields} FROM courses ${publishedOnly ? 'WHERE published = 1' : ''} ORDER BY created_at DESC`).all();
  return (rows as unknown as CourseSummary[]).map(row => ({ ...row, published: Boolean(row.published), paused: Boolean(row.paused) }));
}

export async function courseById(db: Database, id: string) {
  const row = await db.prepare(`SELECT ${courseFields} FROM courses WHERE id = ?`).get(id) as unknown as CourseSummary | undefined;
  if (!row) throw notFound('This course is unavailable.');
  return { ...row, published: Boolean(row.published), paused: Boolean(row.paused) };
}

type LessonRow = { id: string; title: string; duration: string; description: string; sourceUrl: string; fileName: string };

export async function courseDetails(db: Database, course: CourseSummary, includeSources = false): Promise<Course> {
  const modules = await db.prepare('SELECT id, title FROM modules WHERE course_id = ? ORDER BY position').all(course.id) as { id: string; title: string }[];
  const links = await db.prepare('SELECT id, kind, title, url, starts_at AS startsAt FROM course_links WHERE course_id = ? ORDER BY starts_at, title')
    .all(course.id) as { id: string; kind: 'resource' | 'session'; title: string; url: string; startsAt: string }[];
  return {
    ...course,
    modules: await Promise.all(modules.map(async module => ({
      ...module,
      lessons: (await db.prepare(`SELECT id, title, duration, description, source_url AS sourceUrl, file_name AS fileName
        FROM lessons WHERE module_id = ? ORDER BY position`).all(module.id) as LessonRow[])
        .map(({ sourceUrl, fileName, ...lesson }) => {
          const playback: Lesson['playback'] = fileName ? { kind: 'video', url: `/api/lessons/${lesson.id}/video` } : videoPlayback(sourceUrl);
          if (playback.provider === 'microsoft') playback.url = `/api/lessons/${lesson.id}/video`;
          if (!includeSources) delete playback.source;
          return { ...lesson, mediaKey: videoSourceKey(sourceUrl, fileName), playback };
        }),
    }))),
    resources: links.filter(link => link.kind === 'resource').map(({ id, title, url }) => ({ id, title, url })),
    sessions: [],
    assessmentAvailable: Boolean(await db.prepare('SELECT 1 FROM assessments WHERE course_id = ?').get(course.id)),
  };
}

export async function enrollments(db: Database, studentId?: string): Promise<Enrollment[]> {
  const filter = studentId ? 'WHERE e.account_id = ?' : '';
  const rows = await db.prepare(`SELECT ${enrollmentFields} ${enrollmentJoin} ${filter} ORDER BY e.submitted_at DESC`)
    .all(...(studentId ? [studentId] : [])) as unknown as Enrollment[];
  return rows.map(row => ({ ...row, accessPaused: Boolean(row.accessPaused), coursePaused: Boolean(row.coursePaused) }));
}

export async function enrollmentById(db: Database, id: string): Promise<Enrollment> {
  const row = await db.prepare(`SELECT ${enrollmentFields} ${enrollmentJoin} WHERE e.id = ?`).get(id) as unknown as Enrollment | undefined;
  if (!row) throw notFound('This enrollment is unavailable.');
  return { ...row, accessPaused: Boolean(row.accessPaused), coursePaused: Boolean(row.coursePaused) };
}

type ReceiptRow = Omit<Receipt, 'number'> & { sequence: number };
function receiptNumber({ sequence, ...row }: ReceiptRow): Receipt {
  return { ...row, number: `PBS-${row.issuedAt.slice(0, 4)}-${String(sequence).padStart(6, '0')}` };
}

export async function receipts(db: Database, studentId?: string): Promise<Receipt[]> {
  const filter = studentId ? 'WHERE e.account_id = ?' : '';
  return (await db.prepare(`SELECT ${receiptFields} ${receiptJoin} ${filter} ORDER BY r.sequence DESC`)
    .all(...(studentId ? [studentId] : [])) as unknown as ReceiptRow[]).map(receiptNumber);
}

export async function checkReference(db: Database, reference: string, enrollmentId: string) {
  if (!reference) return;
  const reserved = await db.prepare(`SELECT id FROM enrollments
    WHERE reference = ? COLLATE NOCASE AND id <> ? AND status <> 'rejected'`).get(reference, enrollmentId);
  const used = await db.prepare('SELECT id FROM receipts WHERE reference = ? COLLATE NOCASE AND enrollment_id <> ?').get(reference, enrollmentId);
  if (reserved || used) throw conflict('This payment reference is already assigned to another enrollment.');
}

export async function issueReceipt(db: Database, enrollmentId: string, amount: number, method: string, reference: string, adminId: string | null, issuedAt = now()) {
  const enrollment = await enrollmentById(db, enrollmentId);
  if (enrollment.status !== 'approved') throw conflict('Approve the enrollment before recording payment.');
  const prior = reference ? await db.prepare(`SELECT ${receiptFields} ${receiptJoin} WHERE r.reference = ? COLLATE NOCASE`)
    .get(reference) as unknown as ReceiptRow | undefined : undefined;
  if (prior) {
    if (prior.enrollmentId === enrollmentId && prior.amount === amount && prior.method === method) return receiptNumber(prior);
    throw conflict('This payment reference has already been recorded.');
  }
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > enrollment.total - enrollment.paid) {
    throw badRequest('The payment must be greater than zero and within the outstanding balance.');
  }
  await checkReference(db, reference, enrollmentId);
  const id = makeId();
  await db.prepare(`INSERT INTO receipts (id, enrollment_id, amount, method, reference, issued_at, issued_by, student_name, course_title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, enrollmentId, amount, method, reference, issuedAt, adminId, enrollment.studentName, enrollment.courseTitle);
  const due = await db.prepare('SELECT due_date FROM enrollment_details WHERE enrollment_id = ?').get(enrollmentId);
  await db.prepare('INSERT INTO receipt_balances VALUES (?, ?, ?, ?, ?)')
    .run(id, enrollment.total, enrollment.paid + amount, enrollment.total - enrollment.paid - amount, String(due?.due_date || ''));
  await audit(db, adminId || 'PBS', 'Payment verified', enrollmentId, `${enrollment.studentName} · INR ${(amount / 100).toFixed(2)} · ${method}`);
  return receiptNumber(await db.prepare(`SELECT ${receiptFields} ${receiptJoin} WHERE r.id = ?`).get(id) as unknown as ReceiptRow);
}

export async function assignments(db: Database, studentId?: string): Promise<Assignment[]> {
  return await db.prepare(`SELECT x.id, a.id AS studentId, a.name AS studentName, c.id AS courseId, c.title AS courseTitle,
    x.url, x.note, x.feedback, x.submitted_at AS submittedAt, x.reviewed_at AS reviewedAt
    FROM assignments x JOIN accounts a ON a.id = x.account_id JOIN courses c ON c.id = x.course_id
    ${studentId ? 'WHERE x.account_id = ?' : ''} ORDER BY x.submitted_at DESC`)
    .all(...(studentId ? [studentId] : [])) as unknown as Assignment[];
}

export async function messages(db: Database, studentId?: string): Promise<Message[]> {
  return await db.prepare(`SELECT m.id, a.id AS studentId, a.name AS studentName, m.sender, m.subject, m.body,
    m.sent_at AS sentAt FROM messages m JOIN accounts a ON a.id = m.account_id
    ${studentId ? 'WHERE m.account_id = ?' : ''} ORDER BY m.sent_at DESC`)
    .all(...(studentId ? [studentId] : [])) as unknown as Message[];
}

export async function portfolio(db: Database, studentId: string): Promise<Portfolio> {
  const row = await db.prepare('SELECT headline, bio, project_url AS projectUrl, published FROM portfolios WHERE account_id = ?')
    .get(studentId) as unknown as Portfolio | undefined;
  const links = await db.prepare('SELECT linkedin, github, website FROM portfolio_links WHERE account_id = ?').get(studentId);
  return { ...(row ? { ...row, published: Boolean(row.published) } : { headline: '', bio: '', projectUrl: '', published: false }),
    linkedin: String(links?.linkedin || ''), github: String(links?.github || ''), website: String(links?.website || '') };
}

export async function studentWorkspace(db: Database, account: Account) {
  const list = await enrollments(db, account.id);
  return {
    enrollments: list,
    live: await studentLiveData(db, account.id),
    courses: await Promise.all(list.filter(enrollment => enrollment.status === 'approved' && !enrollment.accessPaused && !enrollment.coursePaused)
      .map(async enrollment => courseDetails(db, await courseById(db, enrollment.courseId)))),
    receipts: await receipts(db, account.id),
    completions: await db.prepare(`SELECT m.course_id AS courseId, p.lesson_id AS lessonId FROM completions p
      JOIN lessons l ON l.id = p.lesson_id JOIN modules m ON m.id = l.module_id
      WHERE p.account_id = ?`).all(account.id) as unknown as Completion[],
    assignments: await assignments(db, account.id),
    messages: await messages(db, account.id),
    assessmentResults: (await db.prepare(`SELECT course_id AS courseId, score, passed, submitted_at AS submittedAt
      FROM assessment_results WHERE account_id = ?`).all(account.id) as unknown as AssessmentResult[])
      .map(result => ({ ...result, passed: Boolean(result.passed) })),
    portfolio: await portfolio(db, account.id),
  };
}

export async function adminWorkspace(db: Database) {
  const enrollmentList = await enrollments(db);
  const receiptList = await receipts(db);
  const liveTotals = await db.prepare("SELECT account_id, SUM(awarded_points) AS points, SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS attended FROM live_attendance GROUP BY account_id").all();
  const accountRows = await db.prepare(`SELECT ${accountFields} FROM accounts WHERE role = 'student' ORDER BY created_at DESC`).all();
  const students: StudentRecord[] = await Promise.all(accountRows.map(async raw => {
    const account = publicAccount(raw as unknown as Parameters<typeof publicAccount>[0]);
    const placement = await db.prepare('SELECT status, target_role AS targetRole, notes FROM placements WHERE account_id = ?')
      .get(account.id) as StudentRecord['placement'];
    const progress = await db.prepare('SELECT COUNT(*) AS count FROM completions WHERE account_id = ?').get(account.id);
    return {
      ...account,
      enrollments: enrollmentList.filter(enrollment => enrollment.studentId === account.id),
      receipts: receiptList.filter(receipt => receipt.studentId === account.id),
      completedLessons: Number(progress?.count ?? 0),
      livePoints: Number(liveTotals.find(item => item.account_id === account.id)?.points || 0),
      attendedSessions: Number(liveTotals.find(item => item.account_id === account.id)?.attended || 0),
      placement,
    };
  }));
  return {
    students,
    courses: await Promise.all((await courses(db)).map(course => courseDetails(db, course, true))),
    enrollments: enrollmentList,
    receipts: receiptList,
    assignments: await assignments(db),
    messages: await messages(db),
  };
}

export async function hasCourseAccess(db: Database, account: Pick<Account, 'id' | 'role'>, courseId: string) {
  return account.role === 'admin' || activeCourseAccess(db, account.id, courseId);
}

export async function getAssessment(db: Database, courseId: string) {
  const row = await db.prepare('SELECT questions, passing_score AS passingScore FROM assessments WHERE course_id = ?')
    .get(courseId) as { questions: string; passingScore: number } | undefined;
  if (!row) throw notFound('This course has no published assessment.');
  return { questions: JSON.parse(row.questions) as AssessmentQuestion[], passingScore: row.passingScore };
}

export async function requireCompletedLessons(db: Database, accountId: string, courseId: string) {
  const stats = await db.prepare(`SELECT COUNT(*) AS total, COUNT(p.lesson_id) AS done
    FROM lessons l JOIN modules m ON m.id = l.module_id
    LEFT JOIN completions p ON p.lesson_id = l.id AND p.account_id = ? WHERE m.course_id = ?`).get(accountId, courseId);
  if (!Number(stats?.total) || stats?.done !== stats?.total) throw conflict('Complete every lesson to open the assessment.');
}
