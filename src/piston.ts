// Thin client for a self-hosted Piston code-execution instance, used by the
// question-page "Run" panel (POST /question/run). The Worker proxies runs so the
// host URL stays server-side, CORS is a non-issue, and runs stay inside the
// sealed exam (an in-page fetch causes no focus change, so the anti-cheat
// blur/tab auto-submit never fires from running code).
//
// Everything here fails soft: any misconfiguration, unreachable host, or
// malformed response is turned into a RunResult with `error` set, so the
// endpoint can always return clean JSON to the browser.

import type { Env } from "./types";

// Our internal language keys (from logins.json / questions.ts) mapped to the
// Piston language name plus the source filename to compile. Java's filename is
// special-cased below (it must match the public class name).
const LANG: Record<string, { piston: string; file: string }> = {
  python: { piston: "python", file: "main.py" },
  cpp: { piston: "c++", file: "main.cpp" },
  java: { piston: "java", file: "Main.java" },
};

const EXEC_TIMEOUT_MS = 15000; // hard ceiling on the whole outbound request
const RUN_TIMEOUT_MS = 5000; // Piston-side wall-clock limit for the program
const COMPILE_TIMEOUT_MS = 10000; // Piston-side limit for compiled languages
const MAX_STDIN_BYTES = 64 * 1024; // plenty for competitive-style input
const MAX_OUTPUT_CHARS = 100 * 1000; // cap what we hand back to the browser

export interface RunInput {
  language: string;
  code: string;
  stdin: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  output: string; // combined text to show (compile errors folded in)
  exitCode: number | null;
  signal: string | null;
  time: string; // human label like "0.04s", or "" if unknown
  error?: string; // set when the run could not be performed at all
}

// In-isolate cache of language -> version, resolved from Piston's /runtimes.
// Workers isolates are ephemeral, so this is best-effort (re-fetched after TTL
// or on a cold isolate); it just avoids a /runtimes round-trip on every run.
let runtimeCache: { at: number; map: Record<string, string> } | null = null;
const RUNTIME_TTL_MS = 5 * 60 * 1000;

// Normalize whatever the operator configured into the Piston API base that ends
// at ".../api/v2/piston" (no trailing slash), so we can append /execute and
// /runtimes. Accepts a bare host or a full API base.
function apiBase(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (!/\/api\/v2\/piston$/.test(u)) u = u + "/api/v2/piston";
  return u;
}

// Java requires the file name to match the public class. Derive it from the
// source so `public class Solution { ... }` compiles as Solution.java; fall back
// to Main.java when there is no public class (the default template).
function javaFileName(code: string): string {
  const m = code.match(/public\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
  return m ? m[1] + ".java" : "Main.java";
}

// One HTTP round-trip to the runner. Throws only on network failure / timeout /
// abort or an unreadable body; a non-2xx status is returned (not thrown) so the
// caller can surface Piston's own error message (e.g. an unknown runtime).
interface HttpJson {
  ok: boolean;
  status: number;
  data: unknown;
}
async function httpJson(url: string, init: RequestInit, timeoutMs: number): Promise<HttpJson> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await resp.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("Non-JSON response from runner: " + text.slice(0, 300));
    }
    return { ok: resp.ok, status: resp.status, data };
  } finally {
    clearTimeout(t);
  }
}

// Resolve the version to request for a Piston language, caching the /runtimes
// result. Returns "*" if the lookup fails -- recent Piston accepts a wildcard,
// and if it doesn't, /execute will surface a clear error we pass through.
async function resolveVersion(base: string, pistonLang: string): Promise<string> {
  const now = Date.now();
  if (runtimeCache && now - runtimeCache.at < RUNTIME_TTL_MS) {
    return runtimeCache.map[pistonLang] || "*";
  }
  try {
    const res = await httpJson(base + "/runtimes", { method: "GET" }, EXEC_TIMEOUT_MS);
    const data = res.ok ? res.data : null;
    const map: Record<string, string> = {};
    if (Array.isArray(data)) {
      for (const rt of data as Array<{ language?: string; version?: string; aliases?: string[] }>) {
        if (!rt || !rt.version) continue;
        const names = [rt.language, ...(rt.aliases || [])].filter(Boolean) as string[];
        for (const n of names) {
          // Keep the highest version seen for each name.
          if (!map[n] || cmpVersion(rt.version, map[n]) > 0) map[n] = rt.version;
        }
      }
    }
    runtimeCache = { at: now, map };
    return map[pistonLang] || "*";
  } catch {
    return "*";
  }
}

