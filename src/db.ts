// All D1 access. Mirrors the old QuestionManager data layer. Timers/questions
// come from bundled config (questions.ts); D1 holds only runtime state.

import type { Env } from "./types";
import { QUESTIONS, QUESTION_ORDER } from "./data/questions";

const nowSec = () => Date.now() / 1000;

// --- Timers / access ---
export async function startTimer(env: Env, username: string, qname: string): Promise<void> {
  // Set start_time only if there's no row yet (INSERT OR IGNORE on the PK).
  await env.DB.prepare(
    "INSERT OR IGNORE INTO submissions (username, question, submitted, start_time) VALUES (?, ?, 0, ?)",
  )
    .bind(username, qname, nowSec())
    .run();
}

export async function getTimeLeft(env: Env, username: string, qname: string): Promise<number> {
  const total = QUESTIONS[qname]?.seconds ?? 0;
  const row = await env.DB.prepare(
    "SELECT start_time FROM submissions WHERE username = ? AND question = ?",
  )
    .bind(username, qname)
    .first<{ start_time: number | null }>();
  if (row && row.start_time) {
    const left = total - (nowSec() - Number(row.start_time));
    return Math.max(0, Math.floor(left));
  }
  return total;
}

export async function canAccess(env: Env, username: string, qname: string): Promise<boolean> {
  const total = QUESTIONS[qname]?.seconds ?? 0;
  const row = await env.DB.prepare(
    "SELECT submitted, start_time FROM submissions WHERE username = ? AND question = ?",
  )
    .bind(username, qname)
    .first<{ submitted: number; start_time: number | null }>();
  const left = row && row.start_time ? Math.floor(total - (nowSec() - Number(row.start_time))) : total;
  const submitted = !!(row && row.submitted);
  return left > 0 && !submitted;
}

// Combined state for the POST /question integrity checks: is this question
// already submitted, and how much (floored) time remains.
export async function getSubmitState(
  env: Env,
  username: string,
  qname: string,
): Promise<{ submitted: boolean; timeLeft: number }> {
  const total = QUESTIONS[qname]?.seconds ?? 0;
  const row = await env.DB.prepare(
    "SELECT submitted, start_time FROM submissions WHERE username = ? AND question = ?",
  )
    .bind(username, qname)
    .first<{ submitted: number; start_time: number | null }>();
  const submitted = !!(row && row.submitted);
  const timeLeft =
    row && row.start_time
      ? Math.max(0, Math.floor(total - (nowSec() - Number(row.start_time))))
      : total;
  return { submitted, timeLeft };
}

// --- Submissions ---
export async function submitAnswer(env: Env, username: string, qname: string, code: string): Promise<void> {
  const t = nowSec();
  // Upsert: mark submitted + store code + submit_time. Preserve existing
  // start_time on conflict (only set it for a brand-new row).
  await env.DB.prepare(
    `INSERT INTO submissions (username, question, submitted, code, start_time, submit_time)
     VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT(username, question) DO UPDATE SET
       submitted = 1,
       code = excluded.code,
       submit_time = excluded.submit_time`,
  )
    .bind(username, qname, code, t, t)
    .run();
  // A real submission supersedes any autosaved draft.
  await clearDraft(env, username, qname);
}

export async function getSubmissionCode(
  env: Env,
  username: string,
  qname: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT code FROM submissions WHERE username = ? AND question = ? AND submitted = 1",
  )
    .bind(username, qname)
    .first<{ code: string | null }>();
  return row ? row.code : null;
}

// Admin: undo a submission so the student can attempt the question again.
// Restores the time they had left when it was submitted (falls back to the full
// duration if that is unknown or already expired, so the reopen is always
// usable), and puts the previously submitted code back as a draft so they resume
// where they left off. Returns false if there was nothing submitted to reopen.
export async function reopenQuestion(env: Env, username: string, qname: string): Promise<boolean> {
  const total = QUESTIONS[qname]?.seconds ?? 0;
  const row = await env.DB.prepare(
    "SELECT submitted, code, start_time, submit_time FROM submissions WHERE username = ? AND question = ?",
  )
    .bind(username, qname)
    .first<{ submitted: number; code: string | null; start_time: number | null; submit_time: number | null }>();
  if (!row || !row.submitted) return false;
  const now = nowSec();
  let newStart = now; // default: fresh full duration
  if (row.start_time != null && row.submit_time != null) {
    const elapsed = Number(row.submit_time) - Number(row.start_time);
    if (elapsed >= 0 && total - elapsed > 0) newStart = now - elapsed; // preserve remaining time
  }
  await env.DB.prepare(
    "UPDATE submissions SET submitted = 0, submit_time = NULL, start_time = ? WHERE username = ? AND question = ?",
  )
    .bind(newStart, username, qname)
    .run();
  const prior = row.code && row.code !== "# auto-submitted empty file\n" ? row.code : "";
  if (prior) await saveDraft(env, username, qname, prior);
  return true;
}

