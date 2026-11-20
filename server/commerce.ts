import type { Express } from 'express';
import { requireAccount, sessionAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, now, transaction } from './database.js';
import { audit, saveSetting, setting } from './academy-data.js';
import { badRequest, conflict, emailAddress, field, integer, limitAttempts, notFound, route } from './http.js';
import { courseById } from './records.js';
import type { PriceQuote, Promotion } from '../src/live/experience-types.js';

const fields = `p.id, p.title, p.description, p.kind, p.code, p.percent, p.course_id AS courseId,
  p.owner_id AS ownerId, p.assigned_email AS assignedEmail, p.active, p.starts_at AS startsAt,
  p.ends_at AS endsAt, p.max_uses AS maxUses,
  (SELECT COUNT(*) FROM enrollment_prices x JOIN enrollments e ON e.id = x.enrollment_id WHERE x.promotion_id = p.id AND e.status <> 'rejected') AS uses`;
export async function promotions(db: Database): Promise<Promotion[]> {
  return (await db.prepare(`SELECT ${fields} FROM promotions p ORDER BY p.created_at DESC`).all()).map(row => ({ ...row, active: Boolean(row.active) })) as unknown as Promotion[];
}
export function availablePromotion(item: Promotion, courseId: string, time = now()) {
  return item.active && (!item.courseId || item.courseId === courseId) && (!item.startsAt || item.startsAt <= time) &&
    (!item.endsAt || item.endsAt > time) && (!item.maxUses || item.uses < item.maxUses);
}
function priceFromOffers(course: { id: string; fee: number }, eligible: Promotion[]): PriceQuote {
  const best = [...eligible].sort((a, b) => b.percent - a.percent || a.id.localeCompare(b.id))[0];
  const discount = best ? Math.floor(course.fee * best.percent / 100) : 0;
  return { listPrice: course.fee, discount, total: course.fee - discount, promotionId: best?.id || '', promotionTitle: best?.title || '', code: best?.code || '', percent: best?.percent || 0 };
}
export function publicPrice(course: { id: string; fee: number }, items: Promotion[]) {
  return priceFromOffers(course, items.filter(item => item.kind === 'public' && !item.assignedEmail && availablePromotion(item, course.id)));
}
export async function quotePrice(db: Database, courseId: string, rawCode = '', email = '', accountId = ''): Promise<PriceQuote> {
  const course = await courseById(db, courseId);
  const code = rawCode.trim().toUpperCase();
  const items = await promotions(db);
  let eligible = items.filter(item => item.kind === 'public' && !item.assignedEmail && availablePromotion(item, courseId));
  if (code) {
    const offer = items.find(item => item.code.toUpperCase() === code && item.kind !== 'public');
    if (!offer || !availablePromotion(offer, courseId)) throw badRequest('This offer code is unavailable or has reached its usage limit.');
    if (offer.assignedEmail && offer.assignedEmail !== email.toLowerCase()) throw badRequest('This offer is assigned to a different email.');
    if (offer.ownerId && (offer.ownerId === accountId || (email && await db.prepare('SELECT 1 FROM accounts WHERE id = ? AND email = ? COLLATE NOCASE').get(offer.ownerId, email)))) throw badRequest('A referral code is for another student.');
    eligible = [...eligible, offer];
  }
  return priceFromOffers(course, eligible);
}
export async function savePrice(db: Database, enrollmentId: string, quote: PriceQuote) {
  const promotion = quote.promotionId ? await db.prepare('SELECT owner_id FROM promotions WHERE id = ?').get(quote.promotionId) : undefined;
  await db.prepare(`INSERT INTO enrollment_prices VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(enrollment_id) DO UPDATE SET list_price = excluded.list_price, discount = excluded.discount,
    promotion_id = excluded.promotion_id, promotion_title = excluded.promotion_title, code = excluded.code, referrer_id = excluded.referrer_id`)
    .run(enrollmentId, quote.listPrice, quote.discount, quote.promotionId, quote.promotionTitle, quote.code, String(promotion?.owner_id || ''));
}

