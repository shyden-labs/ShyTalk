---
id: SHY-0557
status: Draft
owner: claude
created: 2026-10-12
priority: P0
effort: XS
estimate: 1
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0557: The gauntlet runs from a git worktree

## User Story

As a developer working in a linked worktree, I want the gauntlet scripts to
accept that checkout, so that I can run and test them without moving back to
the main checkout.

## Why

Measured 2026-10-12 in the SHY-0544 worktree (`ShyTalk-0544`):
`express-api/scripts/gauntlet/lib.sh:61` is
`require_repo() { [ -d "$REPO/.git" ] || die "repo not found at $REPO (set SHYTALK_REPO)"; }`.
In a linked worktree `.git` is a FILE pointing at the main repository, so
the test is false and every gauntlet command dies with "repo not found".
Ten tests in `tests/scripts/50-matrix-cmd-stop.test.js` and
`tests/scripts/runner-process-identity.test.js` fail in any worktree for
this reason alone, and pass in the main checkout.

## Acceptance Criteria

### Happy path

- [ ] `require_repo` accepts a main checkout (`.git` directory) and a
      linked worktree (`.git` file), judged by asking git, not by the
      shape of `.git`.
- [ ] Both test files pass from a linked worktree.

### Error paths

- [ ] A path that is not a git checkout still dies with the same message.

### Edge cases

- [ ] `SHYTALK_REPO` pointing at a worktree is accepted.

### Performance

- [ ] Not applicable.

### Security

- [ ] Not applicable.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] Not applicable.

## BDD Scenarios

**Scenario: A worktree is a repository**

- **Given** the gauntlet run from a linked worktree
- **When** `require_repo` runs
- **Then** it passes

## Test Plan

- The check's logic tested for a directory, a file and neither. The tests
  that start the shell scripts belong to the non-unit suite (SHY-0546).

## Out of Scope

- Moving the process-starting tests out of the unit suite (SHY-0546).

## Dependencies

- None.

## Risks & Mitigations

- None known.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Found running `tests/scripts` for SHY-0544. Scored 1: one
  line and its tests.
