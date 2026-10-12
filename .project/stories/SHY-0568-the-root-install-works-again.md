---
id: SHY-0568
status: Done
owner: claude
created: 2026-10-12
priority: P0
effort: S
estimate: 2
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0568: The root install works again after an unsupported firebase major

## User Story

As the operator whose dev deploy, integration, Playwright and QA-runner
jobs all run `npm ci` at the repository root, I want that install to
resolve, so that no CI job and no laptop setup stops before its first test.

## Why

Dependabot PR #2190, auto-merged at 06:36Z on 2026-10-12, moved the root
`firebase` from 12.18.0 to 13.0.0. The root `@firebase/rules-unit-testing`
5.0.2 peers `firebase ^12.0.0`, so every root `npm ci` on develop fails with
ERESOLVE (measured on develop at `6bdb58194d3`; found setting up a worktree).
Root installs run in `deploy-dev.yml` (twice), `integration-tests.yml`,
`playwright-tests.yml`, `manual-qa-matrix.yml` and
`qa-runner-driver-checks.yml`. The bump's own checks never installed the root
packages (SHY-0571), the auto-merge judged it a minor update (SHY-0569), and
the root integration specs have never run on firebase 13. This restores the
last tested state; the upgrade is SHY-0570.

## Acceptance Criteria

### Happy path

- [x] The root `npm ci` succeeds on this branch.
      _Proof: exit 0, no `npm error` line; installs firebase 12.18.0 beside
      rules-unit-testing 5.0.2 (develop: ERESOLVE)._
- [x] #2190 is reverted (`git revert 445895e460e`; `package.json` and
      `package-lock.json` only; applied cleanly).

### Error paths

- [x] A test reads the root lockfile and fails when the locked firebase does
      not satisfy the locked rules-unit-testing peer range, and refuses a
      range it cannot read.
      _Proof: `root-firebase-peer.test.js` (4); develop's lockfile put back
      turns the peer test red (1 of 4)._

### Edge cases

- [x] Dependabot does not reopen the root firebase major on its own.
      _Proof: an `ignore` on the root npm entry (`firebase`, semver-major),
      pinned by a test; removing it turns that test red (1 of 4)._

### Performance

- [x] The new test runs in-process and reads two files.

### Security

- [x] No dependency is newer than its tested version; the ignore names one
      package, majors only.

### UX

- [x] Not applicable.

### i18n

- [x] Not applicable.

### Observability

- [x] A failed peer check prints both majors.

## BDD Scenarios

**Scenario: a dev deploy installs the root packages**

- **Given** develop with this change
- **When** `npm ci` runs at the repository root
- **Then** it resolves and the job reaches its tests

## Test Plan

- `root-firebase-peer.test.js`; a root `npm ci` on the branch; two mutations.

## Out of Scope

- The firebase 13 upgrade (SHY-0570), auto-merge (SHY-0569), a PR job that
  installs the root packages (SHY-0571).

## Dependencies

- None.

## Risks & Mitigations

- **This PR's checks cannot prove the root install** (SHY-0571): proven on
  the laptop (an install, not a test run); the next dev deploy installs there.

## Definition of Done

- [x] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the next dev deploy's root install green.
      _Proof: PR #2291 run 38230725115 on `190c3c5f4c2` green by job name; merged as `2d2f77bc9b2`; dev deploy run 38232961859 from that commit green by every job name, including Dev Smoke Tests and Seed Dev Personas, which install the root packages._

## Notes

- **2026-10-12**: Found when `npm ci` failed in a fresh docs worktree.
  `no-retired-org-name` floor 1984 -> 1985 for the new test (measured).
  Scored 2.
