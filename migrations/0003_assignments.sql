-- Per-student assigned question set, drawn randomly from the bank at "Start".
-- One row per slot (position). question_id references a bank question (config,
-- not a table); seconds is the slot's time limit copied from the grade template
-- so it stays stable even if config changes mid-event. This replaces the old
-- fixed question1..5 model -- every participant now has their own ordered set.
CREATE TABLE IF NOT EXISTS assignments (
  username    TEXT    NOT NULL,
  position    INTEGER NOT NULL,   -- 0-based order within the student's test
  question_id TEXT    NOT NULL,   -- bank question id (e.g. "e01")
  seconds     INTEGER NOT NULL,   -- time limit for this slot
  PRIMARY KEY (username, position)
);
