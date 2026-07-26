// Code execution client for Python, C++, and Java, backed by the free public
// Wandbox API (https://wandbox.org). Proxied server-side via POST /question/run
// so the language stays server-derived, CORS is a non-issue, and the run is an
// in-page fetch (no focus change, so it never trips the exam's tab/blur
// auto-submit). No self-hosting, auth, or tunnel required -- Wandbox is a
// public, unauthenticated compile-and-run endpoint.

import type { Env } from "./types";

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

const WANDBOX_COMPILE_URL = "https://wandbox.org/api/compile.json";
const EXEC_TIMEOUT_MS = 15000;

// Wandbox compiler target mapping
const WANDBOX_COMPILERS: Record<string, string> = {
  python: "cpython-3.14.0",
  cpp: "gcc-13.2.0",
  java: "openjdk-jdk-21+35",
};

// Wandbox always writes the submitted `code` to a fixed filename (prog.java
// for Java), which javac rejects for a `public class` whose name isn't
// literally "prog". Since Wandbox has no way to rename that file, strip the
// class-level `public` modifier -- a non-public top-level class has no
// filename constraint and still runs identically for a single-file compile.
// This only matches "public" directly preceding (optional modifiers then)
// "class", so "public static void main" is untouched.
function stripJavaPublicClassModifier(code: string): string {
  return code.replace(/\bpublic(\s+)(?=(?:(?:final|abstract|strictfp|sealed|non-sealed)\s+)*class\b)/g, "");
}

function injectCppCinExceptions(code: string): string {
  const helper = `#include <iostream>\n` +
    `struct __InitCinExceptions {\n` +
    `    __InitCinExceptions() {\n` +
    `        std::cin.exceptions(std::ios_base::failbit | std::ios_base::badbit);\n` +
    `    }\n` +
    `} __init_cin_exceptions;\n\n`;
  return helper + code;
}

interface WandboxResponse {
  status?: string;
  signal?: string;
  compiler_output?: string;
  compiler_error?: string;
  compiler_message?: string;
  program_output?: string;
  program_error?: string;
  program_message?: string;
  permlink?: string;
  url?: string;
}

export async function runCode(env: Env, input: RunInput): Promise<RunResult> {
  const empty: RunResult = {
    stdout: "",
    stderr: "",
    output: "",
    exitCode: null,
    signal: null,
    time: "",
  };

  const compiler = WANDBOX_COMPILERS[input.language] || WANDBOX_COMPILERS.python;
  let code = input.code || "";
  if (input.language === "java") {
    code = stripJavaPublicClassModifier(code);
  } else if (input.language === "cpp") {
    code = injectCppCinExceptions(code);
  }

  const payload = {
    compiler,
    code,
    stdin: input.stdin || "",
  };

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), EXEC_TIMEOUT_MS);

  try {
    const resp = await fetch(WANDBOX_COMPILE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    if (!resp.ok) {
      return {
        ...empty,
        error: "Code execution service is currently unavailable. Please try again in a moment.",
      };
    }

    const data = (await resp.json()) as WandboxResponse;

    const exitCodeStr = data.status ?? null;
    const exitCode = exitCodeStr !== null ? parseInt(exitCodeStr, 10) : null;
    const signal = data.signal || null;

    const compilerErr = data.compiler_error || data.compiler_output || data.compiler_message || "";
    const stdout = data.program_output || "";
    const stderr = data.program_error || "";

    let combined = "";
    if (compilerErr.trim().length > 0 && stdout.length === 0 && stderr.length === 0) {
      combined = compilerErr;
    } else {
      combined = data.program_message || (stdout + stderr);
      if (compilerErr && !combined.includes(compilerErr)) {
        combined = compilerErr + "\n" + combined;
      }
    }

    return {
      stdout,
      stderr,
      output: combined,
      exitCode: Number.isNaN(exitCode) ? null : exitCode,
      signal,
      time: "",
    };
  } catch (e) {
    return {
      ...empty,
      error: "Code execution service is currently unavailable. Please try again in a moment.",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
