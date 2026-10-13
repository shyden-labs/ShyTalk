---
id: SHY-0584
status: Draft
owner: claude
created: 2026-10-13
priority: P1
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0584: The board id-map rides inside the pull request, so develop never moves under an open PR

## User Story

As the operator, I want the board's id-map update to land inside the pull request that needs it, so that develop gains no extra commit after a merge and open pull requests do not fall behind and need fresh CI every time.

## Why

Since 2026-10-13 a pull request merges only when its head contains develop's latest commit (the merge guard, and the strict rulesets Shyden applies). `sync-stories-to-issues.yml` runs on every push to develop and, when a story is new or its issue mapping changed, commits `chore(board): sync board-items.json id-map` straight to develop. Measured the same day: it put PR #2323 one commit behind, the guard refused the merge, and #2323 needed develop merged in and a full CI run again. With several PRs open, every such commit repeats that for each one. Shyden, 2026-10-13: *"ride inside the pr"*.

## Acceptance Criteria

### Happy path

- [ ] When a pull request into develop adds or changes a story, the sync creates or updates its issue and board card and commits the resulting `.project/board-items.json` onto the pull request's own branch (signed, as today), before the PR's checks are judged.
- [ ] After that PR merges, the push-to-develop run finds `board-items.json` already in step and makes no commit to develop.

### Error paths

- [ ] A sync that fails on a pull request fails that pull request's check by name, rather than leaving develop to fix it after the merge.

### Edge cases

- [ ] A pull request closed without merging leaves its created issue in the backlog state (not closed, not In Progress), and a later PR for the same story reuses it.
- [ ] Two open PRs that both add stories do not both claim the same id-map entries: the second to merge reconciles by merging develop, not by hand.

### Performance

- [ ] One sync per PR push that touches `.project/stories/`; none for other PRs.

### Security

- [ ] The commit onto a PR branch is made only for branches in this repository (never a fork), with the same App identity and signed-commit path as today.

### UX

- [ ] The PR shows the id-map commit as its own commit with the same headline as today.

### i18n

- [ ] Not applicable: CI only.

### Observability

- [ ] The sync prints which stories it created or updated and whether it committed, on the PR and on develop.

## BDD Scenarios

**Scenario: A new story's mapping lands with its PR**

- **Given** a pull request adds SHY-9999
- **When** its checks run
- **Then** its branch gains the id-map commit, and develop gains nothing after the merge

**Scenario: An unrelated PR is untouched**

- **Given** a pull request changes no story
- **When** its checks run
- **Then** no sync runs and no commit is added

## Test Plan

- Workflow contract tests beside the existing sync tests: triggers, the PR-branch commit, the fork guard, the no-op on develop.
- A real PR that adds a story shows the id-map commit on its branch and none on develop after merge.

## Out of Scope

- Changing what the id-map holds.

## Risks & Mitigations

- Issues created for PRs that never merge: they stay in the backlog and are reused; the orphan check (SHY-0583) does not count them as In Progress.
- A commit onto the PR branch restarts its CI once: that is the point (CI then tests what lands), and it happens before review, not after merge.

## Dependencies

None.

## Definition of Done

All criteria ticked; a real story-adding PR merged with no follow-up commit on develop.

## Notes

- **2026-10-13**: Filed on Shyden's instruction (*"ride inside the pr"*) after a side agent measured two board-sync commits on develop that day, one of which put #2323 behind.
