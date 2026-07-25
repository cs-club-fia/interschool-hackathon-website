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
import { getQuestion, extensionForLanguage, normalizeLanguage } from "./data/questions";
import * as db from "./db";
import { runCode } from "./wandbox";
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

// Next question in the student's own assignment order (null if last).
function nextQuestion(assignmentIds: string[], qname: string): string | null {
  const idx = assignmentIds.indexOf(qname);
  if (idx < 0 || idx >= assignmentIds.length - 1) return null;
  return assignmentIds[idx + 1];
}

// First not-yet-submitted question in assignment order (null if all done).
function currentQuestionOf(assignmentIds: string[], submitted: Record<string, boolean>): string | null {
  for (const id of assignmentIds) if (!submitted[id]) return id;
  return null;
}

// Prepend the question (title + full prompt) as a language-appropriate comment
// block above a downloaded submission, so a grader always knows what the student
// was solving -- essential now that every student's questions are random.
function withQuestionHeader(
  code: string,
  q: { title: string; text: string } | undefined,
  language: string,
): string {
  if (!q) return code;
  const p = language === "python" ? "#" : "//";
  const bar = `${p} ${"=".repeat(58)}`;
  const lines = [
    bar,
    `${p} Question: ${q.title}`,
    bar,
    ...q.text.split("\n").map((l) => (l ? `${p} ${l}` : p)),
    bar,
    "",
    "",
  ];
  return lines.join("\n") + code;
}

