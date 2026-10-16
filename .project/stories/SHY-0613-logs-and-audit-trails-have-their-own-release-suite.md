---
id: SHY-0613
status: Draft
owner: claude
created: 2026-10-16
priority: P1
effort: L
estimate: 13
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0613: Logs and audit trails have their own test suite, required before every release

## User Story

As the operator, I want every check of the code that writes, keeps or replays
a log, an audit trail or a kept history to run in one suite of its own, run
in CI on the release head and passed before production, so that those
records are proven whole at full depth before each release without slowing
every pull request.

## Why

Shyden's global rule of 2026-10-16 (every project and `repo-template`):
_"separate test suite for logging and auditing. run in ci as a
pre-requisite to a release"_. The full text is in
`~/.claude/global-rules/reference/reference-engineering-standards.md`
("LOGGING AND AUDITING HAVE A TEST SUITE OF THEIR OWN"). The standing task
per repo is to list every trail and file this story.

Scope ruled by Shyden on 2026-10-16 (AskUserQuestion, "Include the 3
histories"): the three histories users see (coin transactions, message edit
history, spin history) count as audit trails and move too.

### Inventory (measured 2026-10-16 on `origin/develop` `5273f570821`)

Found by searching both the `collection('…')` literal form and every quoted
name holding Audit/Log/Events/History. The second search found
`safetyAudit`, which the first missed because it is reached through a
constant.

Logs:

1. **Server logs**: `express-api/src/utils/logger.js`, `loggerInstance.js`,
   `utils/log.js`, `middleware/requestLogger.js`; written to `logs`.
2. **Log rotation and settings**: `cron/rotateLogs.js` keeps `logs` within
   its limit; `logConfig` holds the settings (also read by `cron/backups.js`
   and `routes/admin-migrate.js`).
3. **Logs from the website**: `routes/logs.js` (`POST /api/logs`) takes
   entries from `public/js/logger.js`. The Android and iOS apps send none:
   `shared/.../data/remote/LogService.kt` has no implementation and no
   caller (corrected 2026-10-16; their log is SHY-0615), so `Logger.kt`,
   `Logger.android.kt` and `Logger.ios.kt` write to the device log only.
   The admin panel replays them
   (`routes/admin-logs.js`, `public/admin/js/tabs/logs.js`).

Audit trails:

4. **Admin audit log** (`adminAuditLog`): written by `cron/backups.js`,
   `routes/admin-cleanup.js`, `admin-migrate.js`, `identity-graph.js`,
   `suggestions.js`, `suggestions-maintenance.js`; replayed by
   `routes/admin-audit-log.js`.
5. **Audit log** (`auditLog`): `routes/suggestions.js`
   (`createAuditEntry`), `routes/support-tickets.js`,
   `utils/age-verification-audit.js`.
6. **Age-check audit replay**: `cron/ageVerificationAuditReconcile.js` reads
   the trail back and fills gaps (`hasExistingAudit`);
   `routes/admin-age-verification.js` writes through `writeAuditBestEffort`.
7. **Moderation log** (`moderationLog`): `routes/suggestions.js`; replayed
   by `routes/admin-audit-log.js`.
8. **Safety audit** (`safetyAudit`): `safety/safety-audit.js`, one row per
   blocked attempt.
9. **Segregation events** (`segregationEvents`):
   `utils/segregation-audit.js` (`auditFcmCohortDrop`,
   `auditAdminFlagBypass`), called from `middleware/sameCohort.js`,
   `routes/livekit.js`, `routes/conversations.js`, `utils/fcm.js`.

Histories users see:

10. **Coin transactions** (`users/{id}/transactions`): written by
    `routes/economy.js`, `admin-economy.js`, `apple-notifications.js`;
    exported by `utils/data-export-builder.js`; cleared by
    `cron/accountDeletion.js`, `cron/testDataCleanup.js` and
    `routes/admin-cleanup.js`.