// The question the student should currently be on: the first (in order) that has
// been started, is not submitted, and still has time left. Used by the client
// poll to auto-redirect a student into a question the admin just reopened.
// Never-started questions have no start_time, so this won't hijack the normal
// "click Start" flow.
export async function getActiveQuestion(env: Env, username: string): Promise<string | null> {
  const { results } = await env.DB.prepare(
    "SELECT question, submitted, start_time FROM submissions WHERE username = ?",
  )
    .bind(username)
    .all<{ question: string; submitted: number; start_time: number | null }>();
  const byQ: Record<string, { submitted: number; start_time: number | null }> = {};
  for (const r of results) byQ[r.question] = r;
  const now = nowSec();
  for (const q of QUESTION_ORDER) {
    const r = byQ[q];
    if (!r || r.submitted || r.start_time == null) continue;
    const total = QUESTIONS[q]?.seconds ?? 0;
    if (total - (now - Number(r.start_time)) > 0) return q;
  }
  return null;
}

// --- Student language preference (chosen on the login screen) ---
// Set the student's language at login, but LOCK it once the test has started --
// drafts and submissions are language-specific, so flipping languages mid-test
// would corrupt the editor mode and download extensions. Before the first
// question is opened the student can still change it by logging in again.
export async function setStudentLanguageOnLogin(
  env: Env,
  username: string,
  language: string,
): Promise<void> {
  if (await hasStarted(env, username)) return; // locked
  await env.DB.prepare(
    "INSERT INTO student_prefs (username, language) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET language = excluded.language",
  )
    .bind(username, language)
    .run();
}

export async function getStudentLanguage(env: Env, username: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT language FROM student_prefs WHERE username = ?")
    .bind(username)
    .first<{ language: string }>();
  return row ? row.language : null;
}

// username -> chosen language, for the admin dashboard + bulk downloads.
export async function getStudentLanguages(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare(
    "SELECT username, language FROM student_prefs",
  ).all<{ username: string; language: string }>();
  const map: Record<string, string> = {};
  for (const r of results) map[r.username] = r.language;
  return map;
}

export async function hasStarted(env: Env, username: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM submissions WHERE username = ?",
  )
    .bind(username)
    .first<{ n: number }>();
  return !!row && row.n > 0;
}

// Per-question submitted map for one student (all questions default false).
export async function getStudentSubmitted(
  env: Env,
  username: string,
): Promise<Record<string, boolean>> {
  const map: Record<string, boolean> = {};
  for (const q of QUESTION_ORDER) map[q] = false;
  const { results } = await env.DB.prepare(
    "SELECT question, submitted FROM submissions WHERE username = ?",
  )
    .bind(username)
    .all<{ question: string; submitted: number }>();
  for (const r of results) if (r.submitted) map[r.question] = true;
  return map;
}

// submitted + submit_time per question, for the review page.
export async function getStudentReview(
  env: Env,
  username: string,
): Promise<Record<string, { submitted: boolean; submitTime: number | null }>> {
  const map: Record<string, { submitted: boolean; submitTime: number | null }> = {};
  for (const q of QUESTION_ORDER) map[q] = { submitted: false, submitTime: null };
  const { results } = await env.DB.prepare(
    "SELECT question, submitted, submit_time FROM submissions WHERE username = ?",
  )
    .bind(username)
    .all<{ question: string; submitted: number; submit_time: number | null }>();
  for (const r of results) {
    if (map[r.question]) {
      map[r.question] = { submitted: !!r.submitted, submitTime: r.submit_time };
    }
  }
  return map;
}

