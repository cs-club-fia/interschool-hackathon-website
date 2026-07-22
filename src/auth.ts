// Authentication: password verification (PBKDF2 via WebCrypto), stateless
// signed-cookie sessions (HMAC-SHA256), and CSRF tokens derived from the
// session. No server-side session store -- everything is verified from the
// cookie against SECRET_KEY.

import type { Env, Session, Student, Admin } from "./types";
import loginsData from "./data/logins.json";

const SESSION_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const COOKIE_NAME = "session";
const enc = new TextEncoder();

interface LoginsFile {
  students: Student[];
  admins: Admin[];
}
const logins = loginsData as unknown as LoginsFile;

// --- Login lookups (bundled config) ---
export function findStudent(username: string): Student | undefined {
  return logins.students.find((s) => s.username === username);
}
export function findAdmin(username: string): Admin | undefined {
  return logins.admins.find((a) => a.username === username);
}
export function allStudents(): Student[] {
  return logins.students;
}

// --- base64 / base64url helpers ---
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function b64url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return b64ToBytes(b64);
}
function b64urlStr(str: string): string {
  return b64url(enc.encode(str));
}
function b64urlStrDecode(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// --- Password verification (PBKDF2-HMAC-SHA256) ---
// Stored format: pbkdf2$<iterations>$<saltB64>$<hashB64>  (see scripts/gen-hash.mjs)
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  let salt: Uint8Array, expected: Uint8Array;
  try {
    salt = b64ToBytes(parts[2]);
    expected = b64ToBytes(parts[3]);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    expected.length * 8,
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

// --- HMAC helpers ---
async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}
async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return new Uint8Array(sig);
}

// --- Session cookie (stateless, signed) ---
export async function createSessionValue(env: Env, session: Session): Promise<string> {
  const payload = b64urlStr(JSON.stringify(session));
  const sig = await hmac(env.SECRET_KEY, payload);
  return `${payload}.${b64url(sig)}`;
}

export async function verifySessionValue(env: Env, value: string): Promise<Session | null> {
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const sigPart = value.slice(dot + 1);
  const expected = await hmac(env.SECRET_KEY, payload);
  let given: Uint8Array;
  try {
    given = b64urlToBytes(sigPart);
  } catch {
    return null;
  }
  if (!timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(b64urlStrDecode(payload)) as Session;
    if (typeof s.u !== "string" || typeof s.iat !== "number") return null;
    if (Date.now() / 1000 - s.iat > SESSION_TTL_SECONDS) return null;
    return s;
  } catch {
    return null;
  }
}

export function sessionCookieHeader(value: string): string {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}
export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export async function getSession(request: Request, env: Env): Promise<Session | null> {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  const match = cookie.split(/;\s*/).find((c) => c.startsWith(COOKIE_NAME + "="));
  if (!match) return null;
  const value = match.slice(COOKIE_NAME.length + 1);
  if (!value) return null;
  return verifySessionValue(env, value);
}

// --- CSRF token (deterministic per session, no storage needed) ---
export async function csrfTokenFor(env: Env, session: Session): Promise<string> {
  const sig = await hmac(env.SECRET_KEY, `csrf|${session.u}|${session.iat}`);
  return b64url(sig);
}

export async function checkCsrf(request: Request, env: Env, session: Session): Promise<boolean> {
  const expected = await csrfTokenFor(env, session);
  let provided = request.headers.get("X-CSRFToken") || "";
  if (!provided) {
    // fall back to a form field (cloned so the caller can still read the body)
    try {
      const form = await request.clone().formData();
      provided = (form.get("csrf_token") as string) || "";
    } catch {
      provided = "";
    }
  }
  if (!provided) return false;
  return timingSafeEqual(enc.encode(provided), enc.encode(expected));
}
