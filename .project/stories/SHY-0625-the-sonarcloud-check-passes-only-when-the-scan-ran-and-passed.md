---
id: SHY-0625
status: In Review
owner: claude
created: 2026-10-18
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0625: The SonarCloud check passes only when the scan ran and the code passed

## User Story

As the operator relying on a green pull request, I want the SonarCloud
check to fail whenever it did not scan the code or SonarCloud's quality
gate failed it, so that green always means the code was scanned and
passed.

## Why

Shyden, 2026-10-18: *"this is bad. don't pass if it doesn't run"*, then
*"it needs to check. ... make sure we check the results and fail the
workflow if it fails"* (his 2026-10-12 ruling on SHY-0561: *"we need this
gate, somewhere. probably in ci and we can make our own fail-stop
depending on the result returned"*).

Measured 2026-10-18 from `.github/workflows/sonarcloud.yml` on develop,
the PR Checks run history and SonarCloud's public API:

- When `SONAR_TOKEN` is missing, the step `Skip SonarCloud (no token)`
  prints a warning and succeeds (lines 186-190), so the job is green with
  no scan. Dependabot PRs never receive the token: on 2026-10-12 the
  firebase-12.19.0 and ktor-3.6.0 updates both show `Run SonarCloud
  analysis` skipped and the fallback green.
- ShyTalk's own PRs do scan: `Run SonarCloud analysis` succeeded on both
  completed heads of #2395 (runs 39056488493, 39060649514).
- The scan step (`./gradlew sonar`, line 184) uploads and ends; nothing
  waits for or reads the quality gate, so the job is green whatever
  SonarCloud decides. The only blocking gate today is the main-only
  pre-push (`-Dsonar.qualitygate.wait=true`), which SHY-0561 removes.
- SonarCloud does return a verdict per pull request on the free plan:
  `api/qualitygates/project_status?projectKey=ShydenMcM_ShyTalk&pullRequest=2395`
  gave `OK` for head `f2865ed0638`. `develop` is never analysed (404);
  `main` is `ERROR` (SHY-0152, #1888).
- The fallback Kotlin test step ends in `|| true` (line 176), so failing
  Kotlin tests still let the scan run on partial coverage. The Jest step
  above it already dropped its `|| true` for this reason (line 147).

Shyden's decision (AskUserQuestion, 2026-10-18): **give Dependabot the
key**. He adds `SONAR_TOKEN` as a Dependabot secret, so Dependabot PRs
are scanned like any other. The same day he chose that every project
and the template adopt a blocking SonarCloud gate (repo-template and
each project's own ticket); this story is ShyTalk's.

## Acceptance Criteria

### Happy path

- [ ] After the scan, the job reads SonarCloud's quality-gate verdict for
      this pull request's analysis (the analysis the scan just made, not
      an older one) and is green only on `OK`.
- [ ] A Dependabot PR that touches code is scanned and its verdict read,
      proven on one real Dependabot PR after Shyden adds the secret.

### Error paths

- [ ] A verdict of `ERROR` fails the job and the PR Gate, naming each
      failed condition with its value and threshold.
- [ ] With the token missing, the job fails with a message naming
      `SONAR_TOKEN` and where it is set (Actions secret, or Dependabot
      secret for Dependabot PRs); no step skips the scan and succeeds.
- [ ] A verdict that cannot be read (API error, no analysis for this
      commit, still pending at a stated ceiling) fails closed, naming
      what was missing. No retry loop: one wait on the analysis task with
      a measured ceiling.
- [ ] The fallback Kotlin test step fails when a Kotlin test fails (no
      `|| true`), so the scan never runs on partial coverage.

### Edge cases

- [ ] A PR whose changes skip the whole Sonar job by design (docs-only
      fast path) is unchanged: the PR Gate's handling of a skipped job is
      SHY-0559's, not this story's.
- [ ] The verdict read matches the PR head SHA; a verdict for another
      commit fails the job.
- [ ] A guard test in `express-api/tests/scripts/` reads the workflow and
      refuses any step that runs when the token is empty and exits 0, any
      `|| true` on a test or scan command, and a scan with no verdict
      step after it; each planted form watched red.

### Performance

- [ ] The verdict wait is measured on three PRs and its ceiling set from
      the slowest, written beside the step.

### Security

- [ ] The token is still read only from secrets, never echoed; the
      Dependabot secret is the only new home. (The free plan has no
      scan-only token: the Dependabot secret holds a personal token,
      `shytalk-ci-2026-10-18`, expiring 2027-10-18; see Notes.)

### UX

- [ ] None: no user-facing change.

### i18n

- [ ] None: no copy.

### Observability

- [ ] The job summary says whether the scan ran, the verdict, and on
      failure why, with the SonarCloud link.

## BDD Scenarios

**Scenario: the code fails the quality gate**

- **Given** a PR whose new code SonarCloud grades `ERROR`
- **When** the SonarCloud job runs
- **Then** it fails naming the failed conditions, and the PR Gate is red

**Scenario: no token**

- **Given** a PR run where `SONAR_TOKEN` is empty
- **When** the SonarCloud job runs
- **Then** it fails naming `SONAR_TOKEN`, and the PR Gate is red

**Scenario: the verdict cannot be read**

- **Given** the scan uploaded but SonarCloud returns no verdict in time
- **When** the job's ceiling passes
- **Then** it fails saying the verdict was not read, never green

**Scenario: a failing Kotlin test in the fallback**

- **Given** no build artifacts were downloaded and a Kotlin test fails
- **When** the fallback test step runs
- **Then** the job fails before the scan

**Scenario: a passing PR**

- **Given** a PR whose new code SonarCloud grades `OK`
- **When** the SonarCloud job runs
- **Then** it is green and its summary shows `OK` with the link

## Test Plan

- Guard test on the workflow text (stripped of comments), mutation-
  verified with each planted form.
- Unit tests for the verdict reader with the HTTP calls stood in: OK,
  ERROR, pending past the ceiling, an API error, a verdict for another
  commit.
- CI: one run green (scan and verdict steps by name), one planted ERROR
  watched red, one Dependabot PR after the secret is added.

## Out of Scope

- Removing the pre-push Sonar block: SHY-0561 (#2281), which waits on
  this story so the gate is never dropped with nothing in its place.
- How the PR Gate treats a skipped job: SHY-0559 (#2279).
- Clearing main's existing `ERROR`: SHY-0152 (#1888).
- The template and the other projects: their own tickets.

## Dependencies

- Shyden adds `SONAR_TOKEN` under Settings > Secrets and variables >
  Dependabot (the App cannot set secrets). Until then Dependabot code PRs
  are red, which is the honest state.

## Risks & Mitigations

- Dependabot code PRs go red between the merge and the secret: ask
  Shyden to add the secret before the merge.
- Open PRs with new-code findings go red at once: that is the point; list
  them in the PR when it lands.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      develop; the guard and an ERROR verdict each watched red once.

## Notes

- **2026-10-18**: Filed from SHY-0605 after two side-agent notes on #2395
  (no scan without the token; no verdict read).
- **2026-10-18**: Nobody held the Actions secret's value, so a new
  SonarCloud token `shytalk-ci-2026-10-18` (expires 2027-10-18) was made
  from Shyden's signed-in tab and kept in this Mac's Keychain (service
  `shytalk-sonarcloud-token`); Shyden set it as the Dependabot secret from
  his own terminal (the App has no secrets permission, so it cannot read
  the secret back). The Actions secret still holds the older token. When
  the token expires the scan fails red, never silently.
