import { openDatabase, type WritableDatabase } from './database.js';

export async function checkProductionDatabase(
  env: Record<string, string | undefined> = process.env,
  connect: () => Promise<WritableDatabase> = () => openDatabase(true),
) {
  if (env.VERCEL_ENV !== 'production') return false;
  // Apply the same additive schema migrations used at startup, before routing
  // production traffic to this build. No account provisioning or reset runs here.
  const db = await connect();
  try { await db.prepare('SELECT 1 AS ready').get(); }
  finally { db.close(); }
  return true;
}