// Full matrix username -> {question -> submitted}. Seeds every configured student.
export async function getAllSubmissions(
  env: Env,
  students: string[],
): Promise<Record<string, Record<string, boolean>>> {
  const result: Record<string, Record<string, boolean>> = {};
  const blank = () => Object.fromEntries(QUESTION_ORDER.map((q) => [q, false]));
  for (const u of students) result[u] = blank();
  const { results } = await env.DB.prepare(
    "SELECT username, question, submitted FROM submissions",
  ).all<{ username: string; question: string; submitted: number }>();
  for (const r of results) {
    if (!result[r.username]) result[r.username] = blank();
    if (r.submitted) result[r.username][r.question] = true;
  }
  return result;
}

// Every stored submission (for bulk export).
export async function getAllSubmittedCode(
  env: Env,
): Promise<Array<{ username: string; question: string; code: string }>> {
  const { results } = await env.DB.prepare(
    "SELECT username, question, code FROM submissions WHERE submitted = 1 AND code IS NOT NULL",
  ).all<{ username: string; question: string; code: string }>();
  return results;
}

export async function countActiveUsers(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(DISTINCT username) AS n FROM submissions WHERE start_time IS NOT NULL",
  ).first<{ n: number }>();
  return row ? row.n : 0;
}

export async function countSubmissions(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM submissions WHERE submitted = 1",
  ).first<{ n: number }>();
  return row ? row.n : 0;
}

export async function resetSubmissions(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM submissions"),
    env.DB.prepare("DELETE FROM drafts"),
  ]);
}

// --- Drafts ---
export async function saveDraft(env: Env, username: string, qname: string, code: string): Promise<void> {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO drafts (username, question, code, updated_at) VALUES (?, ?, ?, ?)",
  )
    .bind(username, qname, code, nowSec())
    .run();
}

export async function getDraft(env: Env, username: string, qname: string): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT code FROM drafts WHERE username = ? AND question = ?",
  )
    .bind(username, qname)
    .first<{ code: string | null }>();
  return row && row.code != null ? row.code : "";
}

export async function clearDraft(env: Env, username: string, qname: string): Promise<void> {
  await env.DB.prepare("DELETE FROM drafts WHERE username = ? AND question = ?")
    .bind(username, qname)
    .run();
}

// --- Anti-cheat metrics (3s debounce, done atomically in one UPSERT) ---
export async function incrementLeaveCount(env: Env, username: string): Promise<void> {
  const t = nowSec();
  await env.DB.prepare(
    `INSERT INTO student_metrics (username, leave_count, last_leave_ts, paste_flag_count, last_paste_flag_ts)
     VALUES (?1, 1, ?2, 0, 0)
     ON CONFLICT(username) DO UPDATE SET
       leave_count = leave_count + (CASE WHEN ?2 - last_leave_ts >= 3 THEN 1 ELSE 0 END),
       last_leave_ts = ?2`,
  )
    .bind(username, t)
    .run();
}

export async function incrementPasteFlagCount(env: Env, username: string): Promise<void> {
  const t = nowSec();
  await env.DB.prepare(
    `INSERT INTO student_metrics (username, leave_count, last_leave_ts, paste_flag_count, last_paste_flag_ts)
     VALUES (?1, 0, 0, 1, ?2)
     ON CONFLICT(username) DO UPDATE SET
       paste_flag_count = paste_flag_count + (CASE WHEN ?2 - last_paste_flag_ts >= 3 THEN 1 ELSE 0 END),
       last_paste_flag_ts = ?2`,
  )
    .bind(username, t)
    .run();
}

export async function getLeaveCounts(env: Env, students: string[]): Promise<Record<string, number>> {
  return metricCounts(env, "leave_count", students);
}
export async function getPasteFlagCounts(env: Env, students: string[]): Promise<Record<string, number>> {
  return metricCounts(env, "paste_flag_count", students);
}

async function metricCounts(
  env: Env,
  column: "leave_count" | "paste_flag_count",
  students: string[],
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const s of students) result[s] = 0;
  const { results } = await env.DB.prepare(
    `SELECT username, ${column} AS c FROM student_metrics`,
  ).all<{ username: string; c: number }>();
  for (const r of results) result[r.username] = r.c || 0;
  return result;
}