11. **Spin history**: no store of its own. `GachaViewModel.kt`
    (`loadSpinHistory`) shows the spin rows of the coin transactions, so its
    checks are the read side of trail 10.
12. **Edit history**: message edits are written on the device, straight to
    Firestore (`messages/{id}/edits`) by `PrivateMessageRepositoryImpl.kt`
    (Android) and `IosPrivateMessageRepositoryImpl.kt` (iOS), and shown by
    `EditHistoryDialog.kt`. Suggestions keep an `editHistory` field in
    `routes/suggestions.js` (found while measuring and included as the same
    kind of record).
13. **Group moderation log** (`conversations/{id}/mod_log`): written from
    the device by group admins and mods (`firestore.rules` `mod_log`
    block), read by participants. Missed by the first count; found
    2026-10-16 reading `firestore.rules`.

Trails 12 and 13 are written by the device, so the rules decide whether a
modified app can skip or forge them. They can today: SHY-0614 (P0) fixes
that. The suite here must prove the rules refuse a skipped or forged entry,
not only that the honest app writes one.

Test files naming these trails today (file level only; AC 1 sorts them per
test): under `express-api/tests` (utils `logger`, `loggerInstance`,
`log`, `consoleLogger`, `age-verification-audit`, `segregation-audit`;
routes `logs`, `admin-logs`, `admin-log-config`, `admin-audit-log-suggestions`;
middleware `requestLogger`; cron `rotateLogs`, `ageVerificationAuditReconcile`;
`safety/safety-audit`; the cohort route tests that assert a
`segregationEvents` row), Kotlin `LoggerTest.kt`, `LogServiceTest.kt`
(only the defaults of `LogEntry`, `BatchSettings` and `LogConfig`, data
classes nothing ships; not a trail check, so it does not move),
`PrivateChatViewModelTest.kt` and the jvmTest
`IosLoggerReachesTheDeviceLogPinTest.kt`, and web specs `admin-logs`,
`admin-audit-log`, `logger-idempotency`.

