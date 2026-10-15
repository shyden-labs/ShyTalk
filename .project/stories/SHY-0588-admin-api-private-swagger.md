---
id: SHY-0588
status: Draft
owner: unassigned
created: 2026-10-15
priority: P2
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
blocked_by: [SHY-0587, SHY-0218]
---

# SHY-0588: The admin API has a private Swagger page

## User Story

As **Shyden, the operator**, I want a private Swagger page for the admin API,
so that every admin and portal call is documented and I can try each one on dev
without reading the route code.

## Why

Global Swagger rule (Shyden 2026-10-15); every ShyTalk API is private (Shyden,
same day). See SHY-0587 for the rule, the gate and the API table.

Measured on `origin/develop` 661f0ae5722: **182 routes** belong to the admin
API, by path (`/admin/...`, `/portal/...`) or guard (`requireAdmin`/`isAdmin`
in the handler, or a `router.use` admin guard): `admin-age-verification.js`
(5), `admin-alerts.js` (6), `admin-audit-log.js` (2), `admin-backup.js` (6),
`admin-bans.js` (7), `admin-cleanup.js` (26), `admin-devices.js` (5),
`admin-economy.js` (9), `admin-gifts.js` (3), `admin-log-config.js` (2),
`admin-logs.js` (2), `admin-migrate.js` (1), `admin-temp-id.js` (3),
`admin-users.js` (26), `banners.js` (6), `config.js` (7), `economy.js` (3),
`identity-graph.js` (9), `livekit.js` (1), `portal.js` (9), `reports.js` (11),
`suggestions-maintenance.js` (5), `suggestions.js` (22),
`support-tickets.js` (5), `users.js` (1).

## Acceptance Criteria

### Happy path

- [ ] The admin API's own spec file (from SHY-0218) is served on its own private
      docs page (SHY-0587), listing every one of the 182 routes, each with its
      method, parameters, request body, every response status and error shape.
- [ ] Signed in on the dev docs, every admin operation can be tried and its
      real response matches the spec (SHY-0218's contract tests are the proof).
- [ ] On production, only operations proven to change nothing are tryable.

### Error paths

- [ ] Each operation documents its refusals: no token (401), a non-admin token
      (403), an admin token without `totpVerified` where the route needs it.

### Edge cases

- [ ] Each production-tryable GET is proven to write nothing (no Firestore
      write, no storage write, no message sent), one test per operation.
- [ ] Routes whose group was unclear (admin branches inside shared files such
      as `config.js`, `economy.js`, `users.js`) are placed in exactly one spec;
      SHY-0218's in-sync check fails a route in none or two.
- [ ] `admin-migrate.js` (1 route) is mounted only when `NODE_ENV` is not
      `production` (`index.js`); it appears on the dev docs only, and a test
      fails if the production docs list it.

### Performance

- [ ] N/A: documentation only; no route changes.

### Security

- [ ] Planted: open the admin docs page and spec signed out and as a normal
      user; both refused (SHY-0587's gate, re-run for this page).

### UX

- [ ] Operations are grouped by area (users, economy, bans, backups, logs,
      portal, ...) with a one-line summary each.

### i18n

- [ ] N/A: operator-only developer docs, English only.

### Observability

- [ ] The page states how many operations it documents, and a test checks that
      number equals the spec's count.

## BDD Scenarios

**Scenario: Shyden tries an admin call on dev**

- **Given** Shyden is signed in to the dev admin docs
- **When** he tries "list bans"
- **Then** the real dev response is shown and matches the documented shape

## Test Plan

1. RED first: a page test expecting all 182 operations against an empty spec.
2. Mutations: drop one operation from the spec; mark a write as changing
   nothing; each goes red.

## Out of Scope

- Writing the admin spec and its contract tests (SHY-0218).

## Dependencies

- SHY-0587 (page, gate, try-it-out rule); SHY-0218 (the admin spec).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A destructive admin call (backup restore, cleanup) is tried by accident on dev | Dev data only; production blocks every write. |

## Definition of Done

- [ ] Page live on dev behind the gate; tests required in CI.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from the global Swagger rule; private by Shyden's
  ruling the same day.
