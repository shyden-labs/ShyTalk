---
id: SHY-0566
status: Draft
owner: claude
created: 2026-10-12
priority: P1
effort: L
estimate: 8
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
blocked_by: [SHY-0595]
---

# SHY-0566: ShyTalk runs on Node 26, 26.3 or later, everywhere

## User Story

As the operator whose Mac now defaults to Node 26, I want ShyTalk's local
tools, hooks and CI to run on Node 26, so that a push no longer needs a
pinned Node 24 on PATH and every project runs the same runtime.

## Why

Global rule (Shyden, 2026-10-08, "move them all to 26"): every project runs
Node 26, 26.3 or later; `.nvmrc` `26`; `engines.node`
`^24.16.0 || >=26.3.0` (24 stays because Dependabot's npm updater installs on
24); `@types/node` on the 26 line with a Dependabot ignore for majors above
`.nvmrc`; a test pinning all of it; per-test CPU on 26 vs 24 in the PR (no
regression). Done by each repo's own session; yawelo-idle #501 / PR #507 is
the worked example.

Measured on develop at `f627c6a7118` (unchanged on `b7c0d708dc4`): `.nvmrc` is `24`;
`express-api/package.json` engines `>=24 <25`; no `@types/node` in either
package; 7 workflows pin a Node version: six on 24 and
`sync-roadmap-data.yml` on **20**. `scripts/check-node-version.sh` (run by
pre-push) refuses the Mac's default 26, so since hooks run in every
worktree again (SHY-0564) each push needs
`PATH="/opt/homebrew/opt/node@24/bin:$PATH"`. Its message records that
Node 26.3.0 wedged the full Jest suite on 2026-06-09.

## Acceptance Criteria

### Happy path

- [ ] `.nvmrc`, both `engines` fields and every workflow's Node version
      follow the global rule; `sync-roadmap-data.yml` leaves Node 20.
- [ ] A test pins `.nvmrc`, the engines ranges, every workflow's Node
      version (derived from the workflow files) and the Dependabot ignore.
- [ ] A push from the Mac's default Node 26 passes the pre-push node guard.

### Error paths

- [ ] The node guard still refuses a major the pins do not allow (24 is
      allowed by range, 22 refused), with a test per case.

### Edge cases

- [ ] The full Jest suite runs to completion on 26 in CI (the 2026-06-09
      wedge is checked for, with the run time recorded).

### Performance

- [ ] Per-test CPU on 26 vs 24 is measured and recorded in the PR; no test
      regresses past its limit.

### Security

- [ ] Not applicable beyond the Dependabot ignore.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The node guard prints the version it found and the range it allows.

## BDD Scenarios

**Scenario: a push from the Mac's default Node**

- **Given** the Mac runs Node 26
- **When** a ShyTalk branch is pushed
- **Then** the pre-push node guard passes

## Test Plan

- Pin test over the version files; guard cases; a CI run of the full
  suites on 26; the CPU comparison.

## Out of Scope

- Kotlin and iOS toolchains.

## Dependencies

- None.

## Risks & Mitigations

- **The 2026-06-09 Jest wedge on 26.3.0.** Measured first on the current 26
  release in CI; any wedge is a defect filed with its trace, never a pin
  back to 24 without Shyden.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Filed when the pre-push node guard, running again in a
  fixed worktree, refused Node 26. Scored 8 from measurement: seven
  workflows, two package files, the guard and its test, a pin test, and a
  per-test CPU comparison across two runtimes.
- **2026-10-15**: Blocked by SHY-0595. On Node 26 (npm 11.20) `npm ci`
  warns about 5 undecided install scripts (`bcrypt` among them); warnings
  are build failures, so CI on Node 26 needs those decisions first.
