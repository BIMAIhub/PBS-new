import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseConfiguration, DatabaseConfigurationError, safeStartupError } from '../server/database-config.js';
import { checkProductionDatabase } from '../server/database-preflight.js';
import type { WritableDatabase } from '../server/database.js';

const url = 'libsql://isolated-config-test.turso.io';
const token = 'eyJ0ZXN0IjoidGVzdCJ9.eyJyaWQiOiJpc29sYXRlZCJ9.c2lnbmF0dXJl';

test('database config accepts raw, quoted and copied dotenv values without changing the connection', () => {
  for (const wrapped of [token, `"${token}"`, `'${token}'`, `PBS_TURSO_AUTH_TOKEN="${token}"`, `export TURSO_AUTH_TOKEN='${token}'`, `Bearer ${token}`]) {
    assert.deepEqual(databaseConfiguration({ PBS_TURSO_DATABASE_URL: `TURSO_DATABASE_URL="${url}"`, PBS_TURSO_AUTH_TOKEN: wrapped }), { url, authToken: token });
  }
});
test('the PBS pair stays together and never borrows a token from another environment pair', () => {
  assert.throws(() => databaseConfiguration({ PBS_TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: token }), DatabaseConfigurationError);
  assert.deepEqual(databaseConfiguration({ TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: token }), { url, authToken: token });
  assert.equal(databaseConfiguration({}), undefined);
  assert.throws(() => databaseConfiguration({ VERCEL: '1' }), DatabaseConfigurationError);
});
test('malformed configuration produces actionable messages without exposing credentials', () => {
  for (const invalid of ['private-secret', `${token}\nTURSO_DATABASE_URL=${url}`, `OTHER_SECRET=${token}`, `"${token}`]) {
    assert.throws(() => databaseConfiguration({ PBS_TURSO_DATABASE_URL: url, PBS_TURSO_AUTH_TOKEN: invalid }), (error: any) => {
      assert.ok(error instanceof DatabaseConfigurationError); assert.ok(!error.message.includes(token)); assert.ok(!error.message.includes('private-secret')); return true;
    });
  }
  assert.throws(() => databaseConfiguration({ PBS_TURSO_DATABASE_URL: `${url}?authToken=${token}`, PBS_TURSO_AUTH_TOKEN: token }), DatabaseConfigurationError);
});
test('startup diagnostics report upstream status but never arbitrary provider messages', () => {
  const error = Object.assign(new Error(`Authorization: ${token}`), { code: 'SERVER_ERROR', cause: { status: 400 } });
  assert.equal(safeStartupError(error), 'SERVER_ERROR: database HTTP 400');
  assert.equal(safeStartupError(new Error(token)), 'SERVER_STARTUP_FAILED');
});
test('production preflight checks the migrated database and closes the connection', async () => {
  let read = false, closed = false;
  const db = { prepare: (sql: string) => { assert.equal(sql, 'SELECT 1 AS ready'); return { get: async () => { read = true; return { ready: 1 }; } }; }, close: () => { closed = true; } } as unknown as WritableDatabase;
  assert.equal(await checkProductionDatabase({ VERCEL_ENV: 'production' }, async () => db), true);
  assert.ok(read && closed);
});
test('production preflight fails the build on a rejected database and always closes an opened connection', async () => {
  await assert.rejects(checkProductionDatabase({ VERCEL_ENV: 'production' }, async () => { throw new Error('Isolated authentication rejection'); }), /authentication rejection/);
  let closed = false;
  const db = { prepare: () => ({ get: async () => { throw new Error('Isolated database rejection'); } }), close: () => { closed = true; } } as unknown as WritableDatabase;
  await assert.rejects(checkProductionDatabase({ VERCEL_ENV: 'production' }, async () => db), /database rejection/);
  assert.equal(closed, true);
});
test('local and preview builds do not connect to a production database', async () => {
  for (const env of [{}, { VERCEL_ENV: 'preview' }]) assert.equal(await checkProductionDatabase(env, async () => { throw new Error('Must not connect'); }), false);
});
