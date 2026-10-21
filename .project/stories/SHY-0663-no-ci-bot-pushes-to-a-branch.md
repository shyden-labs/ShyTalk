---
id: SHY-0663
status: Draft
owner: claude
created: 2026-10-21
priority: P2
effort: XL
estimate: 13
type: chore
roadmap_ids: []
mvp: false
---

# SHY-0663: No ShyTalk CI bot pushes to a branch

## User Story

As the operator, I want no CI bot to commit or push to any branch, so that
every commit on `develop`, `main` and `gh-pages` is one a person pushed and
reviewed, and no bot moves a branch under an open pull request.

## Why

Shyden's global rule of 2026-10-21 (reference-branching-and-deploy.md, "A CI
bot never pushes to a branch"): a bot measures a scratch ref, holds no write
token, pushes nothing and returns an artifact the session folds into its
unpushed commit. Shyden ruled for ShyTalk on 2026-10-21: "Convert, keep
running": one ticket converts every bot that pushes; they keep running until
it lands.

Measured on `develop` 43e9ced4c73:

- `sync-stories-to-issues.yml`: on a story change reaching `develop`,
  commits `board-items.json` to `develop` (createCommitOnBranch, Release App
  token). SHY-0584 (#2327) already plans the id-map inside the PR.
- `sync-roadmap-data.yml`: on push to `main`, commits roadmap data to `main`.
- `allure-report.yml`: moves `gh-pages` with `git push --force-with-lease`.
- `release-tag.yml` and `.github/actions/publish-gh-pages`: push to `gh-pages`.
- `release.yml`: commits the version bump to `main`.

## Acceptance Criteria

### Happy path

- [ ] No workflow or action holds a write token for, or pushes, commits to or
      moves, any branch (`git push`, `createCommitOnBranch`, a contents write);
      each former bot uploads its files and commit lines as an artifact.
- [ ] The board id-map arrives inside the story PR (SHY-0584's design, folded
      here or landed first), so `develop` never moves after a merge.
- [ ] The roadmap data and the release version bump arrive in the commit a
      person pushes, and the dev and live roadmaps still update from the board
      as soon as it changes.
- [ ] Allure reports and the site are published without a pushed branch
      (Pages deployment from an artifact), so nothing force-pushes.

### Error paths

- [ ] A bot whose artifact is missing or empty fails naming it; nothing is
      committed for it.

### Edge cases

- [ ] A scratch ref (`refs/floors/<branch>` style) starts no push, PR or deploy
      run, and is deleted after use.

### Performance

- [x] Not applicable.

### Security

- [ ] A workflow test fails on any workflow or action that can write a branch
      (contents: write with a push or commit command, a minted App token used
      to commit), one test per file, seen RED on today's files first.

### UX

- [x] Not applicable.

### i18n

- [x] Not applicable.

### Observability

- [ ] Each converted job's summary names the artifact it produced and its size.

## Announce

Not announced: internal CI change.

## BDD Scenarios

**Scenario: a story merge moves no branch**

- **Given** a story PR merged into `develop`
- **When** the board sync runs
- **Then** `develop`'s head is still the merge commit and the issue exists

## Test Plan

- Workflow tests, one per workflow file, RED on today's files first.
- A real story PR walked end to end on dev.

## Out of Scope

- Changing what the board, roadmap or reports show.

## Dependencies

- Builds on SHY-0584 (#2327).

## Risks & Mitigations

- The roadmap stops updating while converting: each bot is replaced only when
  its successor is green on dev.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-21**: Filed from the global rule and Shyden's ruling for ShyTalk
  ("Convert, keep running"). P2: a rule breach, not a vulnerability; nothing
  is exposed. Scored 13: six workflows and one action to convert (the board
  id-map's design shared with SHY-0584), Pages-from-artifact for two
  publishers, one workflow test per file with plants, and a dev walk.
