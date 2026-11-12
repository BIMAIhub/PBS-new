import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

export async function readSecret(variable, label) {
  if (process.env[variable]) return process.env[variable];
  if (!process.stdin.isTTY) throw new Error(`Set ${variable} or run this command in an interactive terminal.`);
  const output = new Writable({ write(_data, _encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write(`${label} `);
  try {
    return await input.question('');
  } finally {
    input.close();
    process.stdout.write('\n');
  }
}
