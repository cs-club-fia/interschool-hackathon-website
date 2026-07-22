-- D1 schema for the hackathon quiz app. All runtime state lives here so it
-- survives Worker restarts and redeploys (unlike the old on-disk SQLite/files).

-- One row per (team, question): the submitted code, submission flag, and the
-- server-authoritative timer start.
CREATE TABLE IF NOT EXISTS submissions (
  username    TEXT NOT NULL,
  question    TEXT NOT NULL,
  submitted   INTEGER NOT NULL DEFAULT 0,
  code        TEXT,               -- the student's source; NULL until submitted
  start_time  REAL,               -- unix seconds; set on first question GET
  submit_time REAL,               -- unix seconds; set when submitted
  PRIMARY KEY (username, question)
);

-- Autosaved in-progress editor content so a crash/refresh/timeout doesn't lose work.
CREATE TABLE IF NOT EXISTS drafts (
  username   TEXT NOT NULL,
  question   TEXT NOT NULL,
  code       TEXT,
  updated_at REAL,
  PRIMARY KEY (username, question)
);

-- Anti-cheat counters (tab-leave events and paste-like large insertions), each
-- with a debounce timestamp.
CREATE TABLE IF NOT EXISTS student_metrics (
  username           TEXT PRIMARY KEY,
  leave_count        INTEGER NOT NULL DEFAULT 0,
  last_leave_ts      REAL    NOT NULL DEFAULT 0,
  paste_flag_count   INTEGER NOT NULL DEFAULT 0,
  last_paste_flag_ts REAL    NOT NULL DEFAULT 0
);
