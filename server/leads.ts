import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, now, transaction } from './database.js';
import { audit } from './academy-data.js';
import { publicBranding } from './branding.js';
import { courseById } from './records.js';
import { quotePrice } from './commerce.js';
import { badRequest, conflict, emailAddress, field, limitAttempts, notFound, route } from './http.js';
import { phoneNumber } from './inputs.js';
import type { CourseLead } from '../src/live/education-types.js';

export async function brochureDetails(db: Database, courseId: string, admin = false) {
  const course = await courseById(db, courseId);
  if (!admin && !course.published) throw notFound('This course brochure is unavailable.');
  const page = await db.prepare('SELECT level,duration,audience,outcomes,requirements FROM course_pages WHERE course_id=?').get(courseId);
  const modules = await db.prepare(`SELECT m.id,m.title,COALESCE(d.summary,'') AS summary,COALESCE(d.objectives,'[]') AS objectives
    FROM modules m LEFT JOIN module_details d ON d.module_id=m.id WHERE m.course_id=? ORDER BY m.position`).all(courseId);
  const batches = await db.prepare(`SELECT name,starts_at AS startsAt,deadline,capacity,
    (SELECT COUNT(*) FROM enrollment_batches eb JOIN enrollments e ON e.id=eb.enrollment_id WHERE eb.batch_id=b.id AND e.status<>'rejected') AS used
    FROM course_batches b WHERE course_id=? AND status='open' AND deadline>? ORDER BY starts_at`).all(courseId, now());
  return { ...course, price:await quotePrice(db, courseId), brand:await publicBranding(db),
    page:page ? { ...page, outcomes:JSON.parse(String(page.outcomes)), requirements:JSON.parse(String(page.requirements)) } : { level:'',duration:'',audience:'',outcomes:[],requirements:[] },
    modules:await Promise.all(modules.map(async module => ({ ...module, objectives:JSON.parse(String(module.objectives)), lessons:await db.prepare('SELECT title,duration FROM lessons WHERE module_id=? ORDER BY position').all(module.id) }))),
    batches:batches.map(batch => ({ ...batch, seatsLeft:Math.max(0, Number(batch.capacity)-Number(batch.used)) })) };
}

export async function courseLeads(db: Database): Promise<CourseLead[]> {
  const rows = await db.prepare(`SELECT l.id,l.course_id AS courseId,c.title AS courseTitle,l.name,l.email,l.phone,l.qualification,
    l.consent,l.status,l.note,l.revision,l.created_at AS createdAt,l.updated_at AS updatedAt,
    COALESCE(mc.unsubscribed,0) AS optedOut,(SELECT COUNT(*) FROM brochure_requests r WHERE r.lead_id=l.id) AS requests,
    COALESCE((SELECT a.id FROM accounts a WHERE a.email=l.email COLLATE NOCASE AND a.role='student'),'') AS accountId,
    EXISTS(SELECT 1 FROM accounts a JOIN enrollments e ON e.account_id=a.id WHERE a.email=l.email COLLATE NOCASE
      AND e.course_id=l.course_id AND e.status='approved') AS enrolled
    FROM course_leads l JOIN courses c ON c.id=l.course_id LEFT JOIN mail_contacts mc ON mc.email=l.email COLLATE NOCASE ORDER BY l.updated_at DESC LIMIT 1000`).all();
  return rows.map(row => ({ ...row, consent:Boolean(row.consent), optedOut:Boolean(row.optedOut), enrolled:Boolean(row.enrolled), requests:Number(row.requests) })) as unknown as CourseLead[];
}

