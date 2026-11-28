// Additive tables only: authentication, student records and existing notifications are retained.
export const pushSchema = `
CREATE TABLE IF NOT EXISTS push_devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  endpoint_hash TEXT NOT NULL UNIQUE, subscription TEXT NOT NULL, label TEXT NOT NULL,
  previews INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL DEFAULT '', last_delivery_at TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS push_devices_account ON push_devices(account_id);
CREATE TABLE IF NOT EXISTS push_deliveries (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
  UNIQUE(device_id, notification_id)
);
CREATE INDEX IF NOT EXISTS push_delivery_queue ON push_deliveries(status, next_attempt, lease_until);
CREATE TRIGGER IF NOT EXISTS push_notification_created AFTER INSERT ON notifications
WHEN NEW.read_at = ''
BEGIN
  INSERT OR IGNORE INTO push_deliveries(id, device_id, notification_id, account_id, created_at)
    SELECT lower(hex(randomblob(16))), d.id, NEW.id, NEW.account_id, strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM push_devices d JOIN sessions s ON s.token_hash = d.session_hash
    JOIN accounts a ON a.id = d.account_id
    WHERE d.account_id = NEW.account_id AND s.account_id = d.account_id
      AND s.expires_at > unixepoch('now') * 1000 AND a.must_change = 0
      AND NOT EXISTS(SELECT 1 FROM account_controls c WHERE c.account_id = a.id AND c.status <> 'active')
      AND NOT EXISTS(SELECT 1 FROM student_admissions sa WHERE sa.account_id = a.id AND sa.approved_at = '');
END;
`;