// Effective language for one student: their login-screen choice, else the
// bundled config default, else Python.
async function langFor(env: Env, username: string): Promise<string> {
  return normalizeLanguage(await db.getStudentLanguage(env, username), findStudent(username)?.language);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Fail closed if the session-signing secret is missing/weak, so a
    // misconfigured deploy can't fall back to an empty, forgeable HMAC key.
    if (!env.SECRET_KEY || env.SECRET_KEY.length < 32) {
      console.error(
        "SECRET_KEY is unset or too short (need >= 32 chars). Run: wrangler secret put SECRET_KEY",
      );
      return new Response("Server misconfiguration: SECRET_KEY not set.", { status: 500 });
    }
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
    const chosenLang = String(form.get("language") || "");
    const student = findStudent(username);
    if (student && (await verifyPassword(student.password_hash, password))) {
      // Persist the language chosen on the login screen. It is locked once the
      // test has started (see db.setStudentLanguageOnLogin).
      await db.setStudentLanguageOnLogin(
        env,
        username,
        normalizeLanguage(chosenLang, student.language),
      );
      const value = await createSessionValue(env, mkSession(username, false));
      return redirect("/dashboard", { "Set-Cookie": sessionCookieHeader(value) });
    }
    const admin = findAdmin(username);
    if (admin && (await verifyPassword(admin.password_hash, password))) {
      const value = await createSessionValue(env, mkSession(username, true));
      return redirect("/admin", { "Set-Cookie": sessionCookieHeader(value) });
    }
    // Preserve the student's language pick across a failed attempt.
    return html(renderLogin("Invalid credentials", chosenLang || undefined), 401);
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
    const assignmentIds = (await db.getAssignment(env, s.u)).map((a) => a.questionId);
    const submitted = await db.getStudentSubmitted(env, s.u);
    const student = findStudent(s.u);
    return html(
      renderDashboard({
        username: s.u,
        school: student?.school,
        grade: student?.grade,
        language: await langFor(env, s.u),
        questions: assignmentIds,
        submitted,
        currentQuestion: currentQuestionOf(assignmentIds, submitted),
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

  // Begin the test: draw (once) this student's random question set for their
  // grade, then send them to their current question. Idempotent -- a refresh
  // returns the same set. Reached from the "Start Test" button.
  if (path === "/begin" && method === "GET") {
    const guard = requireStudent(session);
    if (guard) return guard;
    const s = session as Session;
    const grade = findStudent(s.u)?.grade;
    const assignment = await db.drawAssignment(env, s.u, grade);
    const ids = assignment.map((a) => a.questionId);
    const submitted = await db.getStudentSubmitted(env, s.u);
    const current = currentQuestionOf(ids, submitted);
    return redirect(current ? `/question?qname=${encodeURIComponent(current)}` : "/review");
  }

  if (path === "/question" && method === "GET") {
    const guard = requireStudent(session);
    if (guard) return guard;
    const s = session as Session;
    const qname = url.searchParams.get("qname");
    const q = qname ? getQuestion(qname) : undefined;
    if (!qname || !q) return redirect("/dashboard");
    if (!(await db.canAccess(env, s.u, qname))) return redirect("/review");
    await db.startTimer(env, s.u, qname);
    const lang = await langFor(env, s.u);
    const qnum = (await db.getAssignment(env, s.u)).findIndex((a) => a.questionId === qname) + 1;
    return html(
      renderQuestion({
        qname,
        qnum,
        timeLeft: await db.getTimeLeft(env, s.u, qname),
        questionText: q.text,
        expectedExt: extensionForLanguage(lang),
        language: lang,
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
    const q = qname ? getQuestion(qname) : undefined;
    if (!qname || !q) return redirect("/dashboard");
    const form = await request.formData();
    const autoSubmit = form.get("auto_submit") === "1";

    // Server-authoritative integrity: never overwrite an already-submitted
    // question, and reject a manual submit once the timer has expired.
    // auto_submit is exempt from the timer check so it can still capture work
    // at the exact moment of expiry.
    const state = await db.getSubmitState(env, s.u, qname);
    if (state.submitted) return redirect("/review");
    if (!autoSubmit && state.timeLeft <= 0) return redirect("/review");

    const assignmentIds = (await db.getAssignment(env, s.u)).map((a) => a.questionId);

    if (autoSubmit) {
      let code = String(form.get("code") || "");
      if (!code) code = (await db.getDraft(env, s.u, qname)) || "# auto-submitted empty file\n";
      code = clampCode(code);
      await db.submitAnswer(env, s.u, qname, code);
      const next = nextQuestion(assignmentIds, qname);
      return redirect(next ? `/question?qname=${encodeURIComponent(next)}` : "/review");
    }

    const code = String(form.get("code") || "");
    const big = tooLarge(code);
    if (big || !code.trim()) {
      const lang = await langFor(env, s.u);
      return html(
        renderQuestion({
          qname,
          qnum: assignmentIds.indexOf(qname) + 1,
          timeLeft: await db.getTimeLeft(env, s.u, qname),
          questionText: q.text,
          expectedExt: extensionForLanguage(lang),
          language: lang,
          draftCode: clampCode(code),
          csrfToken: await csrfTokenFor(env, s),
          error: big ? "Submission too large (max ~1 MB)." : "No code submitted",
        }),
        big ? 413 : 200,
      );
    }
    await db.submitAnswer(env, s.u, qname, code);
    const next = nextQuestion(assignmentIds, qname);
    return redirect(next ? `/question?qname=${encodeURIComponent(next)}` : "/review");
  }

  if (path === "/review" && method === "GET") {
    const guard = requireStudent(session);
    if (guard) return guard;
    const s = session as Session;
    const order = (await db.getAssignment(env, s.u)).map((a) => a.questionId);
    return html(
      renderReview({
        review: await db.getStudentReview(env, s.u),
        order,
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

  // Run the student's current code against Wandbox and return its output. The
  // language is taken from the student's own record (not the client) so nobody
  // can run in an easier language than they registered. Always returns JSON;
  // failures are reported in the body, never as a 5xx that the browser would
  // treat as a network error.
  if (path === "/question/run" && method === "POST") {
    const guard = requireStudentApi(session);
    if (guard) return guard;
    const s = session as Session;
    if (!(await checkCsrf(request, env, s))) return new Response("", { status: 400 });
    const form = await request.formData();
    const code = String(form.get("code") || "");
    const stdin = String(form.get("stdin") || "");
    if (!code.trim()) return json({ error: "Write some code before running." }, 200);
    if (tooLarge(code)) return json({ error: "Code is too large to run (max ~1 MB)." }, 413);
    const language = await langFor(env, s.u);
    const result = await runCode(env, { language, code, stdin });
    if (result.error) return json({ error: result.error }, 200);
    return json({
      stdout: result.stdout,
      stderr: result.stderr,
      output: result.output,
      exitCode: result.exitCode,
      signal: result.signal,
      time: result.time,
    });
  }

  if (path === "/student/leave" && method === "POST") {
    const guard = requireStudentApi(session);
    if (guard) return guard;
    const s = session as Session;
    if (!(await checkCsrf(request, env, s))) return new Response("", { status: 400 });
    await db.incrementLeaveCount(env, s.u);
    return new Response(null, { status: 204 });
  }

  // Poll target: which question (if any) the student should currently be on.
  // The client redirects into it, which is how an admin "reopen" pulls a student
  // back to the reopened question.
  if (path === "/student/active" && method === "GET") {
    const guard = requireStudentApi(session);
    if (guard) return guard;
    const s = session as Session;
    return json({ q: await db.getActiveQuestion(env, s.u) });
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
    const students = allStudents();
    const usernames = students.map((x) => x.username);
    const assignmentsByUser = await db.getAssignmentsByUser(env);
    const submittedByUser = await db.getSubmittedByUser(env);
    const langs = await db.getStudentLanguages(env);
    const leaveCounts = await db.getLeaveCounts(env, usernames);
    const pasteFlagCounts = await db.getPasteFlagCounts(env, usernames);
    let slotCount = 0;
    const rows = students.map((st) => {
      const asg = assignmentsByUser[st.username] || [];
      slotCount = Math.max(slotCount, asg.length);
      const sub = submittedByUser[st.username] || new Set<string>();
      const slots = asg.map((a) => {
        const q = getQuestion(a.questionId);
        return {
          questionId: a.questionId,
          title: q?.title || a.questionId,
          difficulty: q?.difficulty || "",
          submitted: sub.has(a.questionId),
        };
      });
      return {
        username: st.username,
        school: st.school,
        grade: st.grade,
        language: langs[st.username] || st.language,
        leaveCount: leaveCounts[st.username] ?? 0,
        pasteFlags: pasteFlagCounts[st.username] ?? 0,
        slots,
      };
    });
    if (slotCount === 0) slotCount = 6;
    return html(
      renderAdmin({
        userCount: await db.countActiveUsers(env),
        slotCount,
        rows,
        activeUsers: await db.countActiveUsers(env),
        totalSubmissions: await db.countSubmissions(env),
        csrfToken: await csrfTokenFor(env, s),
        successMessage:
          url.searchParams.get("reset") === "1"
            ? "Database successfully reset. All submissions have been cleared."
            : url.searchParams.get("reopened") === "1"
              ? "Question reopened. The student has been redirected back to it with their work restored."
              : null,
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

  if (path === "/admin/reopen" && method === "POST") {
    const guard = requireAdmin(session);
    if (guard) return guard;
    if (!(await checkCsrf(request, env, session as Session)))
      return new Response("Bad CSRF token", { status: 400 });
    const form = await request.formData();
    const username = String(form.get("username") || "");
    const qname = String(form.get("question") || "");
    if (!getQuestion(qname) || !findStudent(username)) return redirect("/admin");
    const ok = await db.reopenQuestion(env, username, qname);
    return redirect(ok ? "/admin?reopened=1" : "/admin");
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
    const language = await langFor(env, username);
    const ext = extensionForLanguage(language);
    const body = withQuestionHeader(code, getQuestion(qname), language);
    const filename = `${safeName(username)}_${safeName(qname)}.${ext}`;
    return new Response(body, {
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
    const langs = await db.getStudentLanguages(env);
    const assignmentsByUser = await db.getAssignmentsByUser(env);
    // username -> questionId -> slot position, for stable "Q<n>_" filenames.
    const posOf: Record<string, Record<string, number>> = {};
    for (const [u, slots] of Object.entries(assignmentsByUser)) {
      posOf[u] = {};
      for (const sl of slots) posOf[u][sl.questionId] = sl.position;
    }
    const files: Record<string, Uint8Array> = {};
    for (const row of all) {
      const language = normalizeLanguage(langs[row.username], findStudent(row.username)?.language);
      const ext = extensionForLanguage(language);
      const pos = posOf[row.username]?.[row.question];
      const slotLabel = pos != null ? `Q${pos + 1}_` : "";
      const body = withQuestionHeader(row.code, getQuestion(row.question), language);
      files[`${safeName(row.username)}/${slotLabel}${safeName(row.question)}.${ext}`] = strToU8(body);
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

// True if the code exceeds the size cap (measured in UTF-8 bytes).
function tooLarge(code: string): boolean {
  return new TextEncoder().encode(code).length > MAX_CODE_BYTES;
}

// Best-effort clamp for the draft/auto-submit paths (a manual submit is
// rejected outright via tooLarge() rather than silently truncated).
function clampCode(code: string): string {
  if (code.length > MAX_CODE_BYTES) return code.slice(0, MAX_CODE_BYTES);
  return code;
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}
