-- Per-student programming language, chosen on the login screen. Persisted here
-- (not only in the session cookie) so the admin dashboard and code downloads
-- reflect each student's real choice -- e.g. so Java code downloads as .java.
-- The choice is locked once the student starts the test (see db.setStudentLanguageOnLogin).
CREATE TABLE IF NOT EXISTS student_prefs (
  username TEXT PRIMARY KEY,
  language TEXT NOT NULL
);
