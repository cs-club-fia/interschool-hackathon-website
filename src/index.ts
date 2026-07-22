// Worker entry point: routing + request handlers. Static assets under ./public
// are served by the platform before this runs; everything else lands here.

import type { Env, Session } from "./types";
import {
  getSession,
  verifyPassword,
  createSessionValue,
  sessionCookieHeader,
  clearCookieHeader,
  csrfTokenFor,
  checkCsrf,
  findStudent,
  findAdmin,
  allStudents,
} from "./auth";
import { QUESTIONS, QUESTION_ORDER, extensionForLanguage } from "./data/questions";
import * as db from "./db";
import {
  renderLogin,
  renderStartTest,
  renderDashboard,
  renderQuestion,
  renderReview,
  renderAdmin,
} from "./render";
import { zipSync, strToU8 } from "fflate";

const MAX_CODE_BYTES = 1_000_000; // ~1 MB; a single source file never needs more

// --- Response helpers ---
function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });
}
function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...headers } });
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function nextQuestion(qname: string): string | null {
  const idx = QUESTION_ORDER.indexOf(qname);
  if (idx < 0 || idx >= QUESTION_ORDER.length - 1) return null;
  return QUESTION_ORDER[idx + 1];
}

function studentInfoMap(): Record<string, { school?: string; language?: string }> {
  const map: Record<string, { school?: string; language?: string }> = {};
  for (const s of allStudents()) map[s.username] = { school: s.school, language: s.language };
  return map;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      console.error("Unhandled error:", err instanceof Error ? err.stack : err);
      return new Response("An error occurred. Please contact admin.", { status: 500 });
    }
  },
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const session = await getSession(request, env);

  // --- Login ---
  if (path === "/" && method === "GET") {
    if (session) return redirect(session.is_admin ? "/admin" : "/dashboard");
    return html(renderLogin(null));
  }
  if (path === "/" && method === "POST") {
    const form = await request.formData();
    const username = String(form.get("username") || "");
    const password = String(form.get("password") || "");
    const student = findStudent(username);
    if (student && (await verifyPassword(student.password_hash, password))) {
      const value = await createSessionValue(env, mkSession(username, false));
      return redirect("/dashboard", { "Set-Cookie": sessionCookieHeader(value) });
    }
    const admin = findAdmin(username);
    if (admin && (await verifyPassword(admin.password_hash, password))) {
      const value = await createSessionValue(env, mkSession(username, true));
      return redirect("/admin", { "Set-Cookie": sessionCookieHeader(value) });
    }
    return html(renderLogin("Invalid credentials"), 401);
  }

  // --- Logout (student + admin share behaviour) ---
  if ((path === "/logout" || path === "/admin/logout") && method === "POST") {
    if (!session) return redirect("/");
    if (!(await checkCsrf(request, env, session))) return new Response("Bad CSRF token", { status: 400 });
    return redirect("/", { "Set-Cookie": clearCookieHeader() });
  }

  // --- Student pages ---
  if (path === "/dashboard" && method === "GET") {
    const guard = requireStudent(session);
    if (guard) return guard;
    const s = session as Session;
    if (!(await db.hasStarted(env, s.u))) {
      return html(renderStartTest(s.u, await csrfTokenFor(env, s)));
    }
    const submitted = await db.getStudentSubmitted(env, s.u);
    let currentQuestion: string | null = null;
    for (const q of QUESTION_ORDER) {
      if (!submitted[q]) {
        currentQuestion = q;
        break;
      }
    }
    const student = findStudent(s.u);
    return html(
      renderDashboard({
        username: s.u,
        school: student?.school,
        language: student?.language,
        questions: QUESTION_ORDER,
        submitted,
        currentQuestion,
        csrfToken: await csrfTokenFor(env, s),
      }),
    );
  }

  if (path === "/start_test" && method === "GET") {
    const guard = requireStudent(session);
    if (guard) return guard;
    const s = session as Session;
    return html(renderStartTest(s.u, await csrfTokenFor(env, s)));
  }

  if (path === "/question" && method === "GET") {
    const guard = requireStudent(session);
    if (guard) return guard;
    const s = session as Session;
    const qname = url.searchParams.get("qname");
    if (!qname || !QUESTIONS[qname]) return redirect("/dashboard");
    if (!(await db.canAccess(env, s.u, qname))) return redirect("/review");
    await db.startTimer(env, s.u, qname);
    const student = findStudent(s.u);
    return html(
      renderQuestion({
        qname,
        timeLeft: await db.getTimeLeft(env, s.u, qname),
        questionText: QUESTIONS[qname].text,
        expectedExt: extensionForLanguage(student?.language),
        language: student?.language || "python",
        draftCode: await db.getDraft(env, s.u, qname),
        csrfToken: await csrfTokenFor(env, s),
      }),
    );
  }

  if (path === "/question" && method === "POST") {
    const guard = requireStudent(session);
    if (guard) return guard;
    const s = session as Session;
    if (!(await checkCsrf(request, env, session as Session)))
      return new Response("Bad CSRF token", { status: 400 });
    const qname = url.searchParams.get("qname");
    if (!qname || !QUESTIONS[qname]) return redirect("/dashboard");
    const form = await request.formData();
    const autoSubmit = form.get("auto_submit") === "1";
    const student = findStudent(s.u);

    if (autoSubmit) {
      let code = String(form.get("code") || "");
      if (!code) code = (await db.getDraft(env, s.u, qname)) || "# auto-submitted empty file\n";
      code = clampCode(code);
      await db.submitAnswer(env, s.u, qname, code);
      const next = nextQuestion(qname);
      return redirect(next ? `/question?qname=${encodeURIComponent(next)}` : "/review");
    }

    const code = clampCode(String(form.get("code") || ""));
    if (!code.trim()) {
      return html(
        renderQuestion({
          qname,
          timeLeft: await db.getTimeLeft(env, s.u, qname),
          questionText: QUESTIONS[qname].text,
          expectedExt: extensionForLanguage(student?.language),
          language: student?.language || "python",
          draftCode: code,
          csrfToken: await csrfTokenFor(env, s),
          error: "No code submitted",
        }),
      );
    }
    await db.submitAnswer(env, s.u, qname, code);
    const next = nextQuestion(qname);
    return redirect(next ? `/question?qname=${encodeURIComponent(next)}` : "/review");
  }

  if (path === "/review" && method === "GET") {
    const guard = requireStudent(session);
    if (guard) return guard;
    const s = session as Session;
    return html(
      renderReview({
        review: await db.getStudentReview(env, s.u),
        order: QUESTION_ORDER,
        csrfToken: await csrfTokenFor(env, s),
      }),
    );
  }

  // --- Student POST endpoints (fetch, CSRF via header) ---
  if (path === "/question/draft" && method === "POST") {
    const guard = requireStudentApi(session);
    if (guard) return guard;
    const s = session as Session;
    if (!(await checkCsrf(request, env, s))) return new Response("", { status: 400 });
    const form = await request.formData();
    const qname = String(form.get("qname") || "");
    if (!qname) return new Response("", { status: 400 });
    await db.saveDraft(env, s.u, qname, clampCode(String(form.get("code") || "")));
    return new Response(null, { status: 204 });
  }

  if (path === "/student/leave" && method === "POST") {
    const guard = requireStudentApi(session);
    if (guard) return guard;
    const s = session as Session;
    if (!(await checkCsrf(request, env, s))) return new Response("", { status: 400 });
    await db.incrementLeaveCount(env, s.u);
    return new Response(null, { status: 204 });
  }

  if (path === "/student/paste-flag" && method === "POST") {
    const guard = requireStudentApi(session);
    if (guard) return guard;
    const s = session as Session;
    if (!(await checkCsrf(request, env, s))) return new Response("", { status: 400 });
    await db.incrementPasteFlagCount(env, s.u);
    return new Response(null, { status: 204 });
  }

  // --- Admin ---
  if (path === "/admin" && method === "GET") {
    const guard = requireAdmin(session);
    if (guard) return guard;
    const s = session as Session;
    const students = allStudents().map((x) => x.username);
    const submissions = await db.getAllSubmissions(env, students);
    return html(
      renderAdmin({
        userCount: await db.countActiveUsers(env),
        submissions,
        questions: QUESTION_ORDER,
        studentInfo: studentInfoMap(),
        leaveCounts: await db.getLeaveCounts(env, students),
        pasteFlagCounts: await db.getPasteFlagCounts(env, students),
        activeUsers: await db.countActiveUsers(env),
        totalSubmissions: await db.countSubmissions(env),
        csrfToken: await csrfTokenFor(env, s),
        successMessage: url.searchParams.get("reset") === "1" ? "Database successfully reset. All submissions have been cleared." : null,
      }),
    );
  }

  if (path === "/admin/stats" && method === "GET") {
    if (!session || !session.is_admin) return new Response("", { status: 403 });
    return json({
      activeUsers: await db.countActiveUsers(env),
      totalSubmissions: await db.countSubmissions(env),
    });
  }

  if (path === "/admin/reset" && method === "POST") {
    const guard = requireAdmin(session);
    if (guard) return guard;
    if (!(await checkCsrf(request, env, session as Session)))
      return new Response("Bad CSRF token", { status: 400 });
    await db.resetSubmissions(env);
    return redirect("/admin?reset=1");
  }

  // --- Admin downloads (the critical feature) ---
  if (path.startsWith("/admin/download/") && method === "GET") {
    const guard = requireAdmin(session);
    if (guard) return guard;
    const parts = path.split("/"); // ["", "admin", "download", username, qname]
    if (parts.length !== 5) return new Response("Not found", { status: 404 });
    const username = decodeURIComponent(parts[3]);
    const qname = decodeURIComponent(parts[4]);
    const code = await db.getSubmissionCode(env, username, qname);
    if (code == null) return new Response("File not found", { status: 404 });
    const ext = extensionForLanguage(findStudent(username)?.language);
    const filename = `${safeName(username)}_${safeName(qname)}.${ext}`;
    return new Response(code, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  if (path === "/admin/download-all" && method === "GET") {
    const guard = requireAdmin(session);
    if (guard) return guard;
    const all = await db.getAllSubmittedCode(env);
    const files: Record<string, Uint8Array> = {};
    for (const row of all) {
      const ext = extensionForLanguage(findStudent(row.username)?.language);
      files[`${safeName(row.username)}/${safeName(row.question)}.${ext}`] = strToU8(row.code);
    }
    if (Object.keys(files).length === 0) {
      files["README.txt"] = strToU8("No submissions yet.\n");
    }
    const zipped = zipSync(files, { level: 6 });
    // Copy into a fresh ArrayBuffer so the body is a valid BodyInit.
    const body = zipped.slice();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="hackathon-submissions.zip"',
      },
    });
  }

  if (path === "/favicon.ico") return new Response(null, { status: 204 });

  return new Response("Not found", { status: 404 });
}

// --- session helpers ---
function mkSession(username: string, isAdmin: boolean): Session {
  return { u: username, is_admin: isAdmin, iat: Math.floor(Date.now() / 1000) };
}

// Page guards: redirect to an appropriate page.
function requireStudent(session: Session | null): Response | null {
  if (!session) return redirect("/");
  if (session.is_admin) return redirect("/admin");
  return null;
}
function requireAdmin(session: Session | null): Response | null {
  if (!session) return redirect("/");
  if (!session.is_admin) return redirect("/dashboard");
  return null;
}
// API guards: 403 instead of redirect.
function requireStudentApi(session: Session | null): Response | null {
  if (!session || session.is_admin) return new Response("", { status: 403 });
  return null;
}

function clampCode(code: string): string {
  // Guard against oversized submissions (parity with the old 2 MB cap).
  if (code.length > MAX_CODE_BYTES) return code.slice(0, MAX_CODE_BYTES);
  return code;
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}
