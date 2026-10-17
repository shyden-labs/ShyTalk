---
id: SHY-0625
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0625: The SonarCloud check fails when it cannot scan

## User Story

As the operator relying on a green pull request, I want the SonarCloud
check to fail whenever it did not scan the code, so that green always
means the scan ran.

## Why

Shyden, 2026-10-18: *"this is bad. don't pass if it doesn't run"*.

Measured 2026-10-18 from `.github/workflows/sonarcloud.yml` on develop
and the PR Checks run history:

- When `SONAR_TOKEN` is missing, the step `Skip SonarCloud (no token)`
  prints a warning and succeeds (lines 186-190), so the job is green with
  no scan. Dependabot PRs never receive the token: on 2026-10-12 the
  firebase-12.19.0 and ktor-3.6.0 updates both show `Run SonarCloud
  analysis` skipped and the fallback green.
- ShyTalk's own PRs do scan: `Run SonarCloud analysis` succeeded on both
  completed heads of #2395 (runs 39056488493, 39060649514).
- The fallback Kotlin test step ends in `|| true` (line 176), so failing
  Kotlin tests still let the scan run on partial coverage. The Jest step
  above it already dropped its `|| true` for this reason (line 147).

Shyden's decision (AskUserQuestion, 2026-10-18): **give Dependabot the
key**. He adds `SONAR_TOKEN` as a Dependabot secret, so Dependabot PRs
are scanned like any other.

## Acceptance Criteria

### Happy path

- [ ] With the token present, the job scans and is green only when the
      scan step succeeded.
- [ ] A Dependabot PR that touches code is scanned, proven on one real
      Dependabot PR after Shyden adds the Dependabot secret.

### Error paths

- [ ] With the token missing, the job fails with a message naming
      `SONAR_TOKEN` and where it is set (Actions secret, or Dependabot
      secret for Dependabot PRs); no step skips the scan and succeeds.
- [ ] The fallback Kotlin test step fails when a Kotlin test fails (no
      `|| true`), so the scan never runs on partial coverage.

### Edge cases

- [ ] A PR whose changes skip the whole Sonar job by design (docs-only
      fast path) is unchanged: the PR Gate's handling of a skipped job is
      SHY-0559's, not this story's.
- [ ] A guard test in `express-api/tests/scripts/` reads the workflow and
      refuses any step that runs when the token is empty and exits 0, and
      any `|| true` on a test or scan command; each planted form watched
      red.

### Performance

- [ ] None: no extra work in the job.

### Security

- [ ] The token is still read only from secrets, never echoed; the
      Dependabot secret is the only new home (scan-only key).

### UX

- [ ] None: no user-facing change.

### i18n

- [ ] None: no copy.

### Observability

- [ ] The job summary says whether the scan ran, and on failure why.

## BDD Scenarios

**Scenario: no token**

- **Given** a PR run where `SONAR_TOKEN` is empty
- **When** the SonarCloud job runs
- **Then** it fails naming `SONAR_TOKEN`, and the PR Gate is red

**Scenario: a failing Kotlin test in the fallback**

- **Given** no build artifacts were downloaded and a Kotlin test fails
- **When** the fallback test step runs
- **Then** the job fails before the scan

**Scenario: a Dependabot PR after the secret is added**

- **Given** `SONAR_TOKEN` is a Dependabot secret
- **When** a Dependabot PR touching code runs PR Checks
- **Then** `Run SonarCloud analysis` succeeds and no skip step exists

## Test Plan

- Guard test on the workflow text (stripped of comments), mutation-
  verified with each planted form.
- CI: one run with the token present (green, scan step by name), one
  Dependabot PR after the secret is added.

## Out of Scope

- Waiting for and enforcing SonarCloud's quality-gate result: SHY-0561
  (#2281).
- How the PR Gate treats a skipped job: SHY-0559 (#2279).

## Dependencies

- Shyden adds `SONAR_TOKEN` under Settings > Secrets and variables >
  Dependabot (the App cannot set secrets). Until then Dependabot code PRs
  are red, which is the honest state.

## Risks & Mitigations

- Dependabot code PRs go red between the merge and the secret: ask
  Shyden to add the secret before the merge.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      develop; the guard planted red once.

## Notes

- **2026-10-18**: Filed from SHY-0605 after a side agent's note on #2395.
