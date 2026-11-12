import type {
  Account, AssessmentQuestion, AssessmentResult, Assignment, Completion, Course, CourseSummary,
  Enrollment, Message, Portfolio, Receipt, StudentRecord
} from '../src/live/types';
import { accountFields, publicAccount } from './auth';
import { type Database, makeId, now } from './database';
import { conflict, notFound, badRequest } from './http';
import { videoPlayback } from './video';

const courseFields = `id, title, description, category, instructor, schedule, fee, published`;
const enrollmentFields = `e.id, e.account_id AS studentId, a.name AS studentName, a.email,
  e.course_id AS courseId, c.title AS courseTitle, e.status, e.total, e.requested_payment AS requestedPayment,
  e.reference, e.submitted_at AS submittedAt, e.approved_at AS approvedAt, e.notes,
  COALESCE((SELECT SUM(r.amount) FROM receipts r WHERE r.enrollment_id = e.id), 0) AS paid`;
const enrollmentJoin = `FROM enrollments e JOIN accounts a ON a.id = e.account_id JOIN courses c ON c.id = e.course_id`;
const receiptFields = `r.id, r.sequence, e.account_id AS studentId,
  COALESCE(NULLIF(r.student_name, ''), a.name) AS studentName, COALESCE(NULLIF(r.course_title, ''), c.title) AS courseTitle,
  r.enrollment_id AS enrollmentId, r.amount, r.method, r.reference, r.issued_at AS issuedAt`;
const receiptJoin = `FROM receipts r JOIN enrollments e ON e.id = r.enrollment_id
  JOIN accounts a ON a.id = e.account_id JOIN courses c ON c.id = e.course_id`;

export function courses(db: Database, publishedOnly = false): CourseSummary[] {
  const rows = db.prepare(`SELECT ${courseFields} FROM courses ${publishedOnly ? 'WHERE published = 1' : ''} ORDER BY created_at DESC`).all();
  return (rows as unknown as CourseSummary[]).map(row => ({ ...row, published: Boolean(row.published) }));
}

export function courseById(db: Database, id: string) {
  const row = db.prepare(`SELECT ${courseFields} FROM courses WHERE id = ?`).get(id) as unknown as CourseSummary | undefined;
  if (!row) throw notFound('This course is unavailable.');
  return { ...row, published: Boolean(row.published) };
}

type LessonRow = { id: string; title: string; duration: string; description: string; sourceUrl: string; fileName: string };

export function courseDetails(db: Database, course: CourseSummary): Course {
  const modules = db.prepare('SELECT id, title FROM modules WHERE course_id = ? ORDER BY position').all(course.id) as { id: string; title: string }[];
  const links = db.prepare('SELECT id, kind, title, url, starts_at AS startsAt FROM course_links WHERE course_id = ? ORDER BY starts_at, title')
    .all(course.id) as { id: string; kind: 'resource' | 'session'; title: string; url: string; startsAt: string }[];
  return {
    ...course,
    modules: modules.map(module => ({
      ...module,
      lessons: (db.prepare(`SELECT id, title, duration, description, source_url AS sourceUrl, file_name AS fileName
        FROM lessons WHERE module_id = ? ORDER BY position`).all(module.id) as LessonRow[])
        .map(({ sourceUrl, fileName, ...lesson }) => ({
          ...lesson,
          playback: fileName ? { kind: 'video', url: `/api/lessons/${lesson.id}/video` } : videoPlayback(sourceUrl),
        })),
    })),
    resources: links.filter(link => link.kind === 'resource').map(({ id, title, url }) => ({ id, title, url })),
    sessions: links.filter(link => link.kind === 'session').map(({ id, title, url, startsAt }) => ({ id, title, url, startsAt })),
    assessmentAvailable: Boolean(db.prepare('SELECT 1 FROM assessments WHERE course_id = ?').get(course.id)),
  };
}

export function enrollments(db: Database, studentId?: string): Enrollment[] {
  const filter = studentId ? 'WHERE e.account_id = ?' : '';
  return db.prepare(`SELECT ${enrollmentFields} ${enrollmentJoin} ${filter} ORDER BY e.submitted_at DESC`)
    .all(...(studentId ? [studentId] : [])) as unknown as Enrollment[];
}

