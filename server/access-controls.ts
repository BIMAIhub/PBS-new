import type { Database } from './database.js';

// Shared by every route that can expose teaching content or meeting links.
export async function activeCourseAccess(db: Database, accountId: string, courseId: string) {
  return Boolean(await db.prepare(`SELECT 1 FROM enrollments e
    LEFT JOIN account_controls a ON a.account_id = e.account_id
    LEFT JOIN course_controls c ON c.course_id = e.course_id
    LEFT JOIN enrollment_controls x ON x.enrollment_id = e.id
    WHERE e.account_id = ? AND e.course_id = ? AND e.status = 'approved'
    AND COALESCE(a.status, 'active') = 'active' AND COALESCE(c.paused, 0) = 0 AND COALESCE(x.paused, 0) = 0`).get(accountId, courseId));
}

export async function activeStudent(db: Database, accountId: string) {
  return !await db.prepare("SELECT 1 FROM account_controls WHERE account_id = ? AND status <> 'active'").get(accountId);
}
