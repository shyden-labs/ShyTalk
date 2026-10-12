---
id: SHY-0564
status: Draft
owner: claude
created: 2026-10-12
priority: P0
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0564: Git hooks run in every worktree, and a commit made without them is caught in CI

## User Story

As the operator relying on the secret scan and the force-push guard, I
want every checkout of ShyTalk to run the repo's git hooks, and CI to run
the secret scan too, so that a commit from a fresh worktree cannot skip
them without anyone knowing.

## Why

Measured 2026-10-12: `core.hooksPath` is `.husky/_`, a relative path to a
folder `npm install` creates at the repo root. A linked worktree has no
root `node_modules`, so 5 of 7 ShyTalk worktrees had no `.husky/_` and ran
no hook at all: no secret scan, no lint-staged, no force-push guard, and
nothing said so. SHY-0544's commits came from one of them, which is how
two lines the secret scan matches reached develop (SHY-0565). CI runs no
secret scan, so nothing caught them later either.

## Acceptance Criteria

### Happy path

- [ ] A commit in a fresh linked worktree runs the pre-commit hook, and a
      push runs the pre-push hook, with no install step in that worktree.
- [ ] CI runs `scripts/scan-secrets.js` over each pull request's diff
      against its base, as a required check.

### Error paths

- [ ] A checkout whose hooks cannot run says so loudly at commit time, or
      the commit is refused; it never passes silently.

### Edge cases

- [ ] A worktree created before the fix is covered too (each of today's
      worktrees checked).

### Performance

- [ ] The CI scan's time is recorded.

### Security

- [ ] A planted secret in a PR from a hookless checkout is refused by CI.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The CI scan prints how many added lines it read.

## BDD Scenarios

**Scenario: a secret is committed from a fresh worktree**

- **Given** a worktree made with `git worktree add` and no install
- **When** a line holding a credential is committed and pushed
- **Then** the commit is refused, or the pull request's secret scan fails

## Test Plan

- Unit tests of whatever resolves the hooks path; a CI run on a PR with a
  planted secret shown red.

## Out of Scope

- What the scan allows (SHY-0565).

## Dependencies

- SHY-0565 (the scanner the CI step runs).

## Risks & Mitigations

- **An absolute hooks path breaks other clones.** Prefer a mechanism that
  resolves from the worktree itself.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Found when a merge commit in the main checkout (hooks
  present) was refused for lines committed from `../ShyTalk-0544` (no
  hooks). Scored 5: a hooks-path mechanism, a CI job made required, and a
  planted-secret proof.
