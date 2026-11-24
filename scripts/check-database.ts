import { checkProductionDatabase } from '../server/database-preflight.js';
import { safeStartupError } from '../server/database-config.js';

try {
  if (await checkProductionDatabase()) console.log('Production database connection and schema verified.');
} catch (error) {
  console.error('Production database preflight failed:', safeStartupError(error));
  process.exitCode = 1;
}
