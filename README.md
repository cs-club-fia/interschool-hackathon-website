# Interschool Hackathon — Cloudflare Workers + D1

In-browser coding quiz for the interschool hackathon. One Cloudflare **Worker**
(TypeScript) serves the static frontend from `public/` and renders the dynamic
pages; all state (submissions incl. student code, drafts, anti-cheat metrics)
lives in **D1** (serverless SQLite) so it survives redeploys.

Re-platformed from the original Flask app — full feature parity: team/admin
login, server-authoritative per-question timers, embedded CodeMirror editor with
paste-blocking, draft autosave, tab-leave + paste-flag anti-cheat metrics, admin
dashboard, and **downloadable submissions** (per file or all-as-ZIP).

## Layout
```
src/            Worker source (index.ts router, auth.ts, db.ts, render.ts, data/)
public/         Static assets served verbatim (CodeMirror, CSS, editor.js, timer.js, img/)
migrations/     D1 schema (0001_init.sql)
scripts/        gen-hash.mjs — hash a password for logins.json
wrangler.toml   Worker + D1 config
```

## Local development
```bash
npm install
echo "SECRET_KEY=some-long-random-string" > .dev.vars   # gitignored
npm run d1:init:local        # apply migrations to the LOCAL D1
npm run dev                  # http://127.0.0.1:8787
```
Placeholder logins (change before the event — see below):
`team1 / team1pass`, `team2 / team2pass`, `admin / adminpass`.

Inspect local data:
```bash
npx wrangler d1 execute hackathon --local --command "SELECT username,question,submitted,length(code) FROM submissions"
```

## First-time Cloudflare setup (deploy)
```bash
npx wrangler login
npx wrangler d1 create hackathon      # copy the printed database_id into wrangler.toml
npx wrangler d1 migrations apply hackathon --remote
npx wrangler secret put SECRET_KEY    # paste a long random string
npx wrangler deploy                   # prints the *.workers.dev URL
```
After the first deploy, `npm run deploy` (or a connected GitHub repo) redeploys.
Submissions persist across deploys; D1 Time Travel gives 7-day point-in-time
recovery on the free plan.

## Event configuration
- **Questions & timers:** edit `src/data/questions.ts` (`QUESTIONS` text +
  `seconds`), then redeploy. Order in that file is the question order.
- **Teams / admin:** edit `src/data/logins.json`, then redeploy. Each team has
  `username`, `password_hash`, `school`, and `language` (`python` | `cpp` |
  `java` — sets the download file extension). Generate a hash with:
  ```bash
  npm run hash "theTeamPassword"
  ```
  and paste the output into `password_hash`.

## Downloading submissions (admins)
On the admin dashboard: click a ✔ to download that team's file for that
question, or **Download all (ZIP)** to export everything as
`<team>/<question>.<ext>`. Files are generated on the fly from D1 — nothing is
stored on disk.

## Notes
- Auth is a stateless signed cookie (HMAC-SHA256 over `SECRET_KEY`); passwords
  are PBKDF2-HMAC-SHA256 (WebCrypto). Rotating `SECRET_KEY` logs everyone out.
- No SocketIO/psutil/SSL from the old app — TLS is terminated by Cloudflare, and
  the admin dashboard polls `/admin/stats` (active users / submission count).
- Server logs: `npx wrangler tail`.