Not counted as trails (the tools' own run output, not product records):
`express-api/scripts` journey and matrix runner logs
(`matrix-cell-logs`, `ios-xcodebuild-log-artifact`,
`ios-journey-device-applog`).

## Acceptance Criteria

### Happy path

- [ ] First, every test (not file) in the files above, and any other test
      that asserts a trail's row, is sorted into one of: moves to the suite,
      stays in unit as a stand-in, or is not a trail check (with its
      reason). The table goes in Notes with counts per trail.
- [ ] The suite exists: `express-api/jest.logs.config.js`, npm script
      `test:logs`, and a Gradle task for the Kotlin checks, each running only
      the sorted tests. It may use the emulators (it is not unit).
- [ ] Every one of the 13 trails has at least one check in the suite that
      writes or reads the real record, at full depth: field shapes, order,
      the replay or reconcile result, the rotation cap and redaction.
- [ ] Unit keeps a fast stand-in for every check that moves, held to the
      unit limits (1 s, 0.1 s CPU, no process, no socket). Each stand-in
      names the suite check it stands in for.
- [ ] Workflow `logs-suite.yml` runs the suite on a given ref
      (`workflow_dispatch` and `workflow_call`) with one measured time limit
      at its step.
- [ ] `deploy-prod.yml` runs it on the release ref before `approve-prod`, and
      `approve-prod` `needs` it, so a red suite stops production.
- [ ] The suite does not run on pull requests: `pr-checks.yml` and
      `test-backend.yml` leave the moved tests out.

### Error paths

- [ ] A planted broken trail (for example, `writeAuditBestEffort` writing
      nothing) turns the suite red and `deploy-prod.yml` stops before
      `approve-prod`, seen in a dispatched run on a scratch ref that never
      deploys.
- [ ] A test that asserts a trail's row but sits in neither the suite nor
      the stand-in list fails a guard that names the test.

### Edge cases

- [ ] Android and iOS edit-history writes have the same checks (same steps,
      same strictness); a gap is filed at once.
- [ ] A best-effort write (`writeAuditBestEffort`, `utils/log.js`
      fire-and-forget) that fails is shown failing, never as success.

### Performance

- [ ] Pull-request CI time is measured before and after; it must not grow.
      The suite's own time is measured and set as its one limit.

### Security

- [ ] The suite proves no secret or token reaches any trail
      (`SENSITIVE_KEYS` redaction in `logger.js`, client batches in
      `routes/logs.js`).
- [ ] The suite needs no production credential; it runs on emulators.

### UX

- [ ] A failing suite names the trail, the test and the release ref.

### i18n

- [ ] Not applicable: no user-facing copy changes.

### Observability

- [ ] The `deploy-prod.yml` run summary links the logs suite's run and its
      result. (No written release checklist exists in `.project/` today,
      measured 2026-10-16, so the workflow is the gate.)

## BDD Scenarios

**Scenario: a broken audit trail stops a release**

- **Given** a release ref where the admin audit log stops being written
- **When** `deploy-prod.yml` runs on that ref
- **Then** the logs suite fails naming `adminAuditLog`
- **And** `approve-prod` is never reached

**Scenario: pull requests stay fast**

- **Given** a pull request touching `routes/economy.js`
- **When** CI runs
- **Then** the unit stand-ins for coin transactions run
- **And** the full logs suite does not

## Test Plan

- Sort by test, not by file (a file-level grep cannot answer which test
  asserts a trail).
- Each moved check goes RED against a planted defect before it is trusted.
- The guard of AC "neither the suite nor the stand-in list" has a floor at
  the measured count and goes into the guards suite when SHY-0563 lands;
  until then it lives in `express-api/tests/scripts/`.
- One dispatched `deploy-prod.yml` run on a scratch ref proves the gate,
  with production approval refused.

## Out of Scope

- The web end-to-end specs of the admin log screens (`admin-logs`,
  `admin-audit-log`, `logger-idempotency`): they are page journeys and stay
  in the Playwright suites, which the release gauntlet already runs.
- Changing what any trail records.

## Dependencies

- `repo-template` is getting the suite's shape from the Yawelo Idle session
  (2026-10-16); this story follows that shape once it lands, without
  waiting for it.
- SHY-0563 (guards suite) is where this story's guard ends up.

## Risks & Mitigations

- Moving checks out of pull requests delays when a break is found. Mitigation:
  the unit stand-ins stay on every pull request.
- `deploy-prod.yml` is a production workflow: the change is merged to `main`
  only by Shyden, as every production change is.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-16**: Filed on Shyden's global rule (passed on by the Yawelo
  Idle session; checked in `~/.claude/CLAUDE.md` before acting) and his
  scope ruling above.
- **2026-10-16**: Trail 13 (`mod_log`) added, and the client-written
  trails' forgery gap filed as SHY-0614, from a side agent's note checked
  against `firestore.rules`. Score kept at 13: one more trail of the same
  kind.
- **2026-10-16 (correction)**: Trail 3 said the Android and iOS apps send
  their logs to `POST /api/logs` through `LogService.kt`. They never have:
  `LogService` has no implementation and no caller in shipped code, so the
  admin Logs screen has only ever shown website and server lines, and a
  phone's log stays in the device log. Trail 3 now says so; the phones'
  log is SHY-0615. Score kept at 13: the phone part of trail 3 was only
  `LogServiceTest.kt`'s data-class defaults; the twelve other trails, the
  workflows and the production change are unchanged.
- Scored 13: twelve trails across Jest and Kotlin, a new workflow, a
  production workflow change, a guard and a proof run. That is more than
  SHY-0563 (5, one language, no production workflow). Shyden saw "about 13"
  when choosing the scope. Priority P1: it gates every release, but no
  release is waiting on it today.
