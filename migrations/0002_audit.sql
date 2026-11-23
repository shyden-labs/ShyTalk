-- The audit trail (plan 3 Task 8, shyden-labs/ShyTalk#59): one row per change
-- to people's data, written in the same batch as the change. Append-only: the
-- triggers refuse every UPDATE and DELETE.
CREATE TABLE audit (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT,
  detail TEXT,
  environment TEXT NOT NULL
);

CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit
BEGIN
  SELECT RAISE(ABORT, 'audit is append-only');
END;

CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit
BEGIN
  SELECT RAISE(ABORT, 'audit is append-only');
END;
