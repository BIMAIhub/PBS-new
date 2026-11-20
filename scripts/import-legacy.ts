import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { openDatabase, now, transaction } from '../server/database.js';
import { issueReceipt } from '../server/records.js';
import { videoPlayback } from '../server/video.js';
import { paymentReference } from '../server/inputs.js';

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown) => Array.isArray(value) ? value.map(row) : [];
const text = (value: unknown, length = 160) => typeof value === 'string' ? value.trim().slice(0, length) : '';
const paise = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : 0;
const date = (value: unknown) => {
  const time = Date.parse(text(value, 64));
  return Number.isFinite(time) ? new Date(time).toISOString() : now();
};
function stableId(kind: string, input: string) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(input) ? input : `legacy-${kind}-${createHash('sha256').update(input).digest('hex').slice(0, 20)}`;
}
function legacyReference(value: unknown) {
  try { return paymentReference(value); } catch { return ''; }
}

async function main() {
  const { values } = parseArgs({ options: { file: { type: 'string' } } });
  if (!values.file) throw new Error('Pass the path to a reviewed legacy backup with --file.');
  const parsed = row(JSON.parse(readFileSync(values.file, 'utf8')));
  if (!Array.isArray(parsed.students) && !Array.isArray(parsed.courses)) throw new Error('The backup must contain students or courses.');
  const db = await openDatabase();
  try {
    const result = await transaction(db, async tx => {
      const courseIds = new Map<string, string>();
      const accountIds = new Map<string, string>();
      let students = 0;
      let courses = 0;
      let lessons = 0;
      let enrollments = 0;
      let receipts = 0;
      let skipped = 0;

      for (const course of rows(parsed.courses)) {
        const title = text(course.title);
        const originalId = text(course.id, 200);
        if (!title || !originalId) continue;
        const id = stableId('course', originalId);
        courseIds.set(originalId, id);
        courses += Number((await tx.prepare('INSERT OR IGNORE INTO courses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, title, text(course.description, 3000), text(course.category, 80) || 'BIM',
            text(course.instructor, 120), text(course.batchSchedule), paise(course.totalFee), Number(course.isPublished === true), date(course.createdDate))).changes);
        for (const [index, module] of rows(course.modules).entries()) {
          const moduleId = stableId('module', `${originalId}/${text(module.id) || index}`);
          await tx.prepare('INSERT OR IGNORE INTO modules VALUES (?, ?, ?, ?)').run(moduleId, id, text(module.title) || `Module ${index + 1}`, index + 1);
          for (const [position, lesson] of rows(module.lessons).entries()) {
            const title = text(lesson.title);
            const source = text(lesson.videoUrl, 2048);
            if (!title || !source) continue;
            try { videoPlayback(source); } catch { skipped++; continue; }
            const lessonId = stableId('lesson', `${moduleId}/${text(lesson.id) || position}`);
            lessons += Number((await tx.prepare(`INSERT OR IGNORE INTO lessons (id, module_id, title, duration, description, source_url, position)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
              .run(lessonId, moduleId, title, text(lesson.duration, 40), text(lesson.description, 3000), source, position + 1)).changes);
          }
        }
      }

      for (const student of rows(parsed.students)) {
        const email = text(student.email, 254).toLowerCase();
        const name = text(student.name, 120);
        if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /@(?:example\.(?:com|test|org|net)|[^@]+\.test)$/i.test(email) ||
            /^demo (?:student|learner)$/i.test(name)) {
          skipped++;
          continue;
        }
        const originalId = text(student.studentId || student.id, 200);
        let id = stableId('student', originalId || email);
        const prior = await tx.prepare('SELECT id, role FROM accounts WHERE email = ?').get(email) as { id: string; role: string } | undefined;
        if (prior?.role === 'admin') { skipped++; continue; }
        if (prior) id = prior.id;
        else {
          const collision = await tx.prepare('SELECT id FROM accounts WHERE id = ?').get(id);
          if (collision) id = stableId('student', `${originalId}/${email}`);
          const roll = text(student.rollNumber, 60) || id;
          const rollTaken = await tx.prepare('SELECT id FROM accounts WHERE roll_number = ?').get(roll);
          await tx.prepare(`INSERT INTO accounts (id, role, name, email, phone, roll_number, password_hash, must_change, created_at)
            VALUES (?, 'student', ?, ?, ?, ?, '', 1, ?)`)
            .run(id, name, email, text(student.phone, 32), rollTaken ? id : roll, date(student.registrationDate));
          students++;
        }
        if (originalId) accountIds.set(originalId, id);
        accountIds.set(email, id);
      }

      const insertEnrollment = tx.prepare(`INSERT OR IGNORE INTO enrollments
        (id, account_id, course_id, total, status, requested_payment, reference, submitted_at, approved_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const record of rows(parsed.enrollments)) {
        const studentId = accountIds.get(text(record.studentEmail, 254).toLowerCase()) || accountIds.get(text(record.studentId, 200));
        const courseId = courseIds.get(text(record.courseId, 200));
        if (!studentId || !courseId) continue;
        const status = record.status === 'Approved & Assigned' ? 'approved' : record.status === 'Rejected' ? 'rejected' : 'pending';
        const id = stableId('enrollment', `${studentId}/${courseId}`);
        const fee = await tx.prepare('SELECT fee FROM courses WHERE id = ?').get(courseId);
        const total = typeof record.totalFee === 'number' ? paise(record.totalFee) : Number(fee?.fee || 0);
        const amount = paise(record.amountPaid);
        const reference = legacyReference(record.transactionId);
        const pending = status === 'pending' && reference && amount <= total ? amount : 0;
        const { changes: changed } = await insertEnrollment.run(id, studentId, courseId, total, status, pending, pending ? reference : '',
          date(record.submittedAt), status === 'approved' ? date(record.verifiedAt || record.submittedAt) : '', text(record.adminNotes, 1000));
        enrollments += Number(changed);
        if (changed && status === 'approved' && record.verifiedAt && reference && amount > 0 && amount <= total) {
          const existing = await tx.prepare('SELECT id FROM receipts WHERE reference = ? COLLATE NOCASE').get(reference);
          const reserved = await tx.prepare("SELECT id FROM enrollments WHERE reference = ? COLLATE NOCASE AND status <> 'rejected'").get(reference);
          if (!existing && !reserved) {
            await issueReceipt(tx, id, amount, text(record.paymentMethod, 60) || 'Legacy payment', reference, null, date(record.verifiedAt));
            receipts++;
          } else skipped++;
        }
      }
      for (const record of rows(parsed.students)) {
        const studentId = accountIds.get(text(record.email, 254).toLowerCase());
        if (!studentId || !Array.isArray(record.enrolledCourseIds)) continue;
        for (const input of record.enrolledCourseIds) {
          const courseId = courseIds.get(text(input, 200));
          if (!courseId) continue;
          const fee = await tx.prepare('SELECT fee FROM courses WHERE id = ?').get(courseId);
          const created = date(record.registrationDate);
          const result = await insertEnrollment.run(stableId('enrollment', `${studentId}/${courseId}`), studentId,
            courseId, Number(fee?.fee || 0), 'approved', 0, '', created, created, '');
          enrollments += Number(result.changes);
        }
      }
      return { students, courses, lessons, enrollments, receipts, skipped };
    });
    console.log(JSON.stringify(result));
    console.log('Reset imported student passwords from the student roster before sharing access.');
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Import failed.');
  process.exitCode = 1;
});
