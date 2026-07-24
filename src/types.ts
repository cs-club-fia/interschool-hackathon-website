export interface Env {
  DB: D1Database;
  SECRET_KEY: string;
  // Fallback base URL of the self-hosted Piston code-execution instance, used
  // only if no "piston_url" row exists in the config table. In normal
  // operation the live URL lives in D1 (see db.getConfig/setConfig) and is
  // kept current by scripts/piston-tunnel.ps1, which POSTs to
  // /internal/piston-url every time cloudflared hands out a new hostname.
  // Accepts either the host (e.g. https://piston.example.com) or the full API
  // base (https://piston.example.com/api/v2/piston) -- both are normalized.
  PISTON_URL?: string;
  // Shared secret forwarded to the local Piston auth-proxy (scripts/piston-proxy.mjs)
  // as the X-Piston-Key header. Must match that proxy's configured authToken.
  PISTON_AUTH_TOKEN?: string;
  // Bearer token required by POST /internal/piston-url to update the stored
  // Piston URL. Required (the route is disabled if unset) -- without it,
  // anyone could redirect code execution to a server of their choosing and
  // capture every submission.
  PISTON_ADMIN_TOKEN?: string;
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
