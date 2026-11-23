-- Closed-testing applicants (plan 3 Task 5, shyden-labs/ShyTalk#55; design 3):
-- the email, the site language, when they applied and confirmed. The token is
-- only ever held as its hash. Unconfirmed rows go after 48 hours, on the next
-- write to the table, never by a timer.
CREATE TABLE applicants (
  email TEXT PRIMARY KEY,
  locale TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  confirm_hash TEXT,
  confirm_sent_at INTEGER
);
