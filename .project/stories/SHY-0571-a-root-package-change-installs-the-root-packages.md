---
id: SHY-0571
status: Draft
owner: claude
created: 2026-10-12
priority: P0
effort: S
estimate: 3
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0571: A change to the root packages runs a PR check that installs them

## User Story

As the operator merging dependency updates, I want any change to the root
`package.json` or `package-lock.json` to run a required check that installs
the root packages, so that a broken install is seen on the PR, not on
develop.

## Why

Measured 2026-10-12: PR #2190 changed the root `package.json` and lockfile
and ran Detect Changes, Pre-Merge Gate, Lint, SonarCloud, PR Gate and
CodeQL; none installs the root packages, because `pr-checks.yml`'s change
detection maps a root package change to no job. The broken install
(SHY-0568) reached develop unseen.

## Acceptance Criteria

### Happy path

- [ ] A root `package.json` or `package-lock.json` change sets a change flag
      that runs a job doing `npm ci` at the root, and PR Gate requires it.

### Error paths

- [ ] An install error fails the job by name; a skip the flags did not ask
      for fails PR Gate (SHY-0559's rule).

### Edge cases

- [ ] A planted conflicting peer in a PR turns the job red.

### Performance

- [ ] The job's time is recorded.

### Security

- [ ] Not applicable.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The job prints the npm error it failed on.

## BDD Scenarios

**Scenario: a root package bump breaks the install**

- **Given** a PR changing the root `package.json` to an unresolvable peer
- **When** its checks run
- **Then** the root install job fails and PR Gate blocks the merge

## Test Plan

- A pin of the detection rule; a planted PR shown red, then green.

## Out of Scope

- `express-api`'s install, which its own jobs already do.

## Risks & Mitigations

- **A slower PR for every root bump.** Measured and recorded; the install
  is cached.

## Dependencies

- None.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Split from SHY-0569 so the auto-merge fix lands first.
  Scored 3.
