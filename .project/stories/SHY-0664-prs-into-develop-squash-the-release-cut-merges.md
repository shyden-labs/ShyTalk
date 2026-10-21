---
id: SHY-0664
status: Draft
owner: claude
created: 2026-10-21
priority: P2
effort: S
estimate: 3
type: chore
roadmap_ids: []
mvp: false
---

# SHY-0664: Pull requests into develop squash; the release cut into main merges

## User Story

As the operator, I want every pull request into `develop` to land as one
squashed commit and the release cut into `main` to land as a merge commit,
so that no commit on `develop` fails on its own and `develop` and `main`
keep a shared history.

## Why

Shyden's global rule of 2026-10-21 (reference-branching-and-deploy.md,
"SQUASH INTO DEVELOP"; his words: "i think all repos should be squash
merging", then "Develop only"). PR #2495's first commit (3704ba8f9ed) failed
CI on its own; the fix came as a later commit because force-push is banned.
Squashing lands only the green whole.

Measured 2026-10-21: every PR into `develop` already landed squashed, but
only by habit. All three merge methods are enabled. Ruleset `main`
(12613584) targets `~DEFAULT_BRANCH`, which is `develop`, and allows merge,
squash and rebase; `main-branch` (24965924) targets `refs/heads/main` with
all three. The ShyTalk App has `administration: read` only, and both
rulesets' `bypass_actors` read `null` to it, so the App must not rewrite
them: the settings are Shyden's clicks.

## Acceptance Criteria

### Happy path

- [ ] Ruleset `main` (12613584, the default branch, `develop`) allows
      `squash` only; read back from the API.
- [ ] Ruleset `main-branch` (24965924, `refs/heads/main`) allows `merge`
      only; read back from the API.
- [ ] Settings > General: "Allow rebase merging" is off; squash and merge
      commits stay on; read back from the API.
- [ ] A PR Checks step reads `GET /repos/shyden-labs/ShyTalk/rules/branches/develop`
      and `.../main` with the job's token and fails unless `develop` allows
      `squash` alone and `main` allows `merge` alone.

### Error paths

- [ ] The step fails, naming the branch and the methods it read, when a
      branch has no `pull_request` rule or the API call fails; it never
      passes on an empty read.

### Edge cases

- [ ] Two rulesets on one branch: the step reads the effective rules for
      the branch (the endpoint merges every active ruleset), not one
      ruleset by id.

### Performance

- [ ] Not applicable: two API calls.

### Security

- [ ] No App gains `administration: write`; the step uses the job's
      read-only token.

### UX

- [ ] Not applicable: no user surface.

### i18n

- [ ] Not applicable: no copy.

### Observability

- [ ] The step summary prints each branch's allowed methods as read.

## Announce

Not announced: an internal workflow change.

## BDD Scenarios

**Scenario: a pull request into develop can only be squashed**

- **Given** a green pull request into `develop`
- **When** someone merges it
- **Then** GitHub offers only "Squash and merge", and `develop` gains one
  commit

## Test Plan

- Workflow test pinning the step, its endpoint and its expected methods.
- The step planted RED against a fixture that allows `rebase` on `develop`.

## Out of Scope

- Other repos and repo-template: their own sessions
  (`global-rules/pending-squash-into-develop.md`).

## Dependencies

- Shyden's three settings clicks (asked 2026-10-21).

## Risks & Mitigations

- A bot that pushes to `develop` relies on a hidden bypass: the settings
  change only the allowed merge methods, never `bypass_actors`, and the App
  rewrites no ruleset.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-21**: filed. PR #2495 merged with `--squash
  --match-head-commit` as f52d9e21bd1 (one parent, 43e9ced4c73).
