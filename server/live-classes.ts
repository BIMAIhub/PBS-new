import type { Express } from 'express';
import { activeCourseAccess } from './access-controls.js';
import { createHash } from 'node:crypto';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, now, transaction } from './database.js';
import { audit, saveSetting, setting } from './academy-data.js';
import { badRequest, conflict, field, integer, limitAttempts, notFound, RequestError, route } from './http.js';
import type { AttendancePreview, AttendanceRow, AttendanceStatus, LiveClass, StudentLiveData } from '../src/live/live-session-types.js';

const columns = `l.id, l.course_id AS courseId, c.title AS courseTitle, l.title, l.description,
  l.starts_at AS startsAt, l.ends_at AS endsAt, l.join_before AS joinBefore, l.points, l.minimum_minutes AS minimumMinutes,
  l.status, l.published, l.access_confirmed AS accessConfirmed, l.revision`;
function describe(row: any, time = Date.now()): LiveClass {
  const joinOpensAt = new Date(Date.parse(row.startsAt) - Number(row.joinBefore) * 60_000).toISOString();
  const state = row.status === 'cancelled' ? 'cancelled' : !row.published || !row.accessConfirmed ? 'unavailable' :
    time >= Date.parse(row.endsAt) ? 'ended' : time >= Date.parse(joinOpensAt) ? 'open' : 'upcoming';
  return { ...row, published: Boolean(row.published), accessConfirmed: Boolean(row.accessConfirmed), state, joinOpensAt };
}
async function getClass(db: Database, id: string) {
  const row = await db.prepare(`SELECT ${columns}, l.meet_url AS meetUrl FROM live_classes l JOIN courses c ON c.id = l.course_id WHERE l.id = ?`).get(id);
  if (!row) throw notFound('This live session is unavailable.'); return describe(row);
}
const approved = async (db: Database, accountId: string, courseId: string) => Boolean(await db.prepare("SELECT 1 FROM enrollments WHERE account_id = ? AND course_id = ? AND status = 'approved'").get(accountId, courseId));
export function meetLink(input: unknown) {
  let url: URL; try { url = new URL(field(input, 'Google Meet link', 500)); } catch { throw badRequest('Enter a Google Meet link such as https://meet.google.com/abc-defg-hij.'); }
  if (url.origin !== 'https://meet.google.com' || url.username || url.password || !/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname)) throw badRequest('Use a Google Meet meeting-code link, with the meet.google.com domain.');
  return `https://meet.google.com${url.pathname.replace(/\/$/, '')}`;
}
export async function saveLiveClass(db: WritableDatabase, actor: string, input: any, id: string = makeId()) {
  const start = Date.parse(field(input?.startsAt, 'start time', 50)), end = Date.parse(field(input?.endsAt, 'end time', 50));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 5 * 60_000 || end - start > 12 * 60 * 60_000) throw badRequest('Set a session duration between 5 minutes and 12 hours.');
  const courseId = field(input?.courseId, 'course', 80), status = input?.status || 'scheduled';
  if (!['scheduled', 'cancelled'].includes(status)) throw badRequest('Choose a valid session status.');
  const published = input?.published === true, accessConfirmed = input?.accessConfirmed === true;
  if (published && status === 'scheduled' && !accessConfirmed) throw badRequest('Confirm the Google Meet access setup before publishing.');
  const title = field(input?.title, 'session title', 160), description = field(input?.description, 'session description', 3000, false), meetUrl = meetLink(input?.meetUrl);
  const joinBefore = integer(input?.joinBefore ?? 10, 'join opening', 0, 30), points = integer(input?.points ?? 20, 'session points', 0, 500);
  const minimum = integer(input?.minimumMinutes ?? Math.min(15, Math.floor((end - start) / 60_000)), 'attendance minimum', 1, Math.floor((end - start) / 60_000));
  await transaction(db, async tx => {
    if (!await tx.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) throw notFound('Choose an existing course.');
    const prior = await tx.prepare('SELECT course_id, starts_at, ends_at FROM live_classes WHERE id = ?').get(id);
    if (prior && prior.course_id !== courseId) throw badRequest('Keep the original course. Create another session for a different course.');
    if (prior && (prior.starts_at !== new Date(start).toISOString() || prior.ends_at !== new Date(end).toISOString()) && await tx.prepare("SELECT 1 FROM live_attendance WHERE class_id = ? AND verified_at <> ''").get(id)) throw conflict('Attendance has been verified. Create a new session to change its date or time.');
    await tx.prepare(`INSERT INTO live_classes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, meet_url = excluded.meet_url,
      starts_at = excluded.starts_at, ends_at = excluded.ends_at, join_before = excluded.join_before, points = excluded.points,
      minimum_minutes = excluded.minimum_minutes, status = excluded.status, published = excluded.published,
      access_confirmed = excluded.access_confirmed, revision = excluded.revision, updated_at = excluded.updated_at`)
      .run(id, courseId, title, description, meetUrl, new Date(start).toISOString(), new Date(end).toISOString(), joinBefore, points, minimum, status, Number(published), Number(accessConfirmed), makeId(), now(), now());
    await audit(tx, actor, prior ? 'Live session updated' : 'Live session scheduled', id, `${title} · ${new Date(start).toISOString()}`);
  });
  return getClass(db, id);
}
export async function migrateLegacyLiveClasses(db: WritableDatabase) {
  if (await setting(db, 'live_classes_v1')) return;
  await transaction(db, async tx => {
    if (await setting(tx, 'live_classes_v1')) return;
    const links = await tx.prepare("SELECT * FROM course_links WHERE kind = 'session'").all();
    for (const link of links) {
      const start = Date.parse(String(link.starts_at)); if (!Number.isFinite(start)) continue;
      await tx.prepare('INSERT OR IGNORE INTO live_classes VALUES (?, ?, ?, ?, ?, ?, ?, 10, 20, 15, ?, 1, 0, ?, ?, ?)')
        .run(String(link.id), String(link.course_id), String(link.title), 'Existing session. Review Google Meet access settings before enabling student joins.', String(link.url), new Date(start).toISOString(), new Date(start + 60 * 60_000).toISOString(), 'scheduled', makeId(), now(), now());
    }
    await saveSetting(tx, 'live_classes_v1', now());
  });
}
export async function studentLiveData(db: Database, accountId: string): Promise<StudentLiveData> {
  const rows = await db.prepare(`SELECT ${columns}, a.first_joined_at AS firstJoinedAt, a.last_joined_at AS lastJoinedAt,
    a.join_count AS joinCount, a.status AS attendanceStatus, a.minutes, a.awarded_points AS attendancePoints, a.verified_at AS verifiedAt, a.source
    FROM live_classes l JOIN courses c ON c.id = l.course_id JOIN enrollments e ON e.course_id = l.course_id
    LEFT JOIN live_attendance a ON a.class_id = l.id AND a.account_id = e.account_id
    WHERE e.account_id = ? AND e.status = 'approved' AND l.published = 1
    AND NOT EXISTS (SELECT 1 FROM course_controls cc WHERE cc.course_id = e.course_id AND cc.paused = 1)
    AND NOT EXISTS (SELECT 1 FROM enrollment_controls ec WHERE ec.enrollment_id = e.id AND ec.paused = 1)
    ORDER BY l.starts_at DESC LIMIT 250`).all(accountId);
  const total = await db.prepare("SELECT COALESCE(SUM(awarded_points), 0) AS points, SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS attended FROM live_attendance WHERE account_id = ?").get(accountId);
  return { serverTime: now(), points: Number(total?.points || 0), attended: Number(total?.attended || 0), classes: rows.map(row => {
    const { firstJoinedAt, lastJoinedAt, joinCount, attendanceStatus, minutes, attendancePoints, verifiedAt, source, ...session } = row;
    return { ...describe(session), attendance: { firstJoinedAt: String(firstJoinedAt || ''), lastJoinedAt: String(lastJoinedAt || ''), joinCount: Number(joinCount || 0), status: (attendanceStatus || 'pending') as AttendanceStatus, minutes: Number(minutes || 0), points: Number(attendancePoints || 0), verifiedAt: String(verifiedAt || ''), source: String(source || '') } };
  }) };
}
async function roster(db: Database, session: LiveClass): Promise<AttendanceRow[]> {
  return (await db.prepare(`SELECT a.id AS studentId, a.name AS studentName, a.email, e.status AS enrollmentStatus,
    COALESCE(p.first_joined_at, '') AS firstJoinedAt, COALESCE(p.last_joined_at, '') AS lastJoinedAt,
    COALESCE(p.join_count, 0) AS joinCount, COALESCE(p.status, 'pending') AS status, COALESCE(p.minutes, 0) AS minutes,
    COALESCE(p.awarded_points, 0) AS points, COALESCE(p.verified_at, '') AS verifiedAt, COALESCE(p.source, '') AS source
    FROM enrollments e JOIN accounts a ON a.id = e.account_id LEFT JOIN live_attendance p ON p.class_id = ? AND p.account_id = a.id
    WHERE e.course_id = ? AND (e.status = 'approved' OR p.account_id IS NOT NULL) ORDER BY a.name`).all(session.id, session.courseId)).map(({ enrollmentStatus, ...row }) => ({ ...row, eligible: enrollmentStatus === 'approved' })) as unknown as AttendanceRow[];
}
async function verifyAttendance(db: Database, session: LiveClass, actor: string, accountId: string, status: AttendanceStatus, minutes: number, source: string) {
  const previous = await db.prepare('SELECT status, awarded_points FROM live_attendance WHERE class_id = ? AND account_id = ?').get(session.id, accountId);
  if (!await approved(db, accountId, session.courseId) && (!previous || status === 'present')) throw badRequest('Only approved course students can receive attendance or points. Existing records may be corrected to a non-Present status.');
  if ((session.status === 'cancelled' && status === 'present') || Date.parse(session.startsAt) > Date.now()) throw badRequest('Verify attendance after a scheduled session has started.');
  const points = status === 'present' ? previous?.status === 'present' ? Number(previous.awarded_points) : session.points : 0;
  const verifiedAt = now();
  await db.prepare(`INSERT INTO live_attendance (class_id, account_id, status, minutes, awarded_points, verified_at, verified_by, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(class_id, account_id) DO UPDATE SET status = excluded.status, minutes = excluded.minutes,
    awarded_points = excluded.awarded_points, verified_at = excluded.verified_at, verified_by = excluded.verified_by, source = excluded.source`)
    .run(session.id, accountId, status, minutes, points, verifiedAt, actor, source);
  if (previous?.status !== status || Number(previous?.awarded_points || 0) !== points) {
    const id = `attendance:${session.id}:${accountId}`;
    await db.prepare(`INSERT INTO notifications (id, account_id, title, body, kind, page, created_at) VALUES (?, ?, ?, ?, 'session', 'sessions', ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body, created_at = excluded.created_at, read_at = '', shown_at = ''`)
      .run(id, accountId, 'Live attendance updated', `${session.title} — ${status}${points ? ` · ${points} points earned` : ''}`, verifiedAt);
  }
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [], row: string[] = []; let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (character === ',' || character === '\n')) { row.push(cell.trim()); cell = ''; if (character === '\n') { if (row.some(Boolean)) rows.push([...row]); row.length = 0; } }
    else if (character !== '\r' || quoted) cell += character;
    if (rows.length > 1001) throw badRequest('Import up to 1,000 attendance rows at a time.');
  }
  if (quoted) throw badRequest('The CSV contains an unfinished quoted value.');
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length > 1001) throw badRequest('Import up to 1,000 attendance rows at a time.'); return rows;
}
function durationMinutes(value: string, seconds = false) {
  let total: number;
  if (/^\d+(\.\d+)?$/.test(value)) total = Number(value) * (seconds ? 1 : 60);
  else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) { const parts = value.split(':').map(Number); if (parts.slice(1).some(part => part > 59)) throw badRequest('Use valid durations such as 00:45:00.'); total = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]; }
  else {
    const match = value.toLowerCase().match(/^(?:(\d+)\s*h(?:ours?|rs?)?\s*)?(?:(\d+)\s*m(?:in(?:ute)?s?)?\s*)?(?:(\d+)\s*s(?:ec(?:ond)?s?)?\s*)?$/);
    if (!match || !match.slice(1).some(Boolean)) throw badRequest('Use minutes, HH:MM:SS, or a duration such as 45m 30s.');
    total = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  }
  if (total > 12 * 3600) throw badRequest('Attendance durations must be no longer than 12 hours.'); return Math.floor(total / 60);
}
async function previewAttendance(db: Database, session: LiveClass, csv: string): Promise<AttendancePreview> {
  const table = csvRows(csv.replace(/^\uFEFF/, '')), header = (table.shift() || []).map(value => value.toLowerCase().replace(/[^a-z]/g, ''));
  const emailIndex = header.findIndex(value => ['email', 'emailaddress', 'participantemail'].includes(value));
  const durationIndex = header.findIndex(value => ['duration', 'durationminutes', 'durationseconds'].includes(value));
  if (emailIndex < 0 || durationIndex < 0) throw badRequest('Use a CSV with Email and Duration columns from the Google Meet attendance report.');
  const eligible = (await roster(db, session)).filter(item => item.eligible), rows: AttendancePreview['rows'] = [], seen = new Set<string>(); let skipped = 0;
  for (const item of table) {
    const email = (item[emailIndex] || '').trim().toLowerCase(); const student = eligible.find(candidate => candidate.email.toLowerCase() === email);
    if (!student) { skipped++; continue; }
    if (seen.has(email)) throw badRequest('The report has duplicate student emails. Use one total-duration row per student.'); seen.add(email);
    const minutes = durationMinutes(item[durationIndex] || '', header[durationIndex] === 'durationseconds');
    const status = minutes >= session.minimumMinutes ? 'present' : minutes > 0 ? 'partial' : 'absent';
    rows.push({ studentId: student.studentId, studentName: student.studentName, email: student.email, minutes, status,
      points: status === 'present' ? student.status === 'present' ? student.points : session.points : 0 });
  }
  if (!rows.length) throw badRequest('No approved student emails match this course. Check the report and the enrolled Google accounts.');
  const currentRecords = eligible.filter(item => seen.has(item.email.toLowerCase()))
    .map(item => ({ id: item.studentId, status: item.status, minutes: item.minutes, points: item.points, verifiedAt: item.verifiedAt }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const reviewToken = createHash('sha256').update(JSON.stringify({ revision: session.revision, csv, rows, skipped, currentRecords })).digest('hex');
  return { rows, skipped, applied: false, reviewToken };
}
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
const icsText = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;').replaceAll('\r', '');
const icsDate = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export function mountLiveClasses(app: Express, db: WritableDatabase, hosted: boolean) {
  app.get('/api/student/live-classes', route(async (req, res) => { const account = await requireAccount(db, req, 'student'); res.json(await studentLiveData(db, account.id)); }));
  app.post('/api/live-classes/:id/join', limitAttempts(240, hosted ? db : undefined), route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    const session = await transaction(db, async tx => {
      const session = await getClass(tx, req.params.id);
      if (!session.published || !await activeCourseAccess(tx, account.id, session.courseId)) throw notFound('An approved enrollment is required for this live session.');
      if (session.state !== 'open') throw new RequestError(403, session.state === 'upcoming' ? 'Joining opens at the scheduled join time.' : 'This live session is not open for joining.');
      const url = meetLink(session.meetUrl), time = now();
      await tx.prepare(`INSERT INTO live_attendance (class_id, account_id, first_joined_at, last_joined_at, join_count) VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(class_id, account_id) DO UPDATE SET last_joined_at = excluded.last_joined_at, join_count = live_attendance.join_count + 1`).run(session.id, account.id, time, time);
      return { url, title: session.title };
    }); res.json(session);
  }));
  app.get('/api/live-classes/:id/calendar', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student'), session = await getClass(db, req.params.id);
    if (!session.published || !await activeCourseAccess(db, account.id, session.courseId)) throw notFound('This course session is unavailable.');
    if (session.status === 'cancelled') throw badRequest('This session has been cancelled.');
    const origin = process.env.PBS_PUBLIC_ORIGIN || `${hosted ? 'https' : req.protocol}://${req.get('host')}`;
    res.type('text/calendar').attachment('PBS-live-session.ics').send(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PBS//Learning sessions//EN', 'BEGIN:VEVENT', `UID:${session.id}@pbs`, `DTSTAMP:${icsDate(now())}`, `DTSTART:${icsDate(session.startsAt)}`, `DTEND:${icsDate(session.endsAt)}`, `SUMMARY:${icsText(session.title)}`, `DESCRIPTION:${icsText(`${session.courseTitle}\nSign in to your PBS workspace to join. Your enrollment is checked when the session opens.`)}`, `URL:${origin}/?page=sessions`, 'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(session.title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n'));
  }));
  app.get('/api/admin/live-classes', route(async (req, res) => {
    await requireAccount(db, req, 'admin');
    const rows = await db.prepare(`SELECT ${columns}, l.meet_url AS meetUrl,
      (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = l.course_id AND e.status = 'approved') AS enrolled,
      (SELECT COUNT(*) FROM live_attendance a WHERE a.class_id = l.id AND a.join_count > 0) AS portalJoins,
      (SELECT COUNT(*) FROM live_attendance a WHERE a.class_id = l.id AND a.status = 'present') AS confirmed
      FROM live_classes l JOIN courses c ON c.id = l.course_id ORDER BY l.starts_at DESC LIMIT 500`).all();
    res.json({ classes: rows.map(row => describe(row)), serverTime: now() });
  }));
  app.post('/api/admin/live-classes', route(async (req, res) => { const admin = await requireAccount(db, req, 'admin'); res.status(201).json(await saveLiveClass(db, admin.id, req.body)); }));
  app.put('/api/admin/live-classes/:id', route(async (req, res) => { const admin = await requireAccount(db, req, 'admin'); await getClass(db, req.params.id); res.json(await saveLiveClass(db, admin.id, req.body, req.params.id)); }));
  app.get('/api/admin/live-classes/:id/attendance', route(async (req, res) => { await requireAccount(db, req, 'admin'); const session = await getClass(db, req.params.id); res.json({ session, rows: await roster(db, session) }); }));
  app.patch('/api/admin/live-classes/:id/attendance/:studentId', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin'), status = field(req.body?.status, 'attendance status', 20) as AttendanceStatus;
    if (!['present', 'partial', 'absent', 'excused'].includes(status)) throw badRequest('Choose a valid attendance status.');
    const minutes = integer(req.body?.minutes ?? 0, 'attendance minutes', 0, 720);
    await transaction(db, async tx => { const session = await getClass(tx, req.params.id); await verifyAttendance(tx, session, admin.id, req.params.studentId, status, minutes, 'admin'); await audit(tx, admin.id, 'Live attendance verified', session.id, `${req.params.studentId} · ${status} · ${minutes} minutes`); }); res.status(204).end();
  }));
  app.post('/api/admin/live-classes/:id/attendance/import', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin'), csv = field(req.body?.csv, 'attendance CSV', 180000);
    const result = await transaction(db, async tx => {
      const session = await getClass(tx, req.params.id), preview = await previewAttendance(tx, session, csv);
      if (req.body?.apply === true) {
        if (req.body?.confirmed !== true) throw badRequest('Confirm that this report belongs to this session.');
        if (typeof req.body?.reviewToken !== 'string') throw conflict('Refresh the PBS portal, then preview this report again before applying it.');
        if (req.body?.reviewToken !== preview.reviewToken) throw conflict('This preview is outdated. Preview the report again; no attendance has been changed by this request.');
        for (const item of preview.rows) await verifyAttendance(tx, session, admin.id, item.studentId, item.status, item.minutes, 'meet-report');
        await audit(tx, admin.id, 'Meet attendance report imported', session.id, `${preview.rows.length} matched students; ${preview.skipped} unmatched rows skipped`); preview.applied = true;
      }
      return preview;
    }); res.json(result);
  }));
  app.get('/api/admin/live-classes/:id/attendance/export', route(async (req, res) => {
    await requireAccount(db, req, 'admin'); const session = await getClass(db, req.params.id), rows = await roster(db, session);
    res.type('text/csv').attachment('PBS-live-attendance.csv').send([['Student ID', 'Student', 'Email', 'Approved enrollment', 'First portal join', 'Last portal join', 'Portal join clicks', 'Attendance', 'Minutes', 'Points', 'Verified at', 'Source'], ...rows.map(item => [item.studentId, item.studentName, item.email, item.eligible, item.firstJoinedAt, item.lastJoinedAt, item.joinCount, item.status, item.minutes, item.points, item.verifiedAt, item.source])].map(row => row.map(csvCell).join(',')).join('\r\n'));
  }));
}
