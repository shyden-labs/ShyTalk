---
id: SHY-0591
status: Draft
owner: unassigned
created: 2026-10-15
priority: P2
effort: S
estimate: 3
type: infra
roadmap_ids: []
mvp: false
blocked_by: [SHY-0587]
---

# SHY-0591: The system API has a hand-written spec, contract tests and a private Swagger page

## User Story

As **Shyden, the operator**, I want the scheduler and uptime endpoints
documented in their own spec, checked against the real API and shown on a
private Swagger page, so that the calls our GitHub Actions schedules and Better
Stack depend on cannot change shape unnoticed.

## Why

Global Swagger rule (Shyden 2026-10-15): every API gets a hand-written OpenAPI
spec that tests hold the real API to, and a Swagger page; private APIs get
private docs. Every ShyTalk API is private (Shyden, same day). SHY-0218's spec
covers the client-facing APIs only, so this API's spec is written here.

Measured on `origin/develop` 661f0ae5722, `routes/system.js`, **4 routes**,
mounted before the user-auth layer (`index.js`):

| Route | Caller | Guard |
| --- | --- | --- |
| `GET /api/system/health` | Better Stack heartbeat | none; fires `serverHealth()`, which can write Firestore and send alerts |
| `GET /api/system/app-check` | operator | App Check counters and mode |
| `POST /api/system/sweep-account-deletions` | `cron-account-deletion.yml` | `requireSystemAuth` bearer |
| `POST /api/system/sweep-support-retention` | `cron-support-retention.yml` | `requireSystemAuth` bearer |

## Acceptance Criteria

### Happy path

- [ ] A hand-written `express-api/openapi/system.yaml` (never generated from
      code) documents all 4 routes: method, auth, request, every response status
      and error shape.
- [ ] Contract tests send real requests to the real API (integration suite,
      not unit) and fail when a response differs from the spec in any route,
      status, field or error.
- [ ] The spec is served on its own private docs page (SHY-0587); every
      operation can be tried on dev with the dev system token.

### Error paths

- [ ] The sweeps' refusals are documented and contract-tested: no bearer,
      wrong bearer (401/403).
- [ ] An in-sync check fails CI when a route in `system.js` has no spec entry,
      or the spec has an entry with no route.

### Edge cases

- [ ] `GET /system/health` is NOT tryable on production: it returns 200 at once
      but starts a check that can write and alert.
- [ ] The system token is never stored by the page (`persistAuthorization`
      off) and never appears in the spec or examples.

### Performance

- [ ] N/A: no route changes.

### Security

- [ ] Planted: the page and spec refuse a signed-out request and an ordinary
      user's token.

### UX

- [ ] Each operation names its caller (which workflow or monitor).

### i18n

- [ ] N/A: operator-only developer docs, English only.

### Observability

- [ ] The contract suite reports how many of the 4 routes it checked, with a
      recorded floor.

## BDD Scenarios

**Scenario: A changed sweep response fails the contract**

- **Given** the account-deletion sweep's response loses a documented field
- **When** the contract tests run
- **Then** they fail naming the route and the field

## Test Plan

1. RED first: contract tests against an empty spec.
2. Mutations: rename a response field in the handler; drop a spec entry; add a
   route with no spec; each goes red.

## Out of Scope

- Changing the scheduling itself.

## Dependencies

- SHY-0587 (page, gate, try-it-out rule).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A tried sweep on dev deletes dev accounts due for deletion | That is the sweep's real job on dev; the page says so before sending. |

## Definition of Done

- [ ] Spec, contract tests and page merged; contract step required in CI.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from the global Swagger rule.
