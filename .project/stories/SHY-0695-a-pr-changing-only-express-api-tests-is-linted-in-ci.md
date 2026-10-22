---
id: SHY-0695
status: Draft
owner: claude
created: 2026-10-22
priority: P0
effort: S
estimate: 2
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0695: a PR changing only express-api tests is linted in CI

## User Story

As the operator, I want every changed express-api test file checked by ESLint
and Prettier in CI, so that a test-only PR cannot merge unformatted or
lint-failing code with the Lint job showing green.

## Why

Found 2026-10-22 on PR #2538 (SHY-0691), PR Checks run 39706932267: the PR
changed four files under `express-api/tests/`, and the Lint job's step
"Express lint (ESLint + Prettier)" was **skipped** while the job reported
success.

Measured on develop 0b73c3b0a83:

- `.github/workflows/pr-checks.yml` routes `express-api/tests/*` to
  `BACKEND_TESTS=true` only (SHY-0339, so a test edit does not force every
  client suite). `backend_changed` stays false.
- `.github/workflows/lint.yml:73` runs Express lint only when
  `inputs.backend_changed == true` (or a dispatch). Nothing passes
  `backend_tests_changed` to it.

So a test-only PR is linted only by the author's local pre-commit hook,
which CI does not check. "A check is green only if it ran and passed"
(global rule, 2026-10-18): this is a skip-and-succeed, so P0.

## Acceptance Criteria

### Happy path

- [ ] A PR whose only express-api changes are under `express-api/tests/`
      runs "Express lint (ESLint + Prettier)", and it must succeed.
- [ ] A PR touching no express-api file still skips it (no new cost).

### Error paths

- [ ] Proven live: a scratch draft PR (never merged) adding one
      unformatted line to an express-api test file fails the Lint job on
      that step, by name.

### Edge cases

- [ ] `express-api/tests/scripts/drivers/*` (its own arm in Detect Changes)
      is linted too.

### Performance

- [ ] The step's added time on test-only PRs is measured and stated.

### Security

- [x] Not applicable.

### UX

- [x] Not applicable: CI only.

### i18n

- [x] Not applicable: no copy.

### Observability

- [x] Not applicable: the step's own name and result.

## Announce

None: CI only.

## BDD Scenarios

**Scenario: a test-only PR**

- **Given** a PR changing only `express-api/tests/foo.test.js`
- **When** PR Checks runs
- **Then** "Express lint (ESLint + Prettier)" runs and passes, or the Lint
  job fails

## Test Plan

- RED first: a workflow test feeding Detect Changes' routing a tests-only
  change list and asserting the lint step's condition is true (the step
  condition read from parsed YAML, the routing run under bash).
- The scratch draft PR above.

## Out of Scope

- Root `scripts/` linting (SHY-0585).

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** existing unformatted test files turn the step red at once.
  **Mitigation:** run `npm run lint` on develop first and fix in the same
  PR (lint-staged has formatted every committed file, so expected clean).

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-22**: filed during SHY-0691's live proof (this filing is proof
  PR A). P0: a skip-and-succeed gate. Scored 2: one condition, one routing
  test, one planted proof.
