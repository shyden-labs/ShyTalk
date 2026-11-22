-- shyden-labs/ShyTalk#77 (plan 6.1 Task 3): the oldest Android and iPhone app version each platform
-- allows. workers/web/src/app/floor.ts reads it before every app route; staff with floor.manage set it
-- from /staff/floor (Task 4), auditing each change. No row means no floor. The website has none.
CREATE TABLE app_floor (
  platform TEXT PRIMARY KEY NOT NULL CHECK (platform IN ('android', 'ios')),
  min_version TEXT NOT NULL,
  set_at INTEGER NOT NULL,
  set_by TEXT NOT NULL
);
