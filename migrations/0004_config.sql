-- Small runtime-configurable key/value store. Currently holds one key,
-- "piston_url" -- the live Piston runner endpoint. Letting the laptop-side
-- tunnel watcher (scripts/piston-tunnel.ps1) POST updates here means a
-- cloudflared restart (which always mints a new hostname) self-heals without
-- a manual `wrangler secret put` + redeploy.
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
