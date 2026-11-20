import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import type { Client, Transaction } from '@libsql/client/web';
import { randomUUID } from 'node:crypto';

export const dataDirectory = path.resolve(process.env.PBS_DATA_DIR || 'data');
export const videoDirectory = path.join(dataDirectory, 'videos');

const schema = `
    CREATE TABLE IF NOT EXISTS promotions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL CHECK(kind IN ('public','coupon','referral')), code TEXT NOT NULL DEFAULT '',
      percent INTEGER NOT NULL CHECK(percent BETWEEN 1 AND 90), course_id TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL DEFAULT '', assigned_email TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT NOT NULL DEFAULT '', ends_at TEXT NOT NULL DEFAULT '', max_uses INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS promotion_codes ON promotions(code COLLATE NOCASE) WHERE code <> '';
    CREATE TABLE IF NOT EXISTS enrollment_prices (
      enrollment_id TEXT PRIMARY KEY REFERENCES enrollments(id), list_price INTEGER NOT NULL,
      discount INTEGER NOT NULL, promotion_id TEXT NOT NULL DEFAULT '', promotion_title TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '', referrer_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS course_pages (
      course_id TEXT PRIMARY KEY REFERENCES courses(id), level TEXT NOT NULL DEFAULT '', duration TEXT NOT NULL DEFAULT '',
      audience TEXT NOT NULL DEFAULT '', outcomes TEXT NOT NULL DEFAULT '[]', requirements TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS module_details (
      module_id TEXT PRIMARY KEY REFERENCES modules(id) ON DELETE CASCADE, summary TEXT NOT NULL,
      objectives TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS learning_tasks (
      id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id), module_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL, brief TEXT NOT NULL, deliverables TEXT NOT NULL DEFAULT '[]',
      published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_submissions (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES learning_tasks(id),
      account_id TEXT NOT NULL REFERENCES accounts(id), url TEXT NOT NULL, note TEXT NOT NULL,
      feedback TEXT NOT NULL DEFAULT '', submitted_at TEXT NOT NULL, reviewed_at TEXT NOT NULL DEFAULT '',
      UNIQUE(task_id, account_id)
    );
    CREATE TABLE IF NOT EXISTS curriculum_drafts (
      id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id), admin_id TEXT NOT NULL REFERENCES accounts(id),
      brief TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'drafting', model TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), title TEXT NOT NULL, body TEXT NOT NULL,
      kind TEXT NOT NULL, page TEXT NOT NULL, created_at TEXT NOT NULL,
      read_at TEXT NOT NULL DEFAULT '', shown_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS notification_inbox ON notifications(account_id, created_at);
    CREATE TABLE IF NOT EXISTS student_profiles (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id), headline TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
      about TEXT NOT NULL DEFAULT '', skills TEXT NOT NULL DEFAULT '[]', cv_path TEXT NOT NULL DEFAULT '',
      cv_name TEXT NOT NULL DEFAULT '', cv_size INTEGER NOT NULL DEFAULT 0, show_cv INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS portfolio_sections (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id), layout TEXT NOT NULL DEFAULT 'studio',
      accent_color TEXT NOT NULL DEFAULT '#176BB7', projects TEXT NOT NULL DEFAULT '[]',
      experience TEXT NOT NULL DEFAULT '[]', education TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS academy_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS enrollment_details (
      enrollment_id TEXT PRIMARY KEY REFERENCES enrollments(id), due_date TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'student', internal_note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS academy_events (
      id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL,
      detail TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payment_reminders (
      id TEXT PRIMARY KEY, enrollment_id TEXT NOT NULL REFERENCES enrollments(id),
      request_key TEXT NOT NULL UNIQUE, channel TEXT NOT NULL, status TEXT NOT NULL,
      body TEXT NOT NULL, sent_at TEXT NOT NULL, error TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS certificate_templates (
      course_id TEXT PRIMARY KEY, title TEXT NOT NULL, issuer TEXT NOT NULL,
      signer TEXT NOT NULL, signer_role TEXT NOT NULL, design TEXT NOT NULL,
      primary_color TEXT NOT NULL, accent_color TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS certificates (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      course_id TEXT NOT NULL REFERENCES courses(id), student_name TEXT NOT NULL,
      course_title TEXT NOT NULL, score INTEGER NOT NULL, issued_at TEXT NOT NULL,
      public_token TEXT NOT NULL UNIQUE, published INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT NOT NULL DEFAULT '', UNIQUE(account_id, course_id)
    );
    CREATE TABLE IF NOT EXISTS portfolio_links (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id), linkedin TEXT NOT NULL DEFAULT '',
      github TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS microsoft_connections (
      admin_id TEXT PRIMARY KEY REFERENCES accounts(id), profile_email TEXT NOT NULL,
      profile_name TEXT NOT NULL, token_cache TEXT NOT NULL, connected_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS microsoft_oauth (
      state_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES accounts(id),
      verifier TEXT NOT NULL, redirect_uri TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS course_storage (
      course_id TEXT PRIMARY KEY REFERENCES courses(id), admin_id TEXT NOT NULL REFERENCES accounts(id),
      drive_id TEXT NOT NULL, item_id TEXT NOT NULL, item_name TEXT NOT NULL,
      web_url TEXT NOT NULL, automatic INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS course_access_grants (
      enrollment_id TEXT PRIMARY KEY REFERENCES enrollments(id), email TEXT NOT NULL,
      status TEXT NOT NULL, permission_ids TEXT NOT NULL DEFAULT '[]', error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin', 'student')),
      name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT NOT NULL DEFAULT '', roll_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS rate_limits (
      id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(expires_at);
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
      category TEXT NOT NULL, instructor TEXT NOT NULL, schedule TEXT NOT NULL,
      fee INTEGER NOT NULL CHECK(fee >= 0), published INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL, position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY, module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
      title TEXT NOT NULL, duration TEXT NOT NULL, description TEXT NOT NULL,
      source_url TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS video_uploads (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
      content_type TEXT NOT NULL, size INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      lesson_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS enrollments (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      course_id TEXT NOT NULL REFERENCES courses(id), total INTEGER NOT NULL CHECK(total >= 0),
      status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
      requested_payment INTEGER NOT NULL DEFAULT 0, reference TEXT NOT NULL DEFAULT '',
      submitted_at TEXT NOT NULL, approved_at TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      UNIQUE(account_id, course_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS enrollment_payment_reference
      ON enrollments(reference COLLATE NOCASE) WHERE reference <> '' AND status <> 'rejected';
    CREATE TABLE IF NOT EXISTS receipts (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      enrollment_id TEXT NOT NULL REFERENCES enrollments(id),
      amount INTEGER NOT NULL CHECK(amount > 0), method TEXT NOT NULL,
      reference TEXT NOT NULL DEFAULT '', issued_at TEXT NOT NULL,
      issued_by TEXT REFERENCES accounts(id), student_name TEXT NOT NULL DEFAULT '', course_title TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS receipt_payment_reference ON receipts(reference COLLATE NOCASE)
      WHERE reference <> '';
    CREATE TABLE IF NOT EXISTS completions (
      account_id TEXT NOT NULL REFERENCES accounts(id), lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      completed_at TEXT NOT NULL, PRIMARY KEY(account_id, lesson_id)
    );
    CREATE TABLE IF NOT EXISTS course_links (
      id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('resource', 'session')),
      title TEXT NOT NULL, url TEXT NOT NULL, starts_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      course_id TEXT NOT NULL REFERENCES courses(id), url TEXT NOT NULL, note TEXT NOT NULL,
      feedback TEXT NOT NULL DEFAULT '', submitted_at TEXT NOT NULL, reviewed_at TEXT NOT NULL DEFAULT '',
      UNIQUE(account_id, course_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      sender TEXT NOT NULL CHECK(sender IN ('admin', 'student')),
      subject TEXT NOT NULL, body TEXT NOT NULL, sent_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS course_posts (
      id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id), body TEXT NOT NULL, sent_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolios (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id),
      headline TEXT NOT NULL, bio TEXT NOT NULL, project_url TEXT NOT NULL, published INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assessments (
      course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
      questions TEXT NOT NULL, passing_score INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assessment_results (
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id), score INTEGER NOT NULL,
      passed INTEGER NOT NULL, submitted_at TEXT NOT NULL, PRIMARY KEY(course_id, account_id)
    );
    CREATE TABLE IF NOT EXISTS placements (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id),
      status TEXT NOT NULL, target_role TEXT NOT NULL, notes TEXT NOT NULL
    );
`;

