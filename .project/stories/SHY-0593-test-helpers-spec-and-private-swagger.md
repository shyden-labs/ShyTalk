---
id: SHY-0593
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

# SHY-0593: The test-helper API has a hand-written spec, contract tests and a dev-only private Swagger page

## User Story

As **Shyden, the operator**, I want the test-helper endpoints that the journey
and integration tests use documented, contract-tested and shown on a private
Swagger page on dev, so that test tooling and the API it drives stay in step.

## Why

Global Swagger rule (Shyden 2026-10-15); every ShyTalk API is private (same
day). SHY-0218's spec covers the client-facing APIs only.

Measured on `origin/develop` 661f0ae5722: **11 routes** in
`routes/test-helpers.js`, mounted only when `NODE_ENV` is not `production`
(`index.js`): `POST /test/setup`, `GET /test/verify/:collection/:id`,
`POST /test/create-user`, `POST /test/write/:collection`,
`POST /test/mint-id-token`, `POST /test/teardown`, `GET /test/fcm-captures`,
`POST /test/fcm-captures/clear`, `POST /test/run-cron/:cronName`,
`POST /test/reset`, `POST /test/clear/:collection`.

## Acceptance Criteria

### Happy path

- [ ] A hand-written `express-api/openapi/test-helpers.yaml` (never generated)
      documents all 11 routes, every status and error.
- [ ] Contract tests (integration suite, local stack) hold the real routes to
      the spec.
- [ ] The spec is served on its own private docs page on **dev only**
      (SHY-0587), every operation tryable there.

### Error paths

- [ ] An in-sync check fails CI when a route in `test-helpers.js` has no spec
      entry, or the reverse.

### Edge cases

- [ ] Production serves neither the routes nor the page nor the spec: a test
      with `NODE_ENV=production` asserts 404 for all three.

### Performance

- [ ] N/A: no route changes.

### Security

- [ ] Planted: on dev, the page and spec refuse a signed-out request and an
      ordinary user's token.
- [ ] `POST /test/mint-id-token` is documented with a warning that it mints
      sign-in tokens, and the production-404 test names it.

### UX

- [ ] Each operation names which test suite uses it.

### i18n

- [ ] N/A: operator-only developer docs, English only.

### Observability

- [ ] The contract suite reports how many of the 11 routes it checked, with a
      recorded floor.

## BDD Scenarios

**Scenario: The test helpers never reach production**

- **Given** the API runs with `NODE_ENV=production`
- **When** anyone requests a test-helper route, its docs page or its spec
- **Then** each answers 404

## Test Plan

1. RED first: contract and production-404 tests against an empty spec.
2. Mutations: mount the helpers in production; drop a spec entry; each goes red.

## Out of Scope

- Changing what the helpers do.

## Dependencies

- SHY-0587 (page and gate).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The dev page makes destructive helpers (`/test/reset`) one click away | Dev data only, behind Shyden's sign-in; the page labels them destructive. |

## Definition of Done

- [ ] Spec, contract tests and page merged; contract step required in CI.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from the global Swagger rule.
