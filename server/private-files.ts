import type { Database } from './database.js';
import { removeCv } from './profiles.js';

// Keep failed private-file deletions durable after a student record is removed.
// Locations are generated storage keys; student names and bank data are not kept.
export async function cleanupPrivateFiles(db: Database, remove = removeCv) {
  const pending = await db.prepare('SELECT location FROM private_file_cleanup ORDER BY created_at LIMIT 100').all();
  let removed = 0;
  for (const row of pending) {
    try {
      await remove(String(row.location));
      await db.prepare('DELETE FROM private_file_cleanup WHERE location=?').run(row.location);
      removed++;
    } catch {
      await db.prepare('UPDATE private_file_cleanup SET attempts=attempts+1 WHERE location=?').run(row.location);
    }
  }
  return { removed, pending: Number((await db.prepare('SELECT COUNT(*) AS n FROM private_file_cleanup').get())?.n || 0) };
}
