import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, now } from './database.js';
import { field, notFound, route } from './http.js';

export async function syncNotifications(db: Database, account: { id: string; role: string }) {
  const insert = `INSERT OR IGNORE INTO notifications (id, account_id, title, body, kind, page, created_at)`;
  await db.prepare(`${insert} SELECT 'message:' || m.id || ':' || ?, ?, m.subject, substr(m.body, 1, 240), 'message', 'messages', m.sent_at
    FROM messages m WHERE ${account.role === 'admin' ? "m.sender = 'student'" : "m.account_id = ? AND m.sender = 'admin'"}`)
    .run(account.id, account.id, ...(account.role === 'admin' ? [] : [account.id]));
  if (account.role === 'admin') {
    await db.prepare(`${insert} SELECT 'application:' || e.id || ':' || ?, ?, 'New enrollment application', a.name || ' applied for ' || c.title,
      'enrollment', 'enrollments', e.submitted_at FROM enrollments e JOIN accounts a ON a.id = e.account_id
      JOIN courses c ON c.id = e.course_id JOIN enrollment_details d ON d.enrollment_id = e.id WHERE d.source = 'student' AND e.status = 'pending'`).run(account.id, account.id);
    await db.prepare(`${insert} SELECT 'payment:' || e.id || ':' || e.reference || ':' || ?, ?, 'Payment reference to verify',
      a.name || ' submitted a payment reference for ' || c.title, 'payment', 'payments', e.submitted_at
      FROM enrollments e JOIN accounts a ON a.id = e.account_id JOIN courses c ON c.id = e.course_id WHERE e.requested_payment > 0`).run(account.id, account.id);
    await db.prepare(`${insert} SELECT 'task-submission:' || s.id || ':' || s.submitted_at || ':' || ?, ?, 'Assignment submitted', a.name || ' submitted ' || t.title,
      'assignment', 'curriculum', s.submitted_at FROM task_submissions s JOIN learning_tasks t ON t.id = s.task_id JOIN accounts a ON a.id = s.account_id WHERE s.reviewed_at = ''`).run(account.id, account.id);
  } else {
    const knownLive = new Set((await db.prepare("SELECT id FROM notifications WHERE account_id = ? AND id LIKE 'live-%'").all(account.id)).map(item => String(item.id)));
    const liveClasses = await db.prepare(`SELECT l.id, l.title, l.starts_at, l.ends_at, l.join_before, l.status, l.access_confirmed, l.revision
      FROM live_classes l JOIN enrollments e ON e.course_id = l.course_id WHERE e.account_id = ? AND e.status = 'approved'
      AND l.published = 1 AND (l.ends_at >= ? OR l.status = 'cancelled') ORDER BY l.starts_at LIMIT 100`).all(account.id, new Date(Date.now() - 24 * 60 * 60_000).toISOString());
    for (const session of liveClasses) {
      const time = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(String(session.starts_at)));
      const updateId = `live-update:${session.id}:${session.revision}:${account.id}`;
      if (!knownLive.has(updateId)) await db.prepare(`${insert} VALUES (?, ?, ?, ?, 'session', 'sessions', ?)`)
        .run(updateId, account.id, session.status === 'cancelled' ? 'Live session cancelled' : 'Live session scheduled or updated', `${session.title} — ${time} IST`, now());
      const opens = Date.parse(String(session.starts_at)) - Number(session.join_before) * 60_000;
      if (session.status === 'scheduled' && session.access_confirmed && Date.now() >= opens && Date.now() < Date.parse(String(session.ends_at))) {
        const openId = `live-open:${session.id}:${session.revision}:${account.id}`;
        if (!knownLive.has(openId)) await db.prepare(`${insert} VALUES (?, ?, 'Your live session is open', ?, 'session', 'sessions', ?)`)
          .run(openId, account.id, `${session.title} — join from your live sessions page`, now());
      }
    }
    await db.prepare(`${insert} SELECT 'decision:' || e.id || ':' || e.status, ?, CASE WHEN e.status = 'approved' THEN 'Your course access is ready' ELSE 'Enrollment update' END,
      c.title || CASE WHEN e.status = 'approved' THEN ' — enrollment approved' ELSE ' — application declined' END,
      'enrollment', 'courses', CASE WHEN e.approved_at <> '' THEN e.approved_at ELSE e.submitted_at END
      FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.account_id = ? AND e.status <> 'pending'`).run(account.id, account.id);
    await db.prepare(`${insert} SELECT 'receipt:' || r.id, ?, 'Payment receipt available', c.title || ' — your verified payment has been recorded',
      'payment', 'fees', r.issued_at FROM receipts r JOIN enrollments e ON e.id = r.enrollment_id JOIN courses c ON c.id = e.course_id WHERE e.account_id = ?`).run(account.id, account.id);
    await db.prepare(`${insert} SELECT 'credential-ready:' || e.id, ?, 'Your certificate is ready', c.title || ' — lessons completed and assessment passed',
      'certificate', 'certificates', ar.submitted_at FROM enrollments e JOIN courses c ON c.id = e.course_id
      JOIN assessment_results ar ON ar.course_id = c.id AND ar.account_id = e.account_id AND ar.passed = 1
      WHERE e.account_id = ? AND e.status = 'approved' AND NOT EXISTS (SELECT 1 FROM certificates ct WHERE ct.account_id = e.account_id AND ct.course_id = c.id)
      AND EXISTS (SELECT 1 FROM lessons l JOIN modules m ON m.id = l.module_id WHERE m.course_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM lessons l JOIN modules m ON m.id = l.module_id WHERE m.course_id = c.id
        AND NOT EXISTS (SELECT 1 FROM completions p WHERE p.lesson_id = l.id AND p.account_id = e.account_id))`).run(account.id, account.id);
    await db.prepare(`${insert} SELECT 'task:' || t.id || ':' || ?, ?, 'Course assignment available', t.title, 'assignment', 'project', t.created_at
      FROM learning_tasks t JOIN enrollments e ON e.course_id = t.course_id WHERE e.account_id = ? AND e.status = 'approved' AND t.published = 1`).run(account.id, account.id, account.id);
    await db.prepare(`${insert} SELECT 'task-feedback:' || s.id || ':' || s.reviewed_at, ?, 'Assignment feedback available', t.title,
      'assignment', 'project', s.reviewed_at FROM task_submissions s JOIN learning_tasks t ON t.id = s.task_id WHERE s.account_id = ? AND s.reviewed_at <> ''`).run(account.id, account.id);
  }
}

