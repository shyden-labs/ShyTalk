---
id: SHY-0637
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0637: The dev portal cannot copy production into dev

## User Story

As a learner whose account, messages and date of birth live in production, I
want no development server ever able to read them, so that my data stays in
the one place its privacy policy names.

## Why

Found on 2026-10-18, read at `origin/develop` 8fae81c2ec6:
`express-api/src/routes/admin-migrate.js` (`POST /admin/migrate-prod-data`,
mounted when `NODE_ENV` is not `production`) wipes dev Firestore and copies 25
production collections and 10 subcollections into it: `users` (dates of birth,
minors included), `conversations` and their `messages`, `otpCodes`,
`biometricKeys`, `reports`, `suspensionAppeals`, `adminAuditLog` and more. The
dev admin portal's "Sync from Production" overlay (`public/admin/js/sync-prod.js`)
calls it.

It is inert today: it needs `PROD_SERVICE_ACCOUNT_PATH` pointing at a
production service-account file, and nothing in the repo sets it (only the
commented line in `express-api/.env.example`). One setting would put a
production key on a dev server, breaking the rule that dev can never reach
production.

Shyden, 2026-10-18 (AskUserQuestion): **"Remove it"**. Dev gets its people from
`seed-dev-personas.yml`. Live catalogue data in dev, if ever wanted, is a
separate dispatch workflow gated by the `production` environment, never a
dev-server route.

## Acceptance Criteria

### Happy path

- [ ] `express-api/src/routes/admin-migrate.js` and
      `express-api/tests/routes/admin-migrate.test.js` (827 lines) are deleted,
      and `express-api/src/index.js` no longer mounts the route.
- [ ] `public/admin/js/sync-prod.js` (390 lines) is deleted; `public/admin/js/main.js`
      no longer imports or initialises it; the "Sync from Production" card and
      its confirmation overlay are gone from `public/admin/index.html`.
- [ ] The `PROD_SERVICE_ACCOUNT_PATH` block is gone from `express-api/.env.example`.

### Error paths

- [ ] `POST /api/admin/migrate-prod-data` on a dev server answers 404 (test).

### Edge cases

- [ ] `tests/web/admin-init-idempotency.spec.ts`, `tests/web/admin-maintenance.spec.ts`
      and `express-api/tests/scripts/admin-click-handler-reentrancy.test.js`
      drop their sync-prod cases, and the nuclear-reset cases beside them
      still pass.
- [ ] `scripts/no-stubs-baseline.json` and `scripts/public-js-lint-baseline.json`
      lose their sync-prod entries; any guard floor that counts files is
      re-recorded, never hand-edited.

### Performance

- [ ] Not applicable: removal only.

### Security

- [ ] A guard refuses `PROD_SERVICE_ACCOUNT_PATH`, and any `initializeApp` naming a
      second (production) app, in `express-api/src`, floored at the files it
      read, and goes red on a planted one.

### UX

- [ ] The dev portal's Maintenance tab shows no empty gap where the card was
      (Playwright, dev).

### i18n

- [ ] Not applicable: the removed strings were English-only admin copy.

### Observability

- [ ] Not applicable: nothing scheduled or relied on is removed.

## Announce

Nothing: operator tooling with no learner-facing change.

## BDD Scenarios

**Scenario: the copy route is gone**

- **Given** a dev server and a signed-in admin
- **When** they post to `/api/admin/migrate-prod-data`
- **Then** the server answers 404 and dev Firestore is unchanged

**Scenario: j37 no longer pulls the lever**

- **Given** `journey-tests/j37-the-last-levers.feature`
- **When** it is read
- **Then** its prod-data paragraph says the lever was removed (SHY-0637), and no
  scenario runs it

## Test Plan

- Unit: the 404 test; the guard and its planted mutant.
- Playwright (CI): the two admin specs green after their cases are dropped.

## Out of Scope

- A catalogue-only sync workflow (not wanted now).
- `admin-cleanup.js` and nuclear reset (dev-only tools that touch dev alone).

## Dependencies

- None. SHY-0510, SHY-0588 and SHY-0613 (all Draft) name `admin-migrate.js` or
  `sync-prod.js`; their lines are edited to drop it in the same PR.

## Risks & Mitigations

- A shared admin test helper may import the overlay: the Playwright specs run
  in CI before merge.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the dev portal checked after the dev deploy.

## Notes

- **2026-10-18**: Filed while waiting on #2420. P0 by the standing rule that
  any vulnerability is P0 (a latent route to put a production key on dev);
  not MVP (admin tooling). Scored 3 from measurement: 23 files name it (22 by
  name, plus `index.html` by its heading), of which 13 change: 3 deleted
  (route, its test, the overlay) and 10 edited (3 tests, 2 baselines,
  index.html, main.js, index.js, .env.example, j37), plus a guard and three
  Draft stories' lines. I quoted Shyden "about 2" before measuring; the
  measured scope is 3.
