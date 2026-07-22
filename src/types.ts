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
  language?: string;
}

export interface Admin {
  username: string;
  password_hash: string;
}