export function mountNotifications(app: Express, db: WritableDatabase) {
  app.get('/api/notifications', route(async (req, res) => {
    const account = await requireAccount(db, req);
    await syncNotifications(db, account);
    const items = await db.prepare(`SELECT id, title, body, kind, page, created_at AS createdAt, read_at AS readAt, shown_at AS shownAt
      FROM notifications WHERE account_id = ? ORDER BY created_at DESC LIMIT 80`).all(account.id);
    const count = await db.prepare("SELECT COUNT(*) AS unread FROM notifications WHERE account_id = ? AND read_at = ''").get(account.id);
    res.json({ items, unread: Number(count?.unread || 0) });
  }));
  app.post('/api/notifications/read-all', route(async (req, res) => {
    const account = await requireAccount(db, req);
    await db.prepare("UPDATE notifications SET read_at = ? WHERE account_id = ? AND read_at = ''").run(now(), account.id);
    res.status(204).end();
  }));
  app.post('/api/notifications/seen', route(async (req, res) => {
    const account = await requireAccount(db, req);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 80).map(item => field(item, 'notification ID', 400)) : [];
    if (ids.length) await db.prepare(`UPDATE notifications SET shown_at = ? WHERE account_id = ? AND id IN (${ids.map(() => '?').join(',')})`).run(now(), account.id, ...ids);
    res.status(204).end();
  }));
  app.patch('/api/notifications/:id', route(async (req, res) => {
    const account = await requireAccount(db, req);
    const id = field(req.params.id, 'notification ID', 400);
    const column = req.body?.read === true ? 'read_at' : 'shown_at';
    const result = await db.prepare(`UPDATE notifications SET ${column} = ? WHERE id = ? AND account_id = ?`).run(now(), id, account.id);
    if (!result.changes) throw notFound('This notification is unavailable.');
    res.status(204).end();
  }));
}
