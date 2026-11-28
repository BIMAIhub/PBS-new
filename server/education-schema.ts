export const educationSchema = `
CREATE TABLE IF NOT EXISTS student_storage_cleanup (id TEXT PRIMARY KEY,admin_id TEXT NOT NULL REFERENCES accounts(id),operation TEXT NOT NULL,drive_id TEXT NOT NULL DEFAULT '',item_id TEXT NOT NULL DEFAULT '',permission_id TEXT NOT NULL DEFAULT '',upload_url TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS mail_delivery_locks (outbox_id TEXT PRIMARY KEY REFERENCES mail_outbox(id) ON DELETE CASCADE,lease_token TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS certificate_design_assets (
 course_id TEXT PRIMARY KEY,logo_image TEXT NOT NULL DEFAULT '',signature_image TEXT NOT NULL DEFAULT '',detail_text TEXT NOT NULL DEFAULT '',duration_label TEXT NOT NULL DEFAULT '',revision TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS certificate_signature_details (
 course_id TEXT PRIMARY KEY,second_signer TEXT NOT NULL DEFAULT '',second_role TEXT NOT NULL DEFAULT '',second_signature_image TEXT NOT NULL DEFAULT '',revision TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS certificate_mail_deliveries (
 id TEXT PRIMARY KEY,certificate_id TEXT NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,account_id TEXT NOT NULL REFERENCES accounts(id),sender_id TEXT NOT NULL REFERENCES accounts(id),request_key TEXT NOT NULL UNIQUE,
 email TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,sent_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS alumni_welcomes (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,certificate_id TEXT NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,seen_at TEXT NOT NULL,PRIMARY KEY(account_id,certificate_id));
CREATE TABLE IF NOT EXISTS referral_code_controls (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,enabled INTEGER NOT NULL DEFAULT 1,alumni_paid_verified INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,verified_at TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS course_leads (
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id), email TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', qualification TEXT NOT NULL DEFAULT '',
  consent INTEGER NOT NULL DEFAULT 0, consent_at TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new',
  note TEXT NOT NULL DEFAULT '', revision TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(course_id,email)
);
CREATE TABLE IF NOT EXISTS brochure_requests (
  request_key TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES course_leads(id) ON DELETE CASCADE, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS course_leads_recent ON course_leads(updated_at DESC);
CREATE TABLE IF NOT EXISTS campaign_lead_links (
  campaign_id TEXT NOT NULL REFERENCES mail_campaigns(id) ON DELETE CASCADE, email TEXT NOT NULL COLLATE NOCASE,
  course_id TEXT NOT NULL REFERENCES courses(id), PRIMARY KEY(campaign_id,email)
);
CREATE TABLE IF NOT EXISTS academy_files (
  id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL,
  course_id TEXT REFERENCES courses(id) ON DELETE SET NULL, drive_id TEXT NOT NULL, parent_id TEXT NOT NULL,
  item_id TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL, original_name TEXT NOT NULL, size INTEGER NOT NULL,
  content_type TEXT NOT NULL, upload_url TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL,
  completed_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS learning_resources (
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK(scope IN ('course','module','lesson')),
  module_id TEXT REFERENCES modules(id) ON DELETE SET NULL, lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
  file_id TEXT REFERENCES academy_files(id), url TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0,
  revision TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS learning_resources_course ON learning_resources(course_id,published);
CREATE TABLE IF NOT EXISTS task_resources (
  task_id TEXT NOT NULL REFERENCES learning_tasks(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE, PRIMARY KEY(task_id,resource_id)
);
CREATE TABLE IF NOT EXISTS past_student_contacts (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,imported_by TEXT NOT NULL REFERENCES accounts(id),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS past_contact_imports (request_key TEXT PRIMARY KEY,content_hash TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES accounts(id),source TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS past_contact_import_rows (request_key TEXT NOT NULL REFERENCES past_contact_imports(request_key) ON DELETE CASCADE,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,created INTEGER NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(request_key,account_id));

CREATE TABLE IF NOT EXISTS legacy_training (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id), certificate_id TEXT NOT NULL UNIQUE REFERENCES certificates(id) ON DELETE CASCADE,
  qualification TEXT NOT NULL DEFAULT '', completed_at TEXT NOT NULL, mode TEXT NOT NULL,
  original_number TEXT NOT NULL DEFAULT '', score_recorded INTEGER NOT NULL DEFAULT 0,
  file_id TEXT REFERENCES academy_files(id), note TEXT NOT NULL DEFAULT '',
  imported_by TEXT NOT NULL REFERENCES accounts(id), created_at TEXT NOT NULL, UNIQUE(account_id,course_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_original_file ON legacy_training(file_id) WHERE file_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS legacy_import_requests (
  request_key TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES legacy_training(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS learning_quizzes (
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id TEXT REFERENCES modules(id) ON DELETE SET NULL, lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  scope TEXT NOT NULL CHECK(scope IN ('course','module','lesson')), title TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL CHECK(mode IN ('practice','assignment')), questions TEXT NOT NULL,
  resource_ids TEXT NOT NULL DEFAULT '[]', passing_score INTEGER NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 0,
  time_limit INTEGER NOT NULL DEFAULT 0, review_released INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0,
  revision TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES learning_quizzes(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, request_key TEXT NOT NULL,
  snapshot TEXT NOT NULL, answers TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft',
  score INTEGER, passed INTEGER, started_at TEXT NOT NULL, expires_at INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT '', feedback TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
  UNIQUE(account_id,request_key)
);
CREATE INDEX IF NOT EXISTS quiz_attempts_account ON quiz_attempts(account_id,quiz_id,started_at);
`;
