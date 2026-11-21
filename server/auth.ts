import { createHash, randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { Account, Role } from '../src/live/types.js';
import { type Database, type WritableDatabase, transaction } from './database.js';
import { RequestError, badRequest, field, limitAttempts, route } from './http.js';
import { hashPassword, validPassword, verifyPassword } from './passwords.js';

type AccountRow = Omit<Account, 'mustChangePassword'> & { mustChangePassword: number; passwordHash: string };
export const accountFields = `id, role, name, email, phone, roll_number AS rollNumber,
  created_at AS createdAt, must_change AS mustChangePassword, password_hash AS passwordHash`;
const cookieName = 'pbs_session';
const hour = 60 * 60 * 1000;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function publicAccount(row: AccountRow): Account {
  const { passwordHash: _passwordHash, ...account } = row;
  return { ...account, mustChangePassword: Boolean(row.mustChangePassword) };
}

export async function findAccount(db: Database, id: string) {
  return await db.prepare(`SELECT ${accountFields} FROM accounts WHERE id = ?`).get(id) as unknown as AccountRow | undefined;
}

function requestToken(req: Request) {
  const value = req.headers.cookie?.split(/;\s*/).find(cookie => cookie.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return value && /^[\w-]{43}$/.test(value) ? tokenHash(value) : '';
}

function cookieSettings(req: Request) {
  const host = req.hostname;
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: req.secure || process.env.PBS_PUBLIC_ORIGIN?.startsWith('https:') === true ||
      (process.env.NODE_ENV === 'production' && !loopback)
  };
}

export async function sessionAccount(db: Database, req: Request) {
  const token = requestToken(req);
  if (!token) return undefined;
  const session = await db.prepare('SELECT account_id AS id FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .get(token, Date.now()) as { id: string } | undefined;
  const account = session ? await findAccount(db, session.id) : undefined;
  if (account?.role === 'student' && await db.prepare("SELECT 1 FROM student_admissions WHERE account_id = ? AND approved_at = ''").get(account.id)) return undefined;
  return account;
}

export async function requireAccount(db: Database, req: Request, role?: Role, allowPasswordChange = false) {
  const account = await sessionAccount(db, req);
  if (!account) throw new RequestError(401, 'Sign in to continue.');
  if (role && account.role !== role) throw new RequestError(403, 'This action requires a different account role.');
  if (account.mustChangePassword && !allowPasswordChange) {
    throw new RequestError(403, 'Set a new password to continue.');
  }
  return account;
}

export async function startSession(db: Database, req: Request, res: Response, accountId: string, remember: boolean) {
  const token = randomBytes(32).toString('base64url');
  const duration = remember ? 7 * 24 * hour : 12 * hour;
  const existing = requestToken(req);
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR token_hash = ?').run(Date.now(), existing);
  await db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash(token), accountId, Date.now() + duration);
  res.cookie(cookieName, token, { ...cookieSettings(req), ...(remember ? { maxAge: duration } : {}) });
}

export async function renewAccountSession(db: Database, req: Request, res: Response, accountId: string) {
  await db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
  await startSession(db, req, res, accountId, false);
}

export function mountAuth(app: Express, db: WritableDatabase, hosted: boolean) {
  app.get('/api/session', route(async (req, res) => {
    const account = await sessionAccount(db, req);
    res.json({ account: account ? publicAccount(account) : null });
  }));

  app.post('/api/auth/login', limitAttempts(12, hosted ? db : undefined), route(async (req, res) => {
    const identifier = field(req.body?.identifier, 'email or student ID', 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role = req.body?.role;
    if (!password || (role !== 'admin' && role !== 'student')) throw badRequest('Enter your sign-in details.');
    const account = await db.prepare(`SELECT ${accountFields} FROM accounts
      WHERE role = ? AND (email = ? COLLATE NOCASE OR id = ? COLLATE NOCASE OR roll_number = ? COLLATE NOCASE)`)
      .get(role, identifier, identifier, identifier) as unknown as AccountRow | undefined;
    const matches = await verifyPassword(password, account?.passwordHash ?? '');
    if (!account || !matches) throw new RequestError(401, 'Check your email or student ID and password.');
    const signedIn = await transaction(db, async tx => {
      const latest = await findAccount(tx, account.id);
      if (!latest || latest.passwordHash !== account.passwordHash || latest.email !== account.email || latest.rollNumber !== account.rollNumber) {
        throw new RequestError(401, 'Check your email or student ID and password.');
      }
      if (latest.role === 'student' && await tx.prepare("SELECT 1 FROM student_admissions WHERE account_id = ? AND approved_at = ''").get(latest.id)) {
        throw new RequestError(403, 'Your application is awaiting PBS approval. Your sign-in details will be issued after approval.');
      }
      await startSession(tx, req, res, latest.id, req.body.remember === true);
      return publicAccount(latest);
    });
    res.json({ account: signedIn });
  }));

  app.post('/api/auth/logout', route(async (req, res) => {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(requestToken(req));
    res.clearCookie(cookieName, cookieSettings(req));
    res.status(204).end();
  }));

  app.post('/api/auth/password', limitAttempts(10, hosted ? db : undefined), route(async (req, res) => {
    const account = await requireAccount(db, req, undefined, true);
    const current = typeof req.body?.current === 'string' ? req.body.current : '';
    const next = typeof req.body?.next === 'string' ? req.body.next : '';
    if (!validPassword(next) || current === next) throw badRequest('Use a different password with at least 12 characters.');
    if (!await verifyPassword(current, account.passwordHash)) throw badRequest('The current password is incorrect.');
    const hash = await hashPassword(next);
    await transaction(db, async tx => {
      await requireAccount(tx, req, undefined, true);
      const result = await tx.prepare('UPDATE accounts SET password_hash = ?, must_change = 0 WHERE id = ? AND password_hash = ?')
        .run(hash, account.id, account.passwordHash);
      if (!result.changes) throw new RequestError(409, 'The password changed during this request. Sign in again.');
      await renewAccountSession(tx, req, res, account.id);
    });
    res.json({ account: publicAccount((await findAccount(db, account.id))!) });
  }));
}