export function mountLeads(app: Express, db: WritableDatabase, hosted: boolean) {
  app.post('/api/courses/:id/brochure-request', limitAttempts(8, hosted ? db : undefined), route(async (req, res) => {
    const details = await brochureDetails(db, req.params.id), email = emailAddress(req.body?.email);
    const name = field(req.body?.name, 'full name', 120), phone = phoneNumber(req.body?.phone), qualification = field(req.body?.qualification, 'qualification', 160, false);
    const requestKey = field(req.body?.requestKey, 'request reference', 80);
    if (!/^[\w-]{16,80}$/.test(requestKey)) throw badRequest('Refresh the brochure form and try again.');
    const consent = req.body?.consent === true;
    const leadId = await transaction(db, async tx => {
      const priorRequest = await tx.prepare('SELECT r.lead_id,l.email,l.course_id FROM brochure_requests r JOIN course_leads l ON l.id=r.lead_id WHERE request_key=?').get(requestKey);
      if (priorRequest) {
        if (priorRequest.email !== email || priorRequest.course_id !== req.params.id) throw conflict('This brochure reference belongs to a different request. Open a fresh form.');
        return String(priorRequest.lead_id);
      }
      const existing = await tx.prepare('SELECT id FROM course_leads WHERE course_id=? AND email=? COLLATE NOCASE').get(req.params.id, email);
      const id = String(existing?.id || makeId()), at = now();
      await tx.prepare(`INSERT INTO course_leads(id,course_id,email,name,phone,qualification,consent,consent_at,revision,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(course_id,email) DO UPDATE SET
        phone=CASE WHEN excluded.phone<>'' THEN excluded.phone ELSE course_leads.phone END,
        qualification=CASE WHEN excluded.qualification<>'' THEN excluded.qualification ELSE course_leads.qualification END,
        consent=MAX(course_leads.consent,excluded.consent),consent_at=CASE WHEN excluded.consent=1 THEN excluded.consent_at ELSE course_leads.consent_at END,
        revision=excluded.revision,updated_at=excluded.updated_at`).run(id, req.params.id, email, name, phone, qualification, Number(consent), consent ? at : '', makeId(), at, at);
      await tx.prepare('INSERT INTO brochure_requests VALUES (?,?,?)').run(requestKey,id,at);
      await tx.prepare('INSERT OR IGNORE INTO mail_contacts(email,name,consent,unsubscribe_token,updated_at) VALUES (?,?,?,?,?)').run(email,name,Number(consent),randomBytes(24).toString('base64url'),at);
      // A new form may record consent; it never cancels a previous marketing opt-out.
      if (consent) await tx.prepare('UPDATE mail_contacts SET consent=1,updated_at=? WHERE email=?').run(at,email);
      return id;
    });
    res.status(201).json({ leadId, brochure:details });
  }));
  app.get('/api/admin/leads', route(async (req, res) => {
    await requireAccount(db, req, 'admin'); res.json({ leads:await courseLeads(db) });
  }));
  app.patch('/api/admin/leads/:id', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin'), status = field(req.body?.status, 'lead status', 20), note = field(req.body?.note, 'follow-up note', 4000, false);
    if (!['new','contacted','interested','lost'].includes(status)) throw badRequest('Choose a valid follow-up stage. Enrollment is recorded from approved student access.');
    await transaction(db, async tx => {
      const row = await tx.prepare('SELECT revision FROM course_leads WHERE id=?').get(req.params.id);
      if (!row) throw notFound('This lead is unavailable.');
      if (row.revision !== req.body?.revision) throw conflict('This lead changed. Refresh before saving.');
      await tx.prepare('UPDATE course_leads SET status=?,note=?,revision=?,updated_at=? WHERE id=?').run(status,note,makeId(),now(),req.params.id);
      await audit(tx,admin.id,'Brochure lead updated',req.params.id,status);
    }); res.status(204).end();
  }));
  app.get('/api/admin/leads/export', route(async (req, res) => {
    await requireAccount(db, req, 'admin'); const rows = await courseLeads(db);
    const cell = (value: unknown) => `"${String(value ?? '').replace(/^[=+\-@\t\r]/,'\'$&').replaceAll('"','""')}"`;
    const data = [['Name','Email','Phone','Course','Qualification','Stage','Enrolled','Marketing consent','Opted out','Requests','Created','Follow-up notes'],
      ...rows.map(row => [row.name,row.email,row.phone,row.courseTitle,row.qualification,row.status,row.enrolled?'Yes':'No',row.consent?'Yes':'No',row.optedOut?'Yes':'No',row.requests,row.createdAt,row.note])];
    res.type('text/csv').set('Content-Disposition','attachment; filename="PBS-brochure-leads.csv"').send('\uFEFF'+data.map(row=>row.map(cell).join(',')).join('\r\n'));
  }));
  app.get('/api/admin/courses/:id/brochure', route(async (req, res) => { await requireAccount(db,req,'admin'); res.json(await brochureDetails(db,req.params.id,true)); }));
}
