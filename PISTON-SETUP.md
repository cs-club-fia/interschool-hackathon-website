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
docker run -d --name piston --restart always --privileged \
  -p 2000:2000 ghcr.io/engineer-man/piston
```

The API base is now `http://<host>:2000/api/v2/piston`.

## 3. Install the three runtimes

Piston ships with **no** languages installed. Install Python, C++ (gcc), and Java:

```bash
docker exec piston /piston/packages/.build/ppman install python
docker exec piston /piston/packages/.build/ppman install gcc     # provides C++
docker exec piston /piston/packages/.build/ppman install java
```

- To see what's available first: `curl http://<host>:2000/api/v2/packages`
- Verify they're active: `curl http://<host>:2000/api/v2/runtimes`
  — you should see entries for `python`, `c++`, and `java`.

> The student's language is fixed server-side from their login choice, so only
> these three matter. The Worker picks the highest installed version of each.

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

The value can be either the host (`https://piston.yourdomain.com`) or the full
API base (`https://piston.yourdomain.com/api/v2/piston`) — both are handled.

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