export function enrollmentById(db: Database, id: string): Enrollment {
  const row = db.prepare(`SELECT ${enrollmentFields} ${enrollmentJoin} WHERE e.id = ?`).get(id) as unknown as Enrollment | undefined;
  if (!row) throw notFound('This enrollment is unavailable.');
  return row;
}

type ReceiptRow = Omit<Receipt, 'number'> & { sequence: number };
function receiptNumber({ sequence, ...row }: ReceiptRow): Receipt {
  return { ...row, number: `PBS-${row.issuedAt.slice(0, 4)}-${String(sequence).padStart(6, '0')}` };
}

export function receipts(db: Database, studentId?: string): Receipt[] {
  const filter = studentId ? 'WHERE e.account_id = ?' : '';
  return (db.prepare(`SELECT ${receiptFields} ${receiptJoin} ${filter} ORDER BY r.sequence DESC`)
    .all(...(studentId ? [studentId] : [])) as unknown as ReceiptRow[]).map(receiptNumber);
}

export function checkReference(db: Database, reference: string, enrollmentId: string) {
  if (!reference) return;
  const reserved = db.prepare(`SELECT id FROM enrollments
    WHERE reference = ? COLLATE NOCASE AND id <> ? AND status <> 'rejected'`).get(reference, enrollmentId);
  const used = db.prepare('SELECT id FROM receipts WHERE reference = ? COLLATE NOCASE AND enrollment_id <> ?').get(reference, enrollmentId);
  if (reserved || used) throw conflict('This payment reference is already assigned to another enrollment.');
}

