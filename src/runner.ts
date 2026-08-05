// Code-runner dispatcher. Chooses the execution backend at REQUEST time from a
// D1 config row, so the runner can be switched mid-event with one D1 write and
// no redeploy:
//
//   UPDATE/INSERT config SET value=... WHERE key='code_runner'
//     (absent) | "wandbox"  -> Wandbox only        [DEFAULT - today's behaviour]
//     "piston"             -> self-hosted Piston only
//     "auto"               -> Piston first, Wandbox if the runner itself fails
//
// Deploying this file changes NOTHING until that row is set: an absent row
// resolves to "wandbox", which is exactly what shipped before. That is
// deliberate -- a deploy during a live exam must be behaviourally inert until
// an operator opts in.

import type { Env, RunInput, RunResult } from "./types";
import { getConfig } from "./db";
import { runCode as runWandbox } from "./wandbox";
import { runCode as runPiston, pistonConfiguredUrl } from "./piston";

export type RunnerMode = "wandbox" | "piston" | "auto";

const DEFAULT_MODE: RunnerMode = "wandbox";

// Resolve the configured mode, failing safe to the default if the config table
// is missing or holds an unrecognised value.
export async function resolveMode(env: Env): Promise<RunnerMode> {
  let raw: string | null = null;
  try {
    raw = await getConfig(env, "code_runner");
  } catch {
    return DEFAULT_MODE; // config table absent -> behave as before
  }
  const v = (raw || "").trim().toLowerCase();
  if (v === "piston" || v === "wandbox" || v === "auto") return v;
  return DEFAULT_MODE;
}

export async function runCode(env: Env, input: RunInput): Promise<RunResult> {
  const mode = await resolveMode(env);

  if (mode === "wandbox") return runWandbox(env, input);

  if (mode === "piston") return runPiston(env, input);

  // --- auto: prefer Piston, fall back to Wandbox ---
  // Skip the Piston round-trip entirely when it was never configured.
  const configured = await pistonConfiguredUrl(env);
  if (!configured) return runWandbox(env, input);

  const viaPiston = await runPiston(env, input);
  // `error` is set ONLY for runner-level failures (unreachable/timeout/
  // misconfigured). A program that merely failed to compile or crashed leaves it
  // unset, so a student's genuine error is never hidden behind a silent retry on
  // the other backend.
  if (!viaPiston.error) return viaPiston;

  const viaWandbox = await runWandbox(env, input);
  if (!viaWandbox.error) return viaWandbox;

  // Both backends are down -- report one clear message rather than leaking two.
  return {
    stdout: "",
    stderr: "",
    output: "",
    exitCode: null,
    signal: null,
    time: "",
    error: "Code execution is temporarily unavailable. Your work is still saved -- keep coding and submit as normal.",
  };
}
