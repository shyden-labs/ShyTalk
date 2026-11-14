-- Audit rows are kept one year (shyden-labs/ShyTalk#197, Shyden 2026-11-14,
-- for the privacy policy #171). Each new row first deletes the rows older
-- than a year, so pruning happens only inside a write that was happening
-- anyway: nothing runs on a clock. The table still refuses every UPDATE, and
-- every DELETE of a row younger than a year. `at` is milliseconds since 1970.
CREATE INDEX audit_at ON audit (at);

DROP TRIGGER audit_no_delete;

CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit
WHEN OLD.at >= CAST(strftime('%s', 'now', '-1 year') AS INTEGER) * 1000
BEGIN
  SELECT RAISE(ABORT, 'audit is append-only');
END;

CREATE TRIGGER audit_prune BEFORE INSERT ON audit
BEGIN
  DELETE FROM audit WHERE at < CAST(strftime('%s', 'now', '-1 year') AS INTEGER) * 1000;
END;
