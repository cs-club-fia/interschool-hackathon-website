// Bundled, read-only config: question text + per-question time limits, and the
// language -> file-extension map. Edit here and redeploy to change the event.

export interface QuestionConfig {
  text: string;
  seconds: number;
}

// Order matters: dashboard progress + "next question" logic iterate in this order.
// NOTE: durations below are the real event values. (The old Flask app shipped
// question1 at 20s as a test value -- restored to a real 15 min here.)
export const QUESTIONS: Record<string, QuestionConfig> = {
  question1: { text: "# Question 1 - fill in before the event\n", seconds: 900 },
  question2: { text: "# Question 2 - fill in before the event\n", seconds: 900 },
  question3: { text: "# Question 3 - fill in before the event\n", seconds: 1200 },
  question4: { text: "# Question 4 - fill in before the event\n", seconds: 900 },
  question5: { text: "# Question 5 - fill in before the event\n", seconds: 600 },
};

export const QUESTION_ORDER: string[] = Object.keys(QUESTIONS);

// Maps a team's chosen language to the extension their downloaded file uses.
export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  python: "py",
  cpp: "cpp",
  java: "java",
};
export const DEFAULT_LANGUAGE = "python";

// Timezone for displaying submission timestamps on the review page. The Worker
// runtime is UTC, so set this to the event's IANA timezone.
export const EVENT_TIMEZONE = "Asia/Kolkata";

export function extensionForLanguage(language: string | undefined | null): string {
  return LANGUAGE_EXTENSIONS[language || DEFAULT_LANGUAGE] || LANGUAGE_EXTENSIONS[DEFAULT_LANGUAGE];
}
