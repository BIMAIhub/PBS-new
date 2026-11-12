import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const dataDirectory = path.resolve(process.env.PBS_DATA_DIR || 'data');
export const videoDirectory = path.join(dataDirectory, 'videos');

export function openDatabase() {
  mkdirSync(videoDirectory, { recursive: true, mode: 0o700 });
  const file = path.join(dataDirectory, 'pbs.sqlite');
  const db = new DatabaseSync(file);
  if (process.platform !== 'win32') chmodSync(file, 0o600);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

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
  `);
  const receiptColumns = new Set(db.prepare('PRAGMA table_info(receipts)').all().map(column => column.name));
  if (!receiptColumns.has('student_name')) db.exec("ALTER TABLE receipts ADD COLUMN student_name TEXT NOT NULL DEFAULT ''");
  if (!receiptColumns.has('course_title')) db.exec("ALTER TABLE receipts ADD COLUMN course_title TEXT NOT NULL DEFAULT ''");
  return db;
}

export type Database = ReturnType<typeof openDatabase>;
export const now = () => new Date().toISOString();
export const makeId = () => randomUUID();
export const makeStudentId = () => `PBS-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;

export function transaction<T>(db: Database, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
