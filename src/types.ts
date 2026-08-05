export interface Env {
  DB: D1Database;
  SECRET_KEY: string;
  // Fallback base URL of the self-hosted Piston code-execution instance, used
  // only if no "piston_url" row exists in the config table. Keeping the live URL
  // in D1 means a cloudflared restart (which always mints a new hostname) is a
  // single D1 write rather than a secret change + redeploy.
  // Accepts either the host (e.g. https://piston.example.com) or the full API
  // base (https://piston.example.com/api/v2) -- both are normalized.
  PISTON_URL?: string;
  // Shared secret forwarded to the local Piston auth-proxy (scripts/piston-proxy.mjs)
  // as the X-Piston-Key header. Must match that proxy's configured authToken.
  // Optional: omit when talking to a bare Piston container with no proxy.
  PISTON_AUTH_TOKEN?: string;
}

// --- Code execution contract, shared by every runner backend ---
// Both src/piston.ts and src/wandbox.ts implement runCode(env, RunInput) =>
// RunResult, which is what makes them interchangeable at runtime (see runner.ts).
export interface RunInput {
  language: string;
  code: string;
  stdin: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  output: string; // combined text to show (compile errors folded in)
  exitCode: number | null;
  signal: string | null;
  time: string; // human label like "0.04s", or "" if unknown
  // Set ONLY when the run could not be performed at all (runner unconfigured,
  // unreachable, timed out, malformed reply). A program that compiles and fails
  // on its own leaves this unset -- that distinction is what lets runner.ts
  // fall back to the other backend without masking a student's genuine error.
  error?: string;
}

// Decoded session cookie payload.
export interface Session {
  u: string;        // username
  is_admin: boolean;
  iat: number;      // issued-at, unix seconds
}

export interface Student {
  username: string;
  password_hash: string;
  school?: string;
  grade?: string;
  language?: string; // fallback default; the live choice is made at login (student_prefs)
}

export interface Admin {
  username: string;
  password_hash: string;
}
