// Offline helper: hash a password into the format the Worker verifies.
//   node scripts/gen-hash.mjs "myPassword"
// Prints:  pbkdf2$<iterations>$<saltB64>$<hashB64>
// Paste the output into src/data/logins.json as a team/admin "password_hash".
//
// Uses WebCrypto with the SAME parameters as verifyPassword() in src/auth.ts
// (PBKDF2-HMAC-SHA256, 100000 iterations, 16-byte salt, 32-byte key), so hashes
// produced here verify correctly in the Cloudflare Worker.
import { webcrypto as crypto } from 'node:crypto';

const ITERATIONS = 600000;
const KEY_LEN = 32; // bytes

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_LEN * 8,
  );
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

const pw = process.argv[2];
if (!pw) {
  console.error('usage: node scripts/gen-hash.mjs "<password>"');
  process.exit(1);
}
console.log(await hashPassword(pw));
