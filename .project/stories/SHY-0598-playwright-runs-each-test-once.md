---
id: SHY-0598
status: Draft
owner: unassigned
created: 2026-10-15
priority: P0
effort: S
estimate: 2
type: bug
roadmap_ids: []
mvp: false
blocked_by: [SHY-0597]
---

# SHY-0598: Playwright runs each test once, so a flaky test is red

## User Story

As **Shyden, the operator**, I want every browser test to run once and its
first result to count, so that a test that fails some of the time is seen
and fixed instead of being passed on a second try.

## Why

Found 2026-10-15 while reading the nightly browser run.

- Shyden's global rule (2026-10-02): a retry is not a fix; no retries,
  re-runs or try-twice wrappers; existing retries are ticketed defects.
- `playwright.config.ts:42` on `origin/develop` 4d7c8f1d951:
  `retries: 1,`. It is the only retry: `playwright.integration.config.ts:41`
  has `retries: 0` ("Integration tests must be deterministic"), and no
  workflow or `package.json` passes `--retries`.
- Its cost, measured on nightly 38694041358 (2026-10-15): firefox, webkit
  and mobile-safari each reported `1 flaky`
  (`admin-users-profile.spec.ts:36`) and went green only on the retry.
  Every failing test also ran twice before it was reported.

## Acceptance Criteria

### Happy path

- [ ] `playwright.config.ts` sets `retries: 0`.
- [ ] A guard test fails if any Playwright config, workflow or npm script
      sets retries above 0 or passes `--retries` (read from the stripped
      source text, with the population counted and floored).

### Error paths

- [ ] A test that fails once is reported red; the guard is mutation-checked
      by planting `retries: 1` and `--retries=1`, each going red.

### Edge cases

- [ ] `repeatEach` or a test-level `test.describe.configure({ retries })` is
      refused the same way.

### Performance

- [ ] Nightly time falls or stays level (no failing test runs twice);
      measured on the first nightly after merge.

### Security

- [ ] N/A.

### UX

- [ ] N/A.

### i18n

- [ ] N/A.

### Observability

- [ ] The nightly's summary shows no `flaky` line; any flaky test now
      appears as `failed`.

## BDD Scenarios

**Scenario: a test that fails once is red**

- **Given** a browser test fails on its first run
- **When** the suite finishes
- **Then** the run is red and names that test, with no second attempt

## Test Plan

1. RED first: the guard test against today's config (sees `retries: 1`).
2. Set `retries: 0`; guard green; plant each form and watch it go red.
3. After merge: read the next nightly's summary by job name.

## Out of Scope

- Fixing the tests that were flaky: SHY-0597 owns the one measured.

## Dependencies

- Blocked by SHY-0597: with retries off, the flaky
  `admin-users-profile.spec.ts:36` turns every browser test run red,
  including PR runs that include the web suite.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Other flaky tests surface once retries stop hiding them | Each is filed as its own defect with its error text and duration, never re-run. |

## Definition of Done

- [ ] A nightly after merge with no `flaky` line, quoted in Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from nightly 38694041358. Measured on
  `origin/develop` 4d7c8f1d951.
