-- shyden-labs/ShyTalk#230: an address's wrong sign-in tries are forgotten 30 days after the last one
-- (Shyden 2026-11-16). `last_at` is the time in ms of the last wrong try or lock; rows already here
-- count from this migration. workers/web/src/app/recovery-codes.ts prunes on write, no clock.
ALTER TABLE sign_in_lock ADD COLUMN last_at INTEGER NOT NULL DEFAULT 0;
UPDATE sign_in_lock SET last_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE last_at = 0;
CREATE INDEX sign_in_lock_last_at ON sign_in_lock (last_at);
