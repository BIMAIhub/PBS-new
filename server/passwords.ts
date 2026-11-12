import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const options = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const hashLength = 64;
let pending = 0;
const queue: Array<() => void> = [];

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    function run() {
      pending++;
      scrypt(password, salt, hashLength, options, (error, key) => {
        pending--;
        queue.shift()?.();
        if (error) reject(error);
        else resolve(key);
      });
    }
    if (pending < 2) run();
    else if (queue.length < 12) queue.push(run);
    else reject(new Error('Password verification is busy'));
  });
}

export function validPassword(password: string, minimumLength = 12) {
  return password.length >= minimumLength && Buffer.byteLength(password) <= 256;
}

export async function hashPassword(password: string, { temporary = false } = {}) {
  const minimumLength = temporary ? 8 : 12;
  if (!validPassword(password, minimumLength)) throw new Error(`Use at least ${minimumLength} characters and at most 256 bytes.`);
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, saltHex, hashHex] = stored.split(':');
  const valid = scheme === 'scrypt' && /^[a-f0-9]{32}$/.test(saltHex || '') && /^[a-f0-9]{128}$/.test(hashHex || '');
  if (Buffer.byteLength(password) > 256) return false;
  const hash = await derive(password, valid ? Buffer.from(saltHex, 'hex') : Buffer.alloc(16));
  return valid && timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export const temporaryPassword = () => randomBytes(18).toString('base64url');
