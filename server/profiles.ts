import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Express, Response } from 'express';
import { get, put, del } from '@vercel/blob';
import { findAccount, publicAccount, requireAccount } from './auth.js';
import { type Database, type WritableDatabase, dataDirectory, makeId, transaction } from './database.js';
import { audit } from './academy-data.js';
import { badRequest, field, notFound, RequestError, route } from './http.js';
import { httpsLink, phoneNumber } from './inputs.js';
import type { PortfolioSections, StudentProfile } from '../src/live/experience-types.js';

export function listOfStrings(input: unknown, label: string, maxItems = 12, maxLength = 200): string[] {
  if (!Array.isArray(input) || input.length > 100 || input.some(item => typeof item !== 'string')) throw badRequest(`Enter up to ${maxItems} ${label}.`);
  const items = input.filter(item => item.trim());
  if (items.length > maxItems) throw badRequest(`Enter up to ${maxItems} ${label}.`);
  return items.map(item => field(item, label, maxLength));
}
export async function studentProfile(db: Database, accountId: string): Promise<StudentProfile> {
  const account = await findAccount(db, accountId);
  if (!account || account.role !== 'student') throw notFound('This student is unavailable.');
  const row = await db.prepare('SELECT * FROM student_profiles WHERE account_id = ?').get(accountId);
  return { name: account.name, phone: account.phone, headline: String(row?.headline || ''), location: String(row?.location || ''),
    about: String(row?.about || ''), skills: JSON.parse(String(row?.skills || '[]')), cvName: String(row?.cv_name || ''), cvSize: Number(row?.cv_size || 0), showCv: Boolean(row?.show_cv) };
}
export async function portfolioSections(db: Database, id: string): Promise<PortfolioSections> {
  const row = await db.prepare('SELECT layout, accent_color AS accentColor, projects, experience, education FROM portfolio_sections WHERE account_id = ?').get(id);
  return { layout: (row?.layout || 'studio') as PortfolioSections['layout'], accentColor: String(row?.accentColor || '#176BB7'),
    projects: JSON.parse(String(row?.projects || '[]')), experience: JSON.parse(String(row?.experience || '[]')), education: JSON.parse(String(row?.education || '[]')) };
}
function validateSections(input: any): PortfolioSections {
  const layout = field(input?.layout, 'portfolio layout', 20), accentColor = field(input?.accentColor, 'accent color', 7);
  if (!['studio', 'resume', 'gallery'].includes(layout) || !/^#[a-f0-9]{6}$/i.test(accentColor)) throw badRequest('Choose a valid portfolio layout and color.');
  const projects = input?.projects || [], experience = input?.experience || [], education = input?.education || [];
  if (![projects, experience, education].every(items => Array.isArray(items) && items.length <= 12)) throw badRequest('Add up to 12 items in each portfolio section.');
  const entries = (items: any[]) => items.map(item => ({ title: field(item?.title, 'role or qualification', 120), organization: field(item?.organization, 'organization', 160), period: field(item?.period, 'dates', 100, false), description: field(item?.description, 'entry description', 1500, false) }));
  return { layout: layout as PortfolioSections['layout'], accentColor,
    projects: projects.map(item => ({ title: field(item?.title, 'project title', 120), summary: field(item?.summary, 'project summary', 1500, false), url: httpsLink(item?.url, 'project link'), tools: field(item?.tools, 'project tools', 250, false) })), experience: entries(experience), education: entries(education) };
}
async function saveSections(db: Database, id: string, sections: PortfolioSections) {
  await db.prepare(`INSERT INTO portfolio_sections VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET
    layout = excluded.layout, accent_color = excluded.accent_color, projects = excluded.projects,
    experience = excluded.experience, education = excluded.education`).run(id, sections.layout, sections.accentColor, JSON.stringify(sections.projects), JSON.stringify(sections.experience), JSON.stringify(sections.education));
}
const localCv = (id: string) => path.join(dataDirectory, 'cv', id);
async function removeCv(location: string) {
  if (/^pbs\/cv\/[\w-]+\.pdf$/.test(location)) await del(location);
  else if (/^[a-f\d-]+\.pdf$/.test(location)) await rm(localCv(location), { force: true });
}
async function deliverCv(res: Response, location: string, name: string) {
  res.type('application/pdf').set('Content-Disposition', `attachment; filename="PBS-CV.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`);
  if (/^pbs\/cv\/[\w-]+\.pdf$/.test(location)) {
    const result = await get(location, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) throw notFound('The CV file is unavailable.');
    await pipeline(Readable.fromWeb(result.stream as import('node:stream/web').ReadableStream), res);
  } else if (/^[a-f\d-]+\.pdf$/.test(location)) {
    const bytes = await readFile(localCv(location)).catch(() => { throw notFound('The CV file is unavailable.'); }); res.send(bytes);
  }
  else throw notFound('The CV file is unavailable.');
}

export function mountProfiles(app: Express, db: WritableDatabase, hosted: boolean) {
  app.get('/api/student/profile/details', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student'); res.json(await studentProfile(db, account.id));
  }));
  app.patch('/api/student/profile/details', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    const name = field(req.body?.name, 'full name', 120), phone = phoneNumber(req.body?.phone);
    const headline = field(req.body?.headline, 'professional headline', 160, false), location = field(req.body?.location, 'location', 120, false);
    const about = field(req.body?.about, 'profile summary', 3000, false), skills = listOfStrings(req.body?.skills || [], 'skills', 20, 60);
    await transaction(db, async tx => {
      await tx.prepare('UPDATE accounts SET name = ?, phone = ? WHERE id = ?').run(name, phone, account.id);
      await tx.prepare(`INSERT INTO student_profiles (account_id, headline, location, about, skills, show_cv) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET headline = excluded.headline, location = excluded.location, about = excluded.about,
        skills = excluded.skills, show_cv = excluded.show_cv`).run(account.id, headline, location, about, JSON.stringify(skills), Number(req.body?.showCv === true));
    });
    res.json({ profile: await studentProfile(db, account.id), account: publicAccount((await findAccount(db, account.id))!) });
  }));
  app.post('/api/student/profile/cv', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    const name = field(req.query.filename, 'PDF filename', 150).replace(/[\r\n\x00-\x1f]/g, '');
    const size = Number(req.get('content-length'));
    if (req.get('content-type')?.split(';')[0] !== 'application/pdf' || !/\.pdf$/i.test(name)) throw badRequest('Choose a PDF CV.');
    if (!Number.isSafeInteger(size) || size < 8 || size > 3 * 1024 * 1024) throw new RequestError(413, 'Upload a PDF CV up to 3 MB.');
    const parts: Buffer[] = []; let received = 0;
    for await (const chunk of req) { received += chunk.length; if (received > 3 * 1024 * 1024) throw new RequestError(413, 'Upload a PDF CV up to 3 MB.'); parts.push(Buffer.from(chunk)); }
    const bytes = Buffer.concat(parts);
    if (received !== size || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw badRequest('The selected file is not a valid PDF upload.');
    const file = `${makeId()}.pdf`, cloud = hosted || Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
    const location = cloud ? `pbs/cv/${file}` : file;
    if (cloud) await put(location, bytes, { access: 'private', contentType: 'application/pdf', addRandomSuffix: false });
    else { await mkdir(path.join(dataDirectory, 'cv'), { recursive: true, mode: 0o700 }); await writeFile(localCv(file), bytes, { mode: 0o600, flag: 'wx' }); }
    let prior = '';
    try {
      await transaction(db, async tx => {
        prior = String((await tx.prepare('SELECT cv_path FROM student_profiles WHERE account_id = ?').get(account.id))?.cv_path || '');
        await tx.prepare(`INSERT INTO student_profiles (account_id, cv_path, cv_name, cv_size) VALUES (?, ?, ?, ?)
          ON CONFLICT(account_id) DO UPDATE SET cv_path = excluded.cv_path, cv_name = excluded.cv_name, cv_size = excluded.cv_size`).run(account.id, location, name, size);
      });
    } catch (error) { await removeCv(location).catch(() => {}); throw error; }
    if (prior) await removeCv(prior).catch(() => {});
    res.status(201).json(await studentProfile(db, account.id));
  }));
  app.get('/api/student/profile/cv', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    const row = await db.prepare('SELECT cv_path, cv_name FROM student_profiles WHERE account_id = ?').get(account.id);
    if (!row?.cv_path) throw notFound('Upload your CV first.'); await deliverCv(res, String(row.cv_path), String(row.cv_name));
  }));
  app.delete('/api/student/profile/cv', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    const prior = await transaction(db, async tx => {
      const row = await tx.prepare('SELECT cv_path FROM student_profiles WHERE account_id = ?').get(account.id);
      await tx.prepare("UPDATE student_profiles SET cv_path = '', cv_name = '', cv_size = 0, show_cv = 0 WHERE account_id = ?").run(account.id);
      return String(row?.cv_path || '');
    });
    if (prior) await removeCv(prior).catch(() => {}); res.status(204).end();
  }));
  app.get('/api/portfolios/:id/cv', route(async (req, res) => {
    const row = await db.prepare(`SELECT s.cv_path, s.cv_name FROM student_profiles s JOIN portfolios p ON p.account_id = s.account_id
      WHERE s.account_id = ? AND s.show_cv = 1 AND p.published = 1`).get(req.params.id);
    if (!row?.cv_path) throw notFound('This CV is private or unavailable.'); await deliverCv(res, String(row.cv_path), String(row.cv_name));
  }));
  app.get('/api/student/portfolio/sections', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student'); res.json(await portfolioSections(db, account.id));
  }));
  app.put('/api/student/portfolio/sections', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student');
    await saveSections(db, account.id, validateSections(req.body));
    res.json(await portfolioSections(db, account.id));
  }));
  app.put('/api/student/portfolio/builder', route(async (req, res) => {
    const account = await requireAccount(db, req, 'student'), published = req.body?.published === true;
    const headline = field(req.body?.headline, 'portfolio headline', 160, published), bio = field(req.body?.bio, 'portfolio summary', 5000, false);
    const project = httpsLink(req.body?.projectUrl, 'featured project', false), linkedin = httpsLink(req.body?.linkedin, 'LinkedIn profile', false), github = httpsLink(req.body?.github, 'GitHub profile', false), website = httpsLink(req.body?.website, 'website', false);
    const sections = validateSections(req.body?.sections);
    await transaction(db, async tx => {
      await tx.prepare(`INSERT INTO portfolios VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET
        headline = excluded.headline, bio = excluded.bio, project_url = excluded.project_url, published = excluded.published`).run(account.id, headline, bio, project, Number(published));
      await tx.prepare(`INSERT INTO portfolio_links VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET linkedin = excluded.linkedin,
        github = excluded.github, website = excluded.website`).run(account.id, linkedin, github, website);
      await saveSections(tx, account.id, sections);
      await tx.prepare(`INSERT INTO student_profiles (account_id, show_cv) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET show_cv = excluded.show_cv`).run(account.id, Number(req.body?.showCv === true));
    }); res.status(204).end();
  }));
}