export async function provisionReferenceCatalog(db: WritableDatabase) {
  if (process.env.PBS_BOOTSTRAP_CATALOG !== '1' || await setting(db, 'reference_catalog_v1')) return;
  await transaction(db, async tx => {
    if (await setting(tx, 'reference_catalog_v1')) return;
    if (!await tx.prepare('SELECT 1 FROM courses LIMIT 1').get()) {
      const id = 'pbs-revit-mep-masterclass';
      await tx.prepare('INSERT INTO courses VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)').run(id,
        'Autodesk Revit MEP Masterclass (LOD 300 to LOD 500)',
        'Develop Revit MEP modelling and coordination skills, from project setup to mechanical systems and coordinated building services documentation. Explore the outline below; PBS adds video lessons and confirms session arrangements through your workspace.',
        'Revit MEP', 'PBS', '', 1499900, now());
      await tx.prepare('INSERT INTO course_pages VALUES (?, ?, ?, ?, ?, ?)').run(id, 'Foundation to professional practice', '', 'Civil, mechanical and electrical engineers, architects and BIM learners',
        JSON.stringify(['Set up a Revit MEP project with units, levels and linked models', 'Model HVAC ductwork and mechanical equipment', 'Coordinate building services information and prepare project documentation']),
        JSON.stringify(['Access to a suitable Revit installation for practice', 'Basic understanding of building systems']));
      const outlines = [
        ['Introduction to Revit MEP & project setup', 'Get familiar with the Revit environment, project units, levels, grids and linked architectural models.', ['Revit interface and ribbon navigation', 'Project units, levels and grids', 'Linking architectural models']],
        ['HVAC ductwork & mechanical equipment', 'Build a mechanical systems model and coordinate equipment and duct layouts.', ['Mechanical equipment placement', 'Duct systems and routing', 'Coordination and model review']],
      ] as const;
      for (const [index, module] of outlines.entries()) {
        const moduleId = makeId();
        await tx.prepare('INSERT INTO modules VALUES (?, ?, ?, ?)').run(moduleId, id, module[0], index + 1);
        await tx.prepare('INSERT INTO module_details VALUES (?, ?, ?)').run(moduleId, module[1], JSON.stringify(module[2]));
      }
      await audit(tx, 'PBS', 'Reference course published', id, 'Revit MEP Masterclass · INR 14,999, based on the supplied PBS course reference. No student or video records created.');
    }
    if (!await tx.prepare('SELECT 1 FROM promotions LIMIT 1').get()) {
      await tx.prepare('INSERT INTO promotions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('pbs-learning-20', '20% course offer', 'Save 20% on published PBS course fees. The offer is applied when you submit a new enrollment application.', 'public', '', 20, '', '', '', 1, '', '', 0, now());
    }
    await saveSetting(tx, 'reference_catalog_v1', now());
  });
}

export function mountCommerce(app: Express, db: WritableDatabase, hosted: boolean) {
  app.post('/api/enrollments/quote', limitAttempts(40, hosted ? db : undefined), route(async (req, res) => {
    const account = await sessionAccount(db, req);
    const course = await courseById(db, field(req.body?.courseId, 'course', 80));
    if (!course.published) throw notFound('This course is unavailable.');
    const email = account?.email || (req.body?.email ? emailAddress(req.body.email) : '');
    res.json(await quotePrice(db, course.id, field(req.body?.code, 'offer code', 40, false), email, account?.id));
  }));
  app.get('/api/admin/promotions', route(async (req, res) => { await requireAccount(db, req, 'admin'); res.json({ promotions: await promotions(db) }); }));
  app.get('/api/student/referrals', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    res.json({ promotions: (await promotions(db)).filter(item => item.ownerId === account.id && item.kind === 'referral').map(({ assignedEmail: _assigned, ownerId: _owner, ...item }) => item) });
  }));
  const save = route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    const id = req.params.id || makeId();
    if (req.params.id && !await db.prepare('SELECT 1 FROM promotions WHERE id = ?').get(id)) throw notFound('This offer is unavailable.');
    const kind = field(req.body?.kind, 'offer type', 20);
    if (!['public', 'coupon', 'referral'].includes(kind)) throw badRequest('Choose a valid offer type.');
    const code = kind === 'public' ? '' : field(req.body?.code, 'offer code', 40).toUpperCase();
    if (code && !/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)) throw badRequest('Use 3–40 letters, numbers, hyphens or underscores for the code.');
    const courseId = field(req.body?.courseId, 'course', 80, false);
    if (courseId) await courseById(db, courseId);
    const ownerId = kind === 'referral' ? field(req.body?.ownerId, 'referring student', 80, false) : '';
    if (ownerId && !await db.prepare("SELECT 1 FROM accounts WHERE id = ? AND role = 'student'").get(ownerId)) throw badRequest('Choose a registered student for this referral.');
    const date = (key: string) => { const raw = field(req.body?.[key], key, 50, false); if (!raw) return ''; if (!Number.isFinite(Date.parse(raw))) throw badRequest('Choose valid offer dates.'); return new Date(raw).toISOString(); };
    const start = date('startsAt'), end = date('endsAt'); if (start && end && end <= start) throw badRequest('The offer must end after its start date.');
    const email = kind !== 'public' && req.body?.assignedEmail ? emailAddress(req.body.assignedEmail) : '';
    await transaction(db, async tx => {
      await tx.prepare(`INSERT INTO promotions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, kind = excluded.kind,
        code = excluded.code, percent = excluded.percent, course_id = excluded.course_id, owner_id = excluded.owner_id,
        assigned_email = excluded.assigned_email, active = excluded.active, starts_at = excluded.starts_at, ends_at = excluded.ends_at, max_uses = excluded.max_uses`)
        .run(id, field(req.body?.title, 'offer title', 120), field(req.body?.description, 'offer details', 1000, false), kind, code,
          integer(req.body?.percent, 'discount percent', 1, 90), courseId, ownerId, email, Number(req.body?.active === true), start, end,
          integer(req.body?.maxUses ?? 0, 'usage limit', 0, 1000000), now());
      await audit(tx, admin.id, 'Course offer saved', id, field(req.body?.title, 'offer title', 120));
    });
    res.json({ id });
  });
  app.post('/api/admin/promotions', save); app.put('/api/admin/promotions/:id', save);
}
