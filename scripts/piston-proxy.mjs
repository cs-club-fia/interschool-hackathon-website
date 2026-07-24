// Thin auth gate that sits in front of the local Piston container. cloudflared
// tunnels THIS port publicly (not Piston's), so every request must carry the
// shared-secret header to be forwarded -- closes the "public unauthenticated
// code execution" gap that comes from exposing Piston's bare API directly.
//
// Config lives in piston.local.json (gitignored) next to this script -- copy
// piston.local.example.json and fill it in. Run with: node piston-proxy.mjs

import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cfgPath = join(here, "piston.local.json");

let cfg;
try {
  cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
} catch {
  console.error(`Missing or invalid ${cfgPath}`);
  console.error("Copy piston.local.example.json to piston.local.json and fill it in.");
  process.exit(1);
}

const LISTEN_PORT = cfg.proxyPort || 2001;
const PISTON_PORT = cfg.pistonPort || 2000;
const AUTH_TOKEN = cfg.authToken;

if (!AUTH_TOKEN) {
  console.error("piston.local.json is missing authToken.");
  process.exit(1);
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ""));
  const bb = Buffer.from(String(b ?? ""));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const server = http.createServer((req, res) => {
  if (!safeEqual(req.headers["x-piston-key"], AUTH_TOKEN)) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("unauthorized");
    return;
  }

  const upstream = http.request(
    { host: "127.0.0.1", port: PISTON_PORT, path: req.url, method: req.method, headers: req.headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    console.error("Upstream (Piston) error:", err.message);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("piston unreachable");
  });
  req.pipe(upstream);
});

server.listen(LISTEN_PORT, () => {
  console.log(`Piston auth-proxy listening on http://localhost:${LISTEN_PORT} -> forwarding to :${PISTON_PORT}`);
});