type Row = Record<string, SQLOutputValue>;
type Parameter = string | number | bigint | Uint8Array | null;
type Statement = {
  get(...values: Parameter[]): Promise<Row | undefined>;
  all(...values: Parameter[]): Promise<Row[]>;
  run(...values: Parameter[]): Promise<{ changes: number | bigint }>;
};

export interface Database {
  prepare(sql: string): Statement;
}

export interface WritableDatabase extends Database {
  write<T>(action: (db: Database) => Promise<T>): Promise<T>;
  close(): void;
}

function sqliteConnection(db: DatabaseSync, schedule: <T>(task: () => T) => Promise<T>): Database {
  return {
    prepare: sql => ({
      get: (...values) => schedule(() => db.prepare(sql).get(...values)),
      all: (...values) => schedule(() => db.prepare(sql).all(...values)),
      run: (...values) => schedule(() => db.prepare(sql).run(...values)),
    }),
  };
}

async function migrateReceiptLabels(db: Database, exec: (sql: string) => Promise<unknown>) {
  const columns = new Set((await db.prepare('PRAGMA table_info(receipts)').all()).map(column => column.name));
  if (!columns.has('student_name')) await exec("ALTER TABLE receipts ADD COLUMN student_name TEXT NOT NULL DEFAULT ''");
  if (!columns.has('course_title')) await exec("ALTER TABLE receipts ADD COLUMN course_title TEXT NOT NULL DEFAULT ''");
}

