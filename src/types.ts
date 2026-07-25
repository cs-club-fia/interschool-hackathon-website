export interface Env {
  DB: D1Database;
  SECRET_KEY: string;
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
