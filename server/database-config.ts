type Environment = Record<string, string | undefined>;

export class DatabaseConfigurationError extends Error {}

function value(input: string | undefined, key: string, alias: string) {
  let result = input?.trim() || '';
  if (!result) return '';
  // The dashboard takes a value, but connection snippets also contain KEY="value".
  const assignment = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*/.exec(result);
  if (assignment) {
    if (![key, alias].includes(assignment[1])) throw new DatabaseConfigurationError(`Set ${key} to its value only, without another variable name.`);
    result = result.slice(assignment[0].length).trim();
  }
  const quote = result[0];
  if ((quote === '"' || quote === "'") && result.at(-1) === quote) result = result.slice(1, -1).trim();
  if (/[\r\n\x00-\x1f\x7f]/.test(result)) throw new DatabaseConfigurationError(`Set ${key} to a single value without line breaks.`);
  return result;
}

export function databaseConfiguration(env: Environment) {
  const prefixed = Boolean(env.PBS_TURSO_DATABASE_URL?.trim() || env.PBS_TURSO_AUTH_TOKEN?.trim());
  const urlKey = prefixed ? 'PBS_TURSO_DATABASE_URL' : 'TURSO_DATABASE_URL';
  const tokenKey = prefixed ? 'PBS_TURSO_AUTH_TOKEN' : 'TURSO_AUTH_TOKEN';
  const url = value(env[urlKey], urlKey, prefixed ? 'TURSO_DATABASE_URL' : 'PBS_TURSO_DATABASE_URL');
  const authToken = value(env[tokenKey], tokenKey, prefixed ? 'TURSO_AUTH_TOKEN' : 'PBS_TURSO_AUTH_TOKEN').replace(/^Bearer\s+/i, '');
  if (!url && !authToken && !env.VERCEL) return undefined;
  if (!url || !authToken) throw new DatabaseConfigurationError('Connect a Turso database and configure both its URL and auth token.');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new DatabaseConfigurationError(`Set ${urlKey} to the database connection URL only.`); }
  if (!['libsql:', 'https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.hash || parsed.searchParams.has('authToken')) {
    throw new DatabaseConfigurationError(`Set ${urlKey} to the database URL and put the token separately in ${tokenKey}.`);
  }
  if (/\s/.test(authToken) || (parsed.hostname.endsWith('.turso.io') && !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authToken))) {
    throw new DatabaseConfigurationError(`Set ${tokenKey} to the complete database token only. Copy it from the database selected by ${urlKey}.`);
  }
  return { url, authToken };
}

export function safeStartupError(error: unknown) {
  if (error instanceof DatabaseConfigurationError) return error.message;
  const fault = error as { code?: unknown; cause?: { status?: unknown } } | null;
  const code = typeof fault?.code === 'string' && /^[A-Z0-9_]{1,60}$/.test(fault.code) ? fault.code : 'SERVER_STARTUP_FAILED';
  const status = Number(fault?.cause?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? `${code}: database HTTP ${status}` : code;
}
