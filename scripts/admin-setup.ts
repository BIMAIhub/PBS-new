import 'dotenv/config';
import { parseArgs } from 'node:util';
import { openDatabase, makeId, now, transaction } from '../server/database';
import { hashPassword } from '../server/passwords';
import { emailAddress, field } from '../server/http';
import { readSecret } from './secret.mjs';

async function main() {
  const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' }, reset: { type: 'boolean' } } });
  const email = emailAddress(values.email || process.env.PBS_ADMIN_EMAIL);
  const name = field(values.name || process.env.PBS_ADMIN_NAME || 'PBS Administrator', 'administrator name', 120);
  const db = openDatabase();
  try {
    const prior = db.prepare('SELECT id, role FROM accounts WHERE email = ?').get(email);
    if (prior?.role === 'student') throw new Error('This email belongs to a student account.');
    if (prior && !values.reset) throw new Error('The administrator already exists. Use --reset to replace the password.');
    if (!prior && values.reset) throw new Error('No administrator matches this email.');
    const password = await readSecret('PBS_ADMIN_PASSWORD', 'Administrator password');
    const hash = await hashPassword(password);
    transaction(db, () => {
      if (prior) {
        db.prepare("UPDATE accounts SET password_hash = ?, must_change = 0 WHERE id = ? AND role = 'admin'").run(hash, prior.id);
        db.prepare('DELETE FROM sessions WHERE account_id = ?').run(prior.id);
      } else {
        const id = makeId();
        db.prepare(`INSERT INTO accounts (id, role, name, email, roll_number, password_hash, created_at)
          VALUES (?, 'admin', ?, ?, ?, ?, ?)`).run(id, name, email, `ADMIN-${id}`, hash, now());
      }
    });
    console.log(`${prior ? 'Updated' : 'Created'} PBS administrator ${email}.`);
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
