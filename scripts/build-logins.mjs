// Bulk-generate src/data/logins.json from a plaintext input file.
//
//   node scripts/build-logins.mjs [input.json] [output.json]
//   defaults:  logins.input.json  ->  src/data/logins.json
//
// INPUT format (plaintext passwords -- this file must NEVER be committed;
// logins.input.json is gitignored). See logins.input.example.json:
// {
//   "students": [
//     { "username": "team-a", "password": "secret1", "school": "School A", "language": "python" }
//   ],
//   "admins": [
//     { "username": "admin", "password": "secret2" }
//   ]
// }
//
// Each password is hashed with PBKDF2-HMAC-SHA256, 100000 iterations (the MAX
// Cloudflare Workers allows -- higher throws NotSupportedError at runtime), and
// EVERY generated hash is immediately re-verified against its plaintext using
// the SAME logic as the Worker's verifyPassword() (src/auth.ts). If any hash
// fails that check the script aborts and writes nothing -- so a hash that
// wouldn't log in can never end up in your logins file. No lock-outs.

import { webcrypto as crypto } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ITERATIONS = 100000; // MUST be <= 100000 (Workers runtime cap)
const KEY_LEN = 32; // bytes
const SALT_LEN = 16; // bytes
const VALID_LANGUAGES = ["python", "cpp", "java"];
const DEFAULT_LANGUAGE = "python";

const enc = new TextEncoder();
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const fromB64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

async function pbkdf2Bits(password, salt, iterations, lenBytes) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    lenBytes * 8,
  );
  return new Uint8Array(bits);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const derived = await pbkdf2Bits(password, salt, ITERATIONS, KEY_LEN);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(derived)}`;
}

// Exact mirror of the Worker's verifyPassword (src/auth.ts) -- the anti-lockout check.
async function verifyPassword(stored, password) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = fromB64(parts[2]);
  const expected = fromB64(parts[3]);
  const actual = await pbkdf2Bits(password, salt, iterations, expected.length);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

const inputPath = process.argv[2] || "logins.input.json";
const outputPath = process.argv[3] || path.join("src", "data", "logins.json");

let raw;
try {
  raw = JSON.parse(readFileSync(inputPath, "utf8"));
} catch (e) {
  fail(
    `Could not read/parse input file "${inputPath}": ${e.message}\n` +
      `Copy logins.input.example.json to ${inputPath}, fill in real usernames/passwords, then re-run.`,
  );
}

const students = Array.isArray(raw.students) ? raw.students : [];
const admins = Array.isArray(raw.admins) ? raw.admins : [];
if (students.length === 0) fail('Input has no "students" entries.');
if (admins.length === 0) fail('Input has no "admins" entries -- you need at least one admin, or you cannot reach the dashboard.');

const seen = new Set();
function checkUser(u, where) {
  if (!u.username || typeof u.username !== "string" || !u.username.trim()) {
    fail(`${where}: an entry is missing a non-empty "username".`);
  }
  if (seen.has(u.username)) {
    fail(`Duplicate username "${u.username}" -- usernames must be unique across students AND admins.`);
  }
  seen.add(u.username);
  if (!u.password || typeof u.password !== "string") {
    fail(`${where} "${u.username}": missing a "password" (plaintext) field.`);
  }
}

const out = { students: [], admins: [] };
const report = [];

for (const s of students) {
  checkUser(s, "students");
  const language = String(s.language || DEFAULT_LANGUAGE).toLowerCase();
  if (!VALID_LANGUAGES.includes(language)) {
    fail(`student "${s.username}": language "${s.language}" is invalid. Use one of: ${VALID_LANGUAGES.join(", ")}.`);
  }
  const hash = await hashPassword(s.password);
  if (!(await verifyPassword(hash, s.password))) {
    fail(`Generated hash for "${s.username}" failed self-verification. Aborting so no one gets locked out.`);
  }
  out.students.push({ username: s.username, password_hash: hash, school: s.school || "", language });
  report.push([s.username, s.school || "", language, "student"]);
}

for (const a of admins) {
  checkUser(a, "admins");
  const hash = await hashPassword(a.password);
  if (!(await verifyPassword(hash, a.password))) {
    fail(`Generated hash for admin "${a.username}" failed self-verification. Aborting.`);
  }
  out.admins.push({ username: a.username, password_hash: hash });
  report.push([a.username, "", "", "admin"]);
}

writeFileSync(outputPath, JSON.stringify(out, null, 2) + "\n");

console.log(`\n✅ Wrote ${out.students.length} student(s) + ${out.admins.length} admin(s) to ${outputPath}`);
console.log("   Every hash was re-verified against its password with the Worker's own algorithm.\n");
const pad = (s, n) => String(s).padEnd(n);
console.log(`   ${pad("username", 22)}${pad("school", 20)}${pad("language", 10)}role`);
console.log(`   ${"-".repeat(22)}${"-".repeat(20)}${"-".repeat(10)}-----`);
for (const [u, sch, lang, role] of report) {
  console.log(`   ${pad(u, 22)}${pad(sch, 20)}${pad(lang, 10)}${role}`);
}
console.log("\n   Next: npx wrangler deploy   (or git push if the Git build is connected)\n");
