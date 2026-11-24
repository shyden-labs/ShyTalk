-- shyden-labs/ShyTalk#310: ShyDesk's punishments, recorded and enforced (Shyden 2026-11-23). One row per ShyDesk
-- punishment id, so a replayed delivery writes nothing twice. `blocks` is 1 for a suspension or ban, which ends the
-- member's sessions and refuses sign-in while `lifted_at` is null and `ends_at` is null or ahead. Times are unix
-- milliseconds, written by workers/web/src/moderation/punishments.ts; `issued_at` is ShyDesk's own ISO time.
CREATE TABLE punishment (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  blocks INTEGER NOT NULL CHECK (blocks IN (0, 1)),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  lifted_at INTEGER,
  report_ticket_id TEXT NOT NULL,
  appeal_url TEXT,
  issued_at TEXT NOT NULL
);
CREATE INDEX punishment_user_id ON punishment (user_id);
-- No session row lands while a block holds (shyden-labs/ShyTalk#310): D1 runs writes one at a time, so a sign-in that
-- passed its check just before a ban arrived either wrote its session first (and the ban's delete ends it) or meets
-- this refusal. "Now" is unix milliseconds, as the Worker writes `ends_at`.
CREATE TRIGGER session_refused_while_blocked BEFORE INSERT ON "session"
WHEN EXISTS (
  SELECT 1 FROM punishment
  WHERE user_id = NEW."userId" AND blocks = 1 AND lifted_at IS NULL
    AND (ends_at IS NULL OR ends_at > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
)
BEGIN
  SELECT RAISE(ABORT, 'member_blocked');
END;
