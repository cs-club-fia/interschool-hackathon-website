// Bundled, read-only config: the central question BANK (loaded from bank.json)
// and the per-grade slot templates that decide how many easy/medium/hard
// questions each grade gets and the time limit for each slot. Each participant
// is randomly assigned a set drawn from the bank at "Start" (see db.drawAssignment).

import bankData from "./bank.json";

export type Difficulty = "easy" | "medium" | "hard";

export interface BankQuestion {
  id: string;
  difficulty: Difficulty;
  title: string;
  text: string; // full prompt (bank.json stores it as lines; joined here)
}

// One slot in a grade's test: a difficulty to draw from the bank + its time limit.
export interface Slot {
  difficulty: Difficulty;
  seconds: number;
}

interface BankFile {
  questions: Array<{ id: string; difficulty: string; title: string; text: string[] }>;
}
const bankFile = bankData as unknown as BankFile;

export const BANK: Record<string, BankQuestion> = {};
export const BANK_IDS_BY_DIFFICULTY: Record<Difficulty, string[]> = { easy: [], medium: [], hard: [] };
for (const q of bankFile.questions) {
  const bq: BankQuestion = {
    id: q.id,
    difficulty: q.difficulty as Difficulty,
    title: q.title,
    text: q.text.join("\n"),
  };
  BANK[q.id] = bq;
  (BANK_IDS_BY_DIFFICULTY[bq.difficulty] ||= []).push(q.id);
}

export function getQuestion(id: string): BankQuestion | undefined {
  return BANK[id];
}

// --- Per-grade slot templates (difficulty + time). Times are the event values
// from the questions doc (minutes -> seconds), in Easy -> Medium -> Hard order. ---
const E = (s: number): Slot => ({ difficulty: "easy", seconds: s });
const M = (s: number): Slot => ({ difficulty: "medium", seconds: s });
const H = (s: number): Slot => ({ difficulty: "hard", seconds: s });

export const GRADE_TEMPLATE: Record<string, Slot[]> = {
  "8": [E(360), E(420), E(420), E(480), M(600), M(720)], // 4E 2H0 -> 50 min
  "9": [E(360), E(420), E(420), E(480), M(600), H(960)], // 4E 1M 1H -> 54 min
  "10": [E(360), E(420), E(480), M(600), M(720), H(960)], // 3E 2M 1H -> 59 min
  "11": [E(360), E(420), M(600), M(600), M(720), H(900)], // 2E 3M 1H -> 60 min
  "12": [E(360), E(420), M(600), M(660), H(780), H(780)], // 2E 2M 2H -> 60 min
};
export const DEFAULT_GRADE = "10";

// --- Admin "Reset All Submissions" kill switch ---
// The reset is GLOBAL: db.resetSubmissions() deletes every row in submissions,
// drafts, assignments and student_metrics with no per-school/per-date filter.
// This event runs across multiple dates (one school per date), so a reset on a
// later date would destroy the results of a date already completed.
// Set back to true only when every date is finished and the data is exported.
export const RESET_ENABLED = false;

export function templateForGrade(grade: string | undefined | null): Slot[] {
  return (grade && GRADE_TEMPLATE[grade]) || GRADE_TEMPLATE[DEFAULT_GRADE];
}

// Grade options for the login-screen dropdown, in ascending order (JS engines
// enumerate integer-like string keys numerically regardless of insertion order).
export const GRADE_OPTIONS: string[] = Object.keys(GRADE_TEMPLATE);

// Normalize an arbitrary (user-supplied) grade string to a supported key,
// falling back to a provided default (then DEFAULT_GRADE).
export function normalizeGrade(grade: string | undefined | null, fallback?: string): string {
  if (grade && GRADE_TEMPLATE[grade]) return grade;
  if (fallback && GRADE_TEMPLATE[fallback]) return fallback;
  return DEFAULT_GRADE;
}

// Fail loudly (called from tests / startup) if any grade needs more questions of
// a difficulty than the bank actually contains -- otherwise a draw could not be
// fulfilled at the event.
export function validateBankConfig(): void {
  for (const [grade, slots] of Object.entries(GRADE_TEMPLATE)) {
    const need: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
    for (const s of slots) need[s.difficulty]++;
    (["easy", "medium", "hard"] as Difficulty[]).forEach((d) => {
      const have = BANK_IDS_BY_DIFFICULTY[d].length;
      if (need[d] > have) {
        throw new Error(
          `Grade ${grade} needs ${need[d]} ${d} question(s) but the bank only has ${have}.`,
        );
      }
    });
  }
}

// Maps a team's chosen language to the extension their downloaded file uses.
export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  python: "py",
  cpp: "cpp",
  java: "java",
};
// Display names for the login-screen language dropdown (cap() would mangle "C++").
export const LANGUAGE_LABELS: Record<string, string> = {
  python: "Python",
  cpp: "C++",
  java: "Java",
};
export const DEFAULT_LANGUAGE = "python";

// Normalize an arbitrary (user-supplied) language string to a supported key,
// falling back to a provided default (then Python).
export function normalizeLanguage(lang: string | undefined | null, fallback?: string): string {
  if (lang && LANGUAGE_EXTENSIONS[lang]) return lang;
  if (fallback && LANGUAGE_EXTENSIONS[fallback]) return fallback;
  return DEFAULT_LANGUAGE;
}

// Timezone for displaying submission timestamps on the review page. The Worker
// runtime is UTC, so set this to the event's IANA timezone.
export const EVENT_TIMEZONE = "Asia/Kolkata";

export function extensionForLanguage(language: string | undefined | null): string {
  return LANGUAGE_EXTENSIONS[language || DEFAULT_LANGUAGE] || LANGUAGE_EXTENSIONS[DEFAULT_LANGUAGE];
}
