---
id: SHY-0622
status: Draft
owner: claude
created: 2026-10-17
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0622: Every moderation action shows in the admin audit log

## User Story

As an administrator reading the audit log, I want every recorded admin
action to appear there, suspensions, bans and warnings included, so that
I can see who did what to whom when I look into an incident.

## Why

The admin audit log page (`GET /admin/audit-log`, and its CSV export,
`express-api/src/routes/admin-audit-log.js`) reads `adminAuditLog` with
`orderBy('timestamp', 'desc')`. Firestore's `orderBy` also filters: a
document without that field is never returned. Most writers never set
`timestamp`.

Measured on `origin/develop` `8de2bc7c1a0` plus the unpushed SHY-0605
branch, by parsing every `express-api/src/**/*.js` (148 of 148 files)
for writes to `adminAuditLog` (`.set`, `.add`, `t.set`, `batch.set`):

- 41 writes. 8 set `timestamp` and are shown. **33 set `createdAt`
  instead and are never shown**: admin-users.js 8 (suspend, unsuspend,
  warnings, bans), reports.js 6 (report resolution, appeals), admin-bans.js
  5, admin-economy.js 5, admin-gifts.js 2, admin-temp-id.js 2, users.js 2,
  admin-devices.js 1, utils/auto-bans.js 1 (LIFT_AUTO_BANS),
  utils/warnings.js 1 (REVOKE_WARNING). None set both; none set neither.
- 31 writes name the admin `adminId`; the page filters on `adminUid`.
  Those writes name the target `targetUserId`; the page reads `targetId`
  and `target`. So even shown, their admin filter and target column would
  miss.
- The other 13 mentions of `adminAuditLog` are reads, comments or
  collection lists (54 in all), so the 41 is the whole population.
- The admin tab (`public/admin/js/tabs/audit-log.js:111`) already falls
  back to `adminId` for the name: it was built to show these rows; the
  server drops them before it sees them.

Every suspension, unsuspension, appeal decision, warning revoke and
auto-ban lift is written and then hidden from the one page meant to show
it. Found while planning SHY-0605 (its new ending entry would have been
the 42nd hidden write).

Related, not duplicated: SHY-0283 (#1700) is the Load More button
repeating page one; SHY-0613 (#2373) puts audit trails in the release
suite; SHY-0614 (#2376) is client-forged moderation records.

## Acceptance Criteria

### Happy path

- [ ] The list and the export return every `adminAuditLog` entry already
      stored, whichever of `timestamp` or `createdAt` it carries, newest
      first by whichever it has.
- [ ] Every writer listed in Notes writes one shape: `adminUid`, `action`,
      `targetType`, `targetId`, `details`, `timestamp`. A shared helper
      builds it; no writer hand-writes the fields.
- [ ] Entries already stored with `adminId` / `targetUserId` match the
      admin filter and show their target.

### Error paths

- [ ] An entry with neither time field is still listed (last), and logged
      once per request with its id, never dropped.

### Edge cases

- [ ] `moderationLog` and `auditLog`, read by the same route, are checked
      the same way and their writers listed in Notes; a writer missing
      `timestamp` there is fixed in this story.
- [ ] The suggestion history route (`suggestions.js` ~1782, filters on
      `targetId`) still finds its entries after the change.

### Performance

- [ ] The list route's run time on dev with today's entries is measured
      before and after and recorded in Notes; no regression.

### Security

- [ ] The routes stay admin-only (one test each that a non-admin is
      refused).

### UX

- [ ] A suspension made in the admin panel appears at the top of the
      audit log with the admin's name, the action and the user.

### i18n

- [ ] No new copy. The admin panel is English-only today.

### Observability

- [ ] The audit-log page shows the count of entries returned, and a
      guard proves every writer uses the helper.

## BDD Scenarios

**Scenario: a suspension appears in the audit log**

- **Given** an admin suspends a user
- **When** the admin opens the audit log
- **Then** the newest row is the suspension, naming the admin and the user

**Scenario: an old entry stored with createdAt still shows**

- **Given** an `adminAuditLog` entry with `createdAt` and no `timestamp`
- **When** the audit log is listed
- **Then** the entry is in the list at its `createdAt` position

## Test Plan

- Unit (mocked db): the route returns and orders mixed-shape entries; one
  test per shape; the helper's shape.
- Guards suite: every `adminAuditLog` write goes through the helper,
  population counted at the measured 41 writes with a floor, planted
  hand-written writes in each form (`.set`, `.add`, `t.set`,
  `batch.set`) go RED.
- Integration (CI, emulator): a stored `createdAt` entry is listed (proves
  the `orderBy` filter is gone).

## Out of Scope

- Load More pagination (SHY-0283).
- Moving audit trails to the template's audit design (template #24/#25).

## Dependencies

- None. SHY-0605's new ending entry uses the readers' shape now, and moves
  to the helper here.

## Risks & Mitigations

- Writers in 10 files change at once: the guard lists each site, and each
  file's route tests assert the new shape.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- Per-site list of the 41 writes: rebuild with the parse in the Test
  Plan's guard; the counts above were made the same way on 2026-10-17.
