# Code Runner (Piston) Setup

The question pages have a **Run Code** panel (stdin + output console). The Worker
does **not** run code itself — it proxies each run to a **self-hosted
[Piston](https://github.com/engineer-man/piston)** instance you host, then shows
the output. Until `PISTON_URL` is set, the Run button simply shows
_"Code runner is not configured"_ and nothing else breaks.

The Worker auto-detects installed runtimes (it reads Piston's `/runtimes`), so
once Python / C++ / Java are installed, Run "just works" — no per-version config
in the Worker.

---

## 1. Get a host with Docker

Any always-on machine with Docker (a small VPS is fine). Piston needs
`--privileged` because it sandboxes untrusted code with nsjail.

## 2. Run Piston

```bash
docker run -d --name piston --restart unless-stopped --privileged \
  -p 2000:2000 -v piston_data:/piston ghcr.io/engineer-man/piston
```

(The named `piston_data` volume keeps installed languages across restarts.)

A **self-hosted** container serves its API at `http://<host>:2000/api/v2/...`
(note: **no `/piston` segment** — that was only the old public emkc gateway).
You'll set `PISTON_URL` to the bare host; the Worker appends `/api/v2`.

## 3. Install the three runtimes

Piston ships with **no** languages installed. Install via the packages API
(list versions first, then POST each):

```bash
# see available versions
curl http://<host>:2000/api/v2/packages

# install Python, C++ (from gcc), and Java (use versions from the list above)
curl -X POST http://<host>:2000/api/v2/packages -H 'Content-Type: application/json' -d '{"language":"python","version":"3.12.0"}'
curl -X POST http://<host>:2000/api/v2/packages -H 'Content-Type: application/json' -d '{"language":"gcc","version":"10.2.0"}'
curl -X POST http://<host>:2000/api/v2/packages -H 'Content-Type: application/json' -d '{"language":"java","version":"15.0.2"}'
```

- The gcc/java builds can take several minutes — the HTTP call may time out on
  your end while the server keeps building; just re-check `/runtimes`.
- Verify they're active: `curl http://<host>:2000/api/v2/runtimes` — you should
  see `python`, `java`, and **`c++`** (the gcc package provides `c`/`c++`).

> The student's language is fixed server-side from their login choice, so only
> these three matter. The Worker auto-resolves the highest installed version.

## 4. Expose it over HTTPS

The Worker fetches this URL server-side. Put a TLS front on Piston and note the
public base URL. Two easy options:

**Cloudflare Tunnel** (recommended — no open ports, since you're already on CF):

```bash
cloudflared tunnel --url http://localhost:2000
```

…or map a named tunnel to a hostname like `https://piston.yourdomain.com`.

**Or Caddy / nginx** as a TLS reverse proxy in front of `:2000`.

> **Security:** Piston runs untrusted student code. Even though it sandboxes and
> limits resources, keep the host isolated (no secrets on it) and firewall it so
> **only Cloudflare / your Worker** can reach it.

## 5. Point the Worker at it

The value can be the bare host (`https://piston.yourdomain.com`) or a full API
base (`.../api/v2`, or `.../api/v2/piston` for the old public gateway) — all are
handled.

**Production** (secret keeps the host private):

```bash
npx wrangler secret put PISTON_URL
# paste your URL when prompted
```

(Or, if you don't mind it being in the repo, add it under `[vars]` in
`wrangler.toml`.)

**Local dev** — add to `.dev.vars` (gitignored):

```
PISTON_URL=https://piston.yourdomain.com
```

## 6. Test

Open a question and click **Run Code**. Output appears in the console below the
editor, with the exit code / kill signal.

- _"Code runner is not configured"_ → `PISTON_URL` is unset.
- _"Could not reach the code runner"_ → URL wrong / host unreachable / firewall.
- _"Runner error: ... runtime is unknown"_ → that language isn't installed on
  Piston (re-run step 3).

## Limits (already enforced by the Worker)

| Setting          | Value   |
| ---------------- | ------- |
| Run timeout      | 5 s     |
| Compile timeout  | 10 s    |
| stdin cap        | 64 KB   |
| Output returned  | 100 KB  |
| Whole-request    | 15 s    |

Runs happen via an in-page fetch (no window focus change), so running code never
trips the exam's tab-switch / blur auto-submit.