export function issueReceipt(db: Database, enrollmentId: string, amount: number, method: string, reference: string, adminId: string | null, issuedAt = now()) {
  const enrollment = enrollmentById(db, enrollmentId);
  if (enrollment.status !== 'approved') throw conflict('Approve the enrollment before recording payment.');
  const prior = reference ? db.prepare(`SELECT ${receiptFields} ${receiptJoin} WHERE r.reference = ? COLLATE NOCASE`)
    .get(reference) as unknown as ReceiptRow | undefined : undefined;
  if (prior) {
    if (prior.enrollmentId === enrollmentId && prior.amount === amount && prior.method === method) return receiptNumber(prior);
    throw conflict('This payment reference has already been recorded.');
  }
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > enrollment.total - enrollment.paid) {
    throw badRequest('The payment must be greater than zero and within the outstanding balance.');
  }
  checkReference(db, reference, enrollmentId);
  const id = makeId();
  db.prepare(`INSERT INTO receipts (id, enrollment_id, amount, method, reference, issued_at, issued_by, student_name, course_title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, enrollmentId, amount, method, reference, issuedAt, adminId, enrollment.studentName, enrollment.courseTitle);
  return receiptNumber(db.prepare(`SELECT ${receiptFields} ${receiptJoin} WHERE r.id = ?`).get(id) as unknown as ReceiptRow);
}

export function assignments(db: Database, studentId?: string): Assignment[] {
  return db.prepare(`SELECT x.id, a.id AS studentId, a.name AS studentName, c.id AS courseId, c.title AS courseTitle,
    x.url, x.note, x.feedback, x.submitted_at AS submittedAt, x.reviewed_at AS reviewedAt
    FROM assignments x JOIN accounts a ON a.id = x.account_id JOIN courses c ON c.id = x.course_id
    ${studentId ? 'WHERE x.account_id = ?' : ''} ORDER BY x.submitted_at DESC`)
    .all(...(studentId ? [studentId] : [])) as unknown as Assignment[];
}

export function messages(db: Database, studentId?: string): Message[] {
  return db.prepare(`SELECT m.id, a.id AS studentId, a.name AS studentName, m.sender, m.subject, m.body,
    m.sent_at AS sentAt FROM messages m JOIN accounts a ON a.id = m.account_id
    ${studentId ? 'WHERE m.account_id = ?' : ''} ORDER BY m.sent_at DESC`)
    .all(...(studentId ? [studentId] : [])) as unknown as Message[];
}

export function portfolio(db: Database, studentId: string): Portfolio {
  const row = db.prepare('SELECT headline, bio, project_url AS projectUrl, published FROM portfolios WHERE account_id = ?')
    .get(studentId) as unknown as Portfolio | undefined;
  return row ? { ...row, published: Boolean(row.published) } : { headline: '', bio: '', projectUrl: '', published: false };
}

export function studentWorkspace(db: Database, account: Account) {
  const list = enrollments(db, account.id);
  return {
    enrollments: list,
    courses: list.filter(enrollment => enrollment.status === 'approved')
      .map(enrollment => courseDetails(db, courseById(db, enrollment.courseId))),
    receipts: receipts(db, account.id),
    completions: db.prepare(`SELECT m.course_id AS courseId, p.lesson_id AS lessonId FROM completions p
      JOIN lessons l ON l.id = p.lesson_id JOIN modules m ON m.id = l.module_id
      WHERE p.account_id = ?`).all(account.id) as unknown as Completion[],
    assignments: assignments(db, account.id),
    messages: messages(db, account.id),
    assessmentResults: (db.prepare(`SELECT course_id AS courseId, score, passed, submitted_at AS submittedAt
      FROM assessment_results WHERE account_id = ?`).all(account.id) as unknown as AssessmentResult[])
      .map(result => ({ ...result, passed: Boolean(result.passed) })),
    portfolio: portfolio(db, account.id),
  };
}

export function adminWorkspace(db: Database) {
  const enrollmentList = enrollments(db);
  const receiptList = receipts(db);
  const accountRows = db.prepare(`SELECT ${accountFields} FROM accounts WHERE role = 'student' ORDER BY created_at DESC`).all();
  const students: StudentRecord[] = accountRows.map(raw => {
    const account = publicAccount(raw as unknown as Parameters<typeof publicAccount>[0]);
    const placement = db.prepare('SELECT status, target_role AS targetRole, notes FROM placements WHERE account_id = ?')
      .get(account.id) as StudentRecord['placement'];
    const progress = db.prepare('SELECT COUNT(*) AS count FROM completions WHERE account_id = ?').get(account.id);
    return {
      ...account,
      enrollments: enrollmentList.filter(enrollment => enrollment.studentId === account.id),
      receipts: receiptList.filter(receipt => receipt.studentId === account.id),
      completedLessons: Number(progress?.count ?? 0),
      placement,
    };
  });
  return {
    students,
    courses: courses(db).map(course => courseDetails(db, course)),
    enrollments: enrollmentList,
    receipts: receiptList,
    assignments: assignments(db),
    messages: messages(db),
  };
}

export function hasCourseAccess(db: Database, account: Pick<Account, 'id' | 'role'>, courseId: string) {
  return account.role === 'admin' || Boolean(db.prepare(`SELECT 1 FROM enrollments
    WHERE account_id = ? AND course_id = ? AND status = 'approved'`).get(account.id, courseId));
}

export function getAssessment(db: Database, courseId: string) {
  const row = db.prepare('SELECT questions, passing_score AS passingScore FROM assessments WHERE course_id = ?')
    .get(courseId) as { questions: string; passingScore: number } | undefined;
  if (!row) throw notFound('This course has no published assessment.');
  return { questions: JSON.parse(row.questions) as AssessmentQuestion[], passingScore: row.passingScore };
}

export function requireCompletedLessons(db: Database, accountId: string, courseId: string) {
  const stats = db.prepare(`SELECT COUNT(*) AS total, COUNT(p.lesson_id) AS done
    FROM lessons l JOIN modules m ON m.id = l.module_id
    LEFT JOIN completions p ON p.lesson_id = l.id AND p.account_id = ? WHERE m.course_id = ?`).get(accountId, courseId);
  if (!Number(stats?.total) || stats?.done !== stats?.total) throw conflict('Complete every lesson to open the assessment.');
}
