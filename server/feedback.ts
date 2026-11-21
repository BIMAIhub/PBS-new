import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, now, transaction } from './database.js';
import { audit, saveSetting, setting } from './academy-data.js';
import { badRequest, conflict, field, integer, limitAttempts, notFound, route } from './http.js';
import type { CourseFeedback, LearnerCommunity, PublicFeedback } from '../src/live/admissions-types.js';

const fields = `f.id, f.course_id AS courseId, c.title AS courseTitle, f.student_name AS studentName,
  f.qualification, f.photo AS photoDataUrl, f.completed_at AS completedAt, f.placed, f.company,
  f.course_rating AS courseRating, f.website_rating AS websiteRating, f.body, f.website_feedback AS websiteFeedback,
  f.consent, f.status, f.reply, f.submitted_at AS submittedAt, f.reviewed_at AS reviewedAt, f.revision`;
const shape = (row: Record<string, unknown>) => ({ ...row, placed: Boolean(row.placed), consent: Boolean(row.consent) }) as unknown as CourseFeedback;

export async function completedFeedbackCourses(db: Database, studentId: string) {
  return await db.prepare(`SELECT c.id AS courseId, c.title AS courseTitle, COALESCE(ct.issued_at, ar.submitted_at) AS completedAt
    FROM enrollments e JOIN courses c ON c.id = e.course_id
    LEFT JOIN certificates ct ON ct.account_id = e.account_id AND ct.course_id = e.course_id
    LEFT JOIN assessment_results ar ON ar.account_id = e.account_id AND ar.course_id = e.course_id
    WHERE e.account_id = ? AND e.status = 'approved' AND (ct.id IS NULL OR ct.revoked_at = '')
    AND ((ct.id IS NOT NULL AND ct.revoked_at = '') OR (ar.passed = 1
      AND EXISTS (SELECT 1 FROM lessons l JOIN modules m ON m.id = l.module_id WHERE m.course_id = e.course_id)
      AND NOT EXISTS (SELECT 1 FROM lessons l JOIN modules m ON m.id = l.module_id WHERE m.course_id = e.course_id
        AND NOT EXISTS (SELECT 1 FROM completions x WHERE x.account_id = e.account_id AND x.lesson_id = l.id))))
    ORDER BY completedAt DESC`).all(studentId) as unknown as { courseId: string; courseTitle: string; completedAt: string }[];
}