// Compare dotted numeric versions ("3.10.0" vs "3.9.4"); returns >0 if a>b.
function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function clampOutput(s: string): string {
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  return s.slice(0, MAX_OUTPUT_CHARS) + "\n...(output truncated)";
}

function clampStdin(s: string): string {
  // Trim to the byte cap without splitting a UTF-16 surrogate pair.
  if (new TextEncoder().encode(s).length <= MAX_STDIN_BYTES) return s;
  return s.slice(0, MAX_STDIN_BYTES);
}

interface PistonStage {
  stdout?: string;
  stderr?: string;
  output?: string;
  code?: number | null;
  signal?: string | null;
}
interface PistonResponse {
  run?: PistonStage;
  compile?: PistonStage;
  message?: string; // present on API-level errors (e.g. unknown runtime)
}

export async function runCode(env: Env, input: RunInput): Promise<RunResult> {
  const empty: RunResult = { stdout: "", stderr: "", output: "", exitCode: null, signal: null, time: "" };

  if (!env.PISTON_URL) {
    return { ...empty, error: "Code runner is not configured." };
  }
  const lang = LANG[input.language] || LANG.python;
  const fileName = input.language === "java" ? javaFileName(input.code) : lang.file;
  const base = apiBase(env.PISTON_URL);

  const version = await resolveVersion(base, lang.piston);

  const payload = {
    language: lang.piston,
    version,
    files: [{ name: fileName, content: input.code }],
    stdin: clampStdin(input.stdin || ""),
    compile_timeout: COMPILE_TIMEOUT_MS,
    run_timeout: RUN_TIMEOUT_MS,
  };

  let res: HttpJson;
  try {
    res = await httpJson(
      base + "/execute",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      EXEC_TIMEOUT_MS,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Abort => timeout; a bad body is a misbehaving host; else unreachable.
    const friendly = /aborted|abort/i.test(msg)
      ? "The code runner timed out. Try again."
      : /non-json/i.test(msg)
        ? "The code runner returned an unexpected response."
        : "Could not reach the code runner. Please try again in a moment.";
    return { ...empty, error: friendly };
  }

  const data = (res.data || {}) as PistonResponse;

  // Piston reports request-level problems (unknown runtime/version, bad payload)
  // with a non-2xx status and a { message } body -- surface that instead of a
  // generic error, so misconfiguration is diagnosable.
  if (!res.ok) {
    const m = data && data.message ? String(data.message) : "HTTP " + res.status;
    return { ...empty, error: "Runner error: " + m.slice(0, 300) };
  }

  const run = data.run || {};
  const compile = data.compile || {};
  const compileFailed = compile.code != null && compile.code !== 0;

  const stdout = String(run.stdout || "");
  const stderr = String(run.stderr || "");

  // Show compile diagnostics first when compilation failed; otherwise show the
  // program's own stdout+stderr.
  let combined: string;
  if (compileFailed) {
    combined = String(compile.output || compile.stderr || compile.stdout || "Compilation failed.");
  } else {
    combined = String(run.output || stdout + stderr);
  }

  const exitCode = compileFailed
    ? (compile.code as number)
    : run.code == null
      ? null
      : Number(run.code);
  const signal = run.signal ? String(run.signal) : null;

  return {
    stdout: clampOutput(stdout),
    stderr: clampOutput(stderr),
    output: clampOutput(combined),
    exitCode,
    signal,
    time: "",
  };
}
