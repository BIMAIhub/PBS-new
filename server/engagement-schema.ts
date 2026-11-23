export const engagementSchema = `
CREATE TABLE IF NOT EXISTS referral_codes (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id), code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY, referrer_id TEXT NOT NULL REFERENCES accounts(id), referred_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
  enrollment_id TEXT NOT NULL UNIQUE REFERENCES enrollments(id), code TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount >= 0), wait_days INTEGER NOT NULL, minimum_fee INTEGER NOT NULL,
  require_referrer_paid INTEGER NOT NULL, require_student_paid INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', qualified_at TEXT NOT NULL DEFAULT '', eligible_at TEXT NOT NULL DEFAULT '',
  credited_at TEXT NOT NULL DEFAULT '', checked_at TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS referrals_owner ON referrals(referrer_id, created_at);
CREATE INDEX IF NOT EXISTS referrals_processing ON referrals(status, checked_at);
CREATE TABLE IF NOT EXISTS referral_wallet (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), referral_id TEXT UNIQUE REFERENCES referrals(id),
  amount INTEGER NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL, request_key TEXT UNIQUE, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS referral_wallet_owner ON referral_wallet(account_id, created_at);
CREATE TABLE IF NOT EXISTS mail_contacts (
  email TEXT PRIMARY KEY COLLATE NOCASE, name TEXT NOT NULL DEFAULT '', consent INTEGER NOT NULL DEFAULT 0,
  unsubscribed INTEGER NOT NULL DEFAULT 0, unsubscribe_token TEXT NOT NULL UNIQUE, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_campaigns (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, template_id TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft', admin_id TEXT NOT NULL REFERENCES accounts(id),
  marketing INTEGER NOT NULL DEFAULT 1, revision TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_campaign_recipients (
  campaign_id TEXT NOT NULL REFERENCES mail_campaigns(id), email TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT '', PRIMARY KEY(campaign_id, email)
);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, campaign_id TEXT NOT NULL DEFAULT '',
  admin_id TEXT NOT NULL REFERENCES accounts(id), account_id TEXT NOT NULL DEFAULT '', email TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, body TEXT NOT NULL, marketing INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS mail_outbox_pending ON mail_outbox(status, created_at);
`;