export async function learnerCommunity(db: Database): Promise<LearnerCommunity> {
  const raw = await setting(db, 'learner_community');
  const saved = raw ? JSON.parse(raw) : { historicalLearners: 25, placementAssistance: true, placementNote: 'Portfolio, CV and interview guidance. Placement assistance does not guarantee a job.' };
  const row = await db.prepare("SELECT COUNT(DISTINCT e.account_id) AS learners, COUNT(*) AS enrollments FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.status = 'approved' AND c.published = 1").get();
  return { historicalLearners: Number(saved.historicalLearners), placementAssistance: Boolean(saved.placementAssistance), placementNote: String(saved.placementNote),
    approvedLearners: Number(row?.learners || 0), approvedEnrollments: Number(row?.enrollments || 0) };
}
export async function enrollmentCounts(db: Database) {
  const rows = await db.prepare("SELECT course_id, COUNT(*) AS total FROM enrollments WHERE status = 'approved' GROUP BY course_id").all();
  return new Map(rows.map(row => [String(row.course_id), Number(row.total)]));
}
export async function publishedFeedback(db: Database, courseId = ''): Promise<PublicFeedback[]> {
  const rows = await db.prepare(`SELECT ${fields} FROM course_feedback f JOIN courses c ON c.id = f.course_id
    WHERE f.status = 'published' AND f.consent = 1 AND c.published = 1 ${courseId ? 'AND f.course_id = ?' : ''}
    AND EXISTS (SELECT 1 FROM enrollments e WHERE e.account_id = f.account_id AND e.course_id = f.course_id AND e.status = 'approved')
    AND NOT EXISTS (SELECT 1 FROM certificates ct WHERE ct.account_id = f.account_id AND ct.course_id = f.course_id AND ct.revoked_at <> '')
    ORDER BY f.reviewed_at DESC LIMIT 12`).all(...(courseId ? [courseId] : []));
  return rows.map(row => {
    const item = shape(row);
    return { id: item.id, courseId: item.courseId, courseTitle: item.courseTitle, studentName: item.studentName, qualification: item.qualification,
      photoDataUrl: item.photoDataUrl, completedAt: item.completedAt, placed: item.placed, company: item.company, courseRating: item.courseRating, body: item.body, reply: item.reply };
  });
}
function photo(input: unknown) {
  const text = field(input, 'student photo', 170_000);
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(text);
  if (!match) throw badRequest('Upload a student photo using the photo picker.');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length < 100 || bytes.length > 120_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw badRequest('Choose a valid student photo smaller than 120 KB after resizing.');
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

export function mountFeedback(app: Express, db: WritableDatabase, hosted: boolean) {
  app.get('/api/student/feedback', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    res.json({ feedback: (await db.prepare(`SELECT ${fields} FROM course_feedback f JOIN courses c ON c.id = f.course_id WHERE f.account_id = ? ORDER BY f.submitted_at DESC`).all(account.id)).map(shape),
      eligible: await completedFeedbackCourses(db, account.id) });
  }));
  app.post('/api/student/feedback', limitAttempts(10, hosted ? db : undefined), route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    const courseId = field(req.body?.courseId, 'completed course', 80), qualification = field(req.body?.qualification, 'qualification', 160);
    const image = photo(req.body?.photoDataUrl), body = field(req.body?.body, 'course feedback', 2000);
    const websiteFeedback = field(req.body?.websiteFeedback, 'website feedback', 2000, false);
    const courseRating = integer(req.body?.courseRating, 'course rating', 1, 5), websiteRating = integer(req.body?.websiteRating, 'website rating', 1, 5);
    const placed = req.body?.placed === true, company = placed ? field(req.body?.company, 'placement company', 160) : '';
    const consent = req.body?.consent === true;
    await transaction(db, async tx => {
      const complete = (await completedFeedbackCourses(tx, account.id)).find(item => item.courseId === courseId);
      if (!complete) throw conflict('Complete the course lessons and pass the assessment before sharing your course feedback.');
      const prior = await tx.prepare('SELECT id, revision FROM course_feedback WHERE account_id = ? AND course_id = ?').get(account.id, courseId);
      if (prior && req.body?.revision !== prior.revision) throw conflict('Your review changed. Refresh before editing it.');
      const date = now(), revision = makeId();
      await tx.prepare(`INSERT INTO course_feedback (id, account_id, course_id, student_name, qualification, photo, completed_at, placed, company,
        course_rating, website_rating, body, website_feedback, consent, submitted_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, course_id) DO UPDATE SET student_name = excluded.student_name, qualification = excluded.qualification, photo = excluded.photo,
        completed_at = excluded.completed_at, placed = excluded.placed, company = excluded.company, course_rating = excluded.course_rating,
        website_rating = excluded.website_rating, body = excluded.body, website_feedback = excluded.website_feedback, consent = excluded.consent,
        status = 'pending', reply = '', reviewed_at = '', submitted_at = excluded.submitted_at, revision = excluded.revision`)
        .run(prior?.id || makeId(), account.id, courseId, account.name, qualification, image, complete.completedAt, Number(placed), company, courseRating, websiteRating, body, websiteFeedback, Number(consent), date, revision);
      await audit(tx, account.id, 'Course feedback submitted', courseId, 'Awaiting admin review.');
    });
    res.status(201).json({ status: 'pending' });
  }));
  app.post('/api/student/feedback/:id/withdraw', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    const result = await db.prepare("UPDATE course_feedback SET consent = 0, status = 'private', revision = ? WHERE id = ? AND account_id = ?").run(makeId(), req.params.id, account.id);
    if (!result.changes) throw notFound('This review is unavailable.');
    res.status(204).end();
  }));
  app.get('/api/admin/feedback', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const cursor = field(req.query.cursor, 'feedback page', 160, false), parts = cursor.split('~');
    if (cursor && (parts.length !== 2 || !/^[a-f\d-]{36}$/i.test(parts[1]) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parts[0]) || !Number.isFinite(Date.parse(parts[0])))) throw badRequest('Choose a valid feedback page.');
    const rows = (await db.prepare(`SELECT ${fields} FROM course_feedback f JOIN courses c ON c.id = f.course_id
      ${cursor ? 'WHERE f.submitted_at < ? OR (f.submitted_at = ? AND f.id < ?)' : ''}
      ORDER BY f.submitted_at DESC, f.id DESC LIMIT 21`).all(...(cursor ? [parts[0], parts[0], parts[1]] : []))).map(shape);
    const page = rows.slice(0, 20), last = page.at(-1);
    res.json({ feedback: page, nextCursor: rows.length > 20 && last ? `${last.submittedAt}~${last.id}` : '', community: await learnerCommunity(db) });
  }));
  app.patch('/api/admin/feedback/:id', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const status = field(req.body?.status, 'review visibility', 20), reply = field(req.body?.reply, 'reply', 1500, false);
    if (!['pending', 'private', 'published'].includes(status)) throw badRequest('Choose a review visibility.');
    await transaction(db, async tx => {
      const review = await tx.prepare('SELECT * FROM course_feedback WHERE id = ?').get(req.params.id);
      if (!review) throw notFound('This review is unavailable.');
      if (req.body?.revision !== review.revision) throw conflict('The student updated this review. Refresh and review the latest version.');
      if (status === 'published' && (!review.consent || req.body?.verified !== true)) throw conflict('Publication requires student consent and admin verification of the review details.');
      if (status === 'published' && !(await completedFeedbackCourses(tx, String(review.account_id))).some(course => course.courseId === review.course_id)) throw conflict('This course no longer has an eligible completed enrollment. Keep this review private.');
      await tx.prepare('UPDATE course_feedback SET status = ?, reply = ?, reviewed_at = ?, revision = ? WHERE id = ?').run(status, reply, now(), makeId(), req.params.id);
      await audit(tx, admin.id, 'Student feedback reviewed', req.params.id, status);
    });
    res.status(204).end();
  }));
  app.put('/api/admin/learner-community', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const historicalLearners = integer(req.body?.historicalLearners, 'historical learner count', 0, 100000);
    const placementAssistance = req.body?.placementAssistance === true;
    const placementNote = field(req.body?.placementNote, 'placement assistance details', 500, placementAssistance);
    await transaction(db, async tx => {
      await saveSetting(tx, 'learner_community', JSON.stringify({ historicalLearners, placementAssistance, placementNote }));
      await audit(tx, admin.id, 'Public learner information updated', '', `${historicalLearners} historical learners; live enrollments remain database counts.`);
    });
    res.status(204).end();
  }));
}
