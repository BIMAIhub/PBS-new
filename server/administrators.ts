import { type Database, makeId, now, transaction } from './database';
import { emailAddress, field } from './http';
import { hashPassword } from './passwords';

export function insertAdministrator(db: Database, { email, name, passwordHash, mustChangePassword = false }: {
  email: string; name: string; passwordHash: string; mustChangePassword?: boolean;
}) {
  const id = makeId();
  db.prepare(`INSERT INTO accounts (id, role, name, email, roll_number, password_hash, must_change, created_at)
    VALUES (?, 'admin', ?, ?, ?, ?, ?, ?)`)
    .run(id, name, email, `ADMIN-${id}`, passwordHash, Number(mustChangePassword), now());
}

export async function provisionInitialAdministrator(db: Database) {
  const emailSetting = process.env.PBS_BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.PBS_BOOTSTRAP_ADMIN_PASSWORD;
  if (!emailSetting && !password) return;

  const administrator = db.prepare("SELECT 1 FROM accounts WHERE role = 'admin' LIMIT 1");
  if (administrator.get()) return;
  if (!emailSetting || !password) throw new Error('Set both PBS_BOOTSTRAP_ADMIN_EMAIL and PBS_BOOTSTRAP_ADMIN_PASSWORD.');

  const email = emailAddress(emailSetting);
  const name = field(process.env.PBS_BOOTSTRAP_ADMIN_NAME || 'PBS Administrator', 'administrator name', 120);
  const passwordHash = await hashPassword(password, { temporary: true });

  transaction(db, () => {
    if (administrator.get()) return;
    if (db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(email)) {
      throw new Error('The initial administrator email already belongs to a student account.');
    }
    insertAdministrator(db, { email, name, passwordHash, mustChangePassword: true });
  });
}
