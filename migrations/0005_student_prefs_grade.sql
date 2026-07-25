-- Per-student grade, now chosen on the login screen (like language) instead of
-- being fixed in logins.json. Nullable so existing student_prefs rows (written
-- before this migration) fall back to the logins.json grade until the student
-- next logs in. Locked once the test starts (see db.setStudentPrefsOnLogin).
ALTER TABLE student_prefs ADD COLUMN grade TEXT;
