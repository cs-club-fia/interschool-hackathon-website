export interface Env {
  DB: D1Database;
  SECRET_KEY: string;
  // Base URL of the self-hosted Piston code-execution instance (used by the
  // question-page "Run" panel). Optional: if unset, the Run endpoint returns a
  // "not configured" message instead of executing. Accepts either the host
  // (e.g. https://piston.example.com) or the full API base
  // (https://piston.example.com/api/v2/piston) -- both are normalized.
  PISTON_URL?: string;
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
