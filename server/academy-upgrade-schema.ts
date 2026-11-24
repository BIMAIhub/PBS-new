export const academyUpgradeSchema = `
CREATE TABLE IF NOT EXISTS microsoft_mail_connections (
 admin_id TEXT PRIMARY KEY REFERENCES accounts(id), profile_email TEXT NOT NULL, profile_name TEXT NOT NULL,
 token_cache TEXT NOT NULL, connected_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS microsoft_oauth_roles (state_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS course_batches (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 starts_at TEXT NOT NULL, ends_at TEXT NOT NULL DEFAULT '', deadline TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity>0),
 status TEXT NOT NULL DEFAULT 'draft', revision TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS enrollment_batches (enrollment_id TEXT PRIMARY KEY REFERENCES enrollments(id), batch_id TEXT NOT NULL REFERENCES course_batches(id));
CREATE INDEX IF NOT EXISTS enrollment_batch_lookup ON enrollment_batches(batch_id);
CREATE TABLE IF NOT EXISTS live_class_batches (class_id TEXT PRIMARY KEY REFERENCES live_classes(id), batch_id TEXT NOT NULL REFERENCES course_batches(id));
CREATE TABLE IF NOT EXISTS module_releases (
 module_id TEXT NOT NULL REFERENCES modules(id), batch_id TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'open',
 release_at TEXT NOT NULL DEFAULT '', class_id TEXT NOT NULL DEFAULT '', released INTEGER NOT NULL DEFAULT 0,
 revision TEXT NOT NULL, PRIMARY KEY(module_id,batch_id)
);
CREATE TABLE IF NOT EXISTS class_completion (class_id TEXT PRIMARY KEY REFERENCES live_classes(id), completed_at TEXT NOT NULL, completed_by TEXT NOT NULL REFERENCES accounts(id));
CREATE TABLE IF NOT EXISTS private_file_cleanup (location TEXT PRIMARY KEY, created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS lesson_watch_totals (
 account_id TEXT NOT NULL REFERENCES accounts(id), lesson_id TEXT NOT NULL REFERENCES lessons(id), media_key TEXT NOT NULL,
 duration REAL NOT NULL, ranges TEXT NOT NULL DEFAULT '[]', watched REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
 PRIMARY KEY(account_id,lesson_id)
);
CREATE TABLE IF NOT EXISTS lesson_watch_sessions (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), lesson_id TEXT NOT NULL REFERENCES lessons(id),
 media_key TEXT NOT NULL, duration REAL NOT NULL, position REAL NOT NULL, seen_at INTEGER NOT NULL, sequence INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lesson_media_durations (lesson_id TEXT PRIMARY KEY REFERENCES lessons(id),media_key TEXT NOT NULL,duration REAL NOT NULL);
CREATE INDEX IF NOT EXISTS watch_session_owner ON lesson_watch_sessions(account_id,lesson_id);
CREATE TABLE IF NOT EXISTS notice_board (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL, course_id TEXT NOT NULL DEFAULT '',
 batch_id TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0, starts_at TEXT NOT NULL, expires_at TEXT NOT NULL DEFAULT '',
 author_id TEXT NOT NULL REFERENCES accounts(id), revision TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drive_uploads (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), admin_id TEXT NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL,
 course_id TEXT NOT NULL REFERENCES courses(id), batch_id TEXT NOT NULL DEFAULT '', module_id TEXT NOT NULL DEFAULT '', task_id TEXT NOT NULL DEFAULT '',
 drive_id TEXT NOT NULL, parent_id TEXT NOT NULL, item_id TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL, size INTEGER NOT NULL,
 content_type TEXT NOT NULL, upload_url TEXT NOT NULL, expires_at INTEGER NOT NULL, attached_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assignment_drive_files (
 id TEXT PRIMARY KEY, upload_id TEXT NOT NULL UNIQUE REFERENCES drive_uploads(id), account_id TEXT NOT NULL REFERENCES accounts(id),
 task_id TEXT NOT NULL REFERENCES learning_tasks(id), course_id TEXT NOT NULL REFERENCES courses(id), batch_id TEXT NOT NULL DEFAULT '',
 drive_id TEXT NOT NULL, item_id TEXT NOT NULL, web_url TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS referral_bank_details (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id), sealed_details TEXT NOT NULL, revision TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS referral_payouts (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), amount INTEGER NOT NULL CHECK(amount>0),
 status TEXT NOT NULL DEFAULT 'requested', bank_snapshot TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
 request_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, paid_at TEXT NOT NULL DEFAULT '', paid_by TEXT NOT NULL DEFAULT ''
);
`;
