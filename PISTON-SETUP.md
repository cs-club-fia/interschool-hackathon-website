# Code Runner (Piston) Setup

The question pages have a **Run Code** panel (stdin + output console). The Worker
does **not** run code itself — it proxies each run to a **self-hosted
[Piston](https://github.com/engineer-man/piston)** instance you host, then shows
the output. Until a Piston URL is configured, the Run button simply shows
_"Code runner is not configured"_ and nothing else breaks.

The Worker auto-detects installed runtimes (it reads Piston's `/runtimes`), so
once Python / C++ / Java are installed, Run "just works" — no per-version config
in the Worker.

---

## 1. Get a host with Docker

Any always-on machine with Docker (a small VPS, or your own laptop for an
event). Piston needs `--privileged` because it sandboxes untrusted code with
nsjail.

## 2. Run Piston

```bash
docker run -d --name piston --restart unless-stopped --privileged \
  -p 2000:2000 -v piston_data:/piston ghcr.io/engineer-man/piston
```

(The named `piston_data` volume keeps installed languages across restarts.)

A **self-hosted** container serves its API at `http://<host>:2000/api/v2/...`
(note: **no `/piston` segment** — that was only the old public emkc gateway).

## 3. Install the three runtimes

Piston ships with **no** languages installed. Install via the packages API
(list versions first, then POST each):

```bash
# see available versions
curl http://localhost:2000/api/v2/packages

# install Python, C++ (from gcc), and Java (use versions from the list above)
curl -X POST http://localhost:2000/api/v2/packages -H 'Content-Type: application/json' -d '{"language":"python","version":"3.12.0"}'
curl -X POST http://localhost:2000/api/v2/packages -H 'Content-Type: application/json' -d '{"language":"gcc","version":"10.2.0"}'
curl -X POST http://localhost:2000/api/v2/packages -H 'Content-Type: application/json' -d '{"language":"java","version":"15.0.2"}'
```

- The gcc/java builds can take several minutes — the HTTP call may time out on
  your end while the server keeps building; just re-check `/runtimes`.
- Verify they're active: `curl http://localhost:2000/api/v2/runtimes` — you
  should see `python`, `java`, and **`c++`** (the gcc package provides `c`/`c++`).

> The student's language is fixed server-side from their login choice, so only
> these three matter. The Worker auto-resolves the highest installed version.

## 4. Lock it down + expose it: the auth-proxy and tunnel scripts

Piston itself has **no authentication** — anyone who reaches its API can run
arbitrary code on your host. Don't expose port 2000 directly. Instead this repo
ships two small local scripts that (a) put a shared-secret gate in front of
Piston, and (b) keep the Worker's copy of the tunnel URL current automatically,
since a Cloudflare **quick tunnel** always mints a brand-new hostname every time
it (re)starts.

**One-time setup:**

```bash
cd scripts
cp piston.local.example.json piston.local.json
```

Edit `piston.local.json` and fill in two random secrets (any long random string
works, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
run twice):

```json
{
  "workerUrl": "https://interschool-hackathon-fia.csclub.workers.dev",
  "adminToken": "<random secret #1>",
  "authToken": "<random secret #2>",
  "proxyPort": 2001,
  "pistonPort": 2000
}
```

- `authToken` — the Worker sends this as `X-Piston-Key` on every run; the local
  proxy (`piston-proxy.mjs`) only forwards requests that carry it.
- `adminToken` — the tunnel script uses this as a bearer token to tell the
  Worker "here's the new tunnel URL" via `POST /internal/piston-url`. Without
  the matching token, that endpoint refuses the update.

**Set the matching secrets on the Worker** (one-time, or whenever you rotate
them):

```bash
npx wrangler secret put PISTON_AUTH_TOKEN    # paste piston.local.json's authToken
npx wrangler secret put PISTON_ADMIN_TOKEN   # paste piston.local.json's adminToken
```

**Every time you run the event**, instead of the old bare `cloudflared tunnel
--url ...` command, run:

```powershell
cd scripts
.\piston-tunnel.ps1
```

This starts the auth-proxy (port 2001 → forwards to Piston on 2000 only when the
secret header is present), starts the tunnel pointed at the *proxy* (not
Piston directly), watches cloudflared's output for its `https://*.trycloudflare.com`
URL, and POSTs it straight to the Worker. If cloudflared ever drops and
restarts (new random hostname), the script detects the new URL and updates the
Worker again automatically — no manual `wrangler secret put` step, ever.

Leave that PowerShell window open for the whole event (alongside Docker
Desktop). Ctrl+C stops both the tunnel and the auth-proxy cleanly.

> **Prefer to skip the auth-proxy / auto-update entirely?** You can still run a
> bare `cloudflared tunnel --url http://localhost:2000` and `wrangler secret put
> PISTON_URL` by hand like before — the Worker falls back to that if no D1
> config value or `PISTON_AUTH_TOKEN` is set. Not recommended: the tunnel URL
> would then be a public, unauthenticated code-execution endpoint.

## 5. Test

Open a question and click **Run Code**. Output appears in the console below the
editor, with the exit code / kill signal.

- _"Code runner is not configured"_ → no Piston URL set anywhere yet (D1 config
  empty and `PISTON_URL` unset) — start `piston-tunnel.ps1`.
- _"Could not reach the code runner"_ → tunnel down, proxy down, or Piston
  itself unreachable.
- _"Runner error: ... runtime is unknown"_ → that language isn't installed on
  Piston (re-run step 3).
- A `401`/"unauthorized" from the proxy's own logs means `PISTON_AUTH_TOKEN`
  (Worker secret) and `authToken` (piston.local.json) don't match.

## Limits (already enforced by the Worker)

| Setting          | Value   |
| ---------------- | ------- |
| Run timeout      | 3 s     |
| Compile timeout  | 10 s    |
| stdin cap        | 64 KB   |
| Output returned  | 100 KB  |
| Whole-request    | 15 s    |

Runs happen via an in-page fetch (no window focus change), so running code never
trips the exam's tab-switch / blur auto-submit.
