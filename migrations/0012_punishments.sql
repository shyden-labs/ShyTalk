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