async function openLocalDatabase(): Promise<WritableDatabase> {
  mkdirSync(videoDirectory, { recursive: true, mode: 0o700 });
  const file = path.join(dataDirectory, 'pbs.sqlite');
  const db = new DatabaseSync(file);
  try {
    if (process.platform !== 'win32') chmodSync(file, 0o600);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    db.exec(schema);
    const direct = sqliteConnection(db, async task => task());
    await migrateReceiptLabels(direct, async sql => db.exec(sql));
    let pending: Promise<unknown> = Promise.resolve();
    function schedule<T>(task: () => T | Promise<T>) {
      const result = pending.then(task);
      pending = result.catch(() => {});
      return result;
    }
    return {
      ...sqliteConnection(db, schedule),
      write: action => schedule(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await action(direct);
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }),
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

function libsqlConnection(client: Pick<Client | Transaction, 'execute'>): Database {
  return {
    prepare: sql => ({
      get: async (...args) => (await client.execute({ sql, args })).rows[0] as unknown as Row | undefined,
      all: async (...args) => (await client.execute({ sql, args })).rows as unknown as Row[],
      run: async (...args) => ({ changes: (await client.execute({ sql, args })).rowsAffected }),
    }),
  };
}

export async function openDatabase(requireRemote = false): Promise<WritableDatabase> {
  const pbsUrl = process.env.PBS_TURSO_DATABASE_URL?.trim();
  const pbsToken = process.env.PBS_TURSO_AUTH_TOKEN?.trim();
  const usePrefix = Boolean(pbsUrl || pbsToken);
  const url = usePrefix ? pbsUrl : process.env.TURSO_DATABASE_URL?.trim();
  const authToken = usePrefix ? pbsToken : process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url && !authToken && !process.env.VERCEL && !requireRemote) return openLocalDatabase();
  if (!url || !authToken) throw new Error('Connect a Turso database and configure both its URL and auth token.');

  const { createClient } = await import('@libsql/client/web');
  const client = createClient({ url, authToken });
  try {
    await client.executeMultiple(schema);
    const connection = libsqlConnection(client);
    await migrateReceiptLabels(connection, sql => client.execute(sql));
    return {
      ...connection,
      write: async action => {
        const tx = await client.transaction('write');
        try {
          const result = await action(libsqlConnection(tx));
          await tx.commit();
          return result;
        } finally {
          tx.close();
        }
      },
      close: () => client.close(),
    };
  } catch (error) {
    client.close();
    throw error;
  }
}

export const now = () => new Date().toISOString();
export const makeId = () => randomUUID();
export const makeStudentId = () => `PBS-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;

export function transaction<T>(db: WritableDatabase, action: (db: Database) => Promise<T>) {
  return db.write(action);
}
