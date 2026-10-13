---
id: SHY-0583
status: In Review
owner: claude
created: 2026-10-13
priority: P0
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0583: An In Progress story with no branch or pull request goes back to the backlog, and the gate lets it

## User Story

As the operator, I want a story that says In Progress to always have a branch or an open pull request naming it, and an abandoned one to go straight back to the backlog, so that the board never claims work is under way when nobody is doing it.

## Why

Shyden, 2026-10-13 (PR #2323): *"this is an error. if there's no branch, no pr or if the branch and pr was closed before merging and nothing was ever completed (tickets much also be linked to a branch when picked up) then the ticket should be returned to the backlog. if we have orphaned tickets (in progress but no pr or branch) these must be fixed right away"*.

Measured the same day: of 506 story files on develop, one was In Progress, SHY-0113. Its file was last changed on 2026-08-28; no remote branch and no open pull request names it or any story it lists, and none of its Acceptance Criteria is ticked. PR #2323 tried to add its score and the PR Gate refused, correctly, because an In Progress story's frontmatter may not change. Moving it back to Draft was refused too: the gate allowed only Draft → Draft, In Review, Done or Cancelled, so no pull request could return an abandoned story to the backlog. That half is a defect in the gate.

## Acceptance Criteria

### Happy path

- [x] `scripts/check-pr-story-status.js` passes a story that was In Progress at the base and is Draft at the head ("returned to the backlog"), whatever else changed in it, when the pull request changes nothing outside `.project/`.
- [x] A new `scripts/check-orphaned-stories.js` fails, naming each one, while any story file is In Progress and no open pull request (title or head branch) and no remote branch names its id. The decision is a pure function, unit-tested in-process with no git, network or child process.
- [ ] It runs in the required Pre-Merge Gate job on every pull request, against the PR's own tree, with the workflow token.
- [ ] SHY-0113 goes back to Draft with its score (13) and a running-log note saying why.

### Error paths

- [x] The orphan check fails closed (exit 2, named) when it cannot list pull requests or branches, when the PR list may be cut short, or when a story file has no `status:`.

### Edge cases

- [x] The scope is read from the unfiltered diff, so a deleted code file counts as a change outside `.project/`.
- [x] An id inside a longer number (SHY-01130) does not claim SHY-0113; `shy0113` and `SHY-0113` both do.

### Performance

- [x] One `gh pr list` and one `git ls-remote` per run, only when a story is In Progress.

### Security

- [x] An implementation PR cannot dodge In Review by sending its story back: the same move is refused when the PR changes anything outside `.project/`, and In Review → Draft is still refused. The workflow step uses only trusted inputs (`github.token`, `github.repository`); PR titles are matched by a regex, never passed to a shell.

### UX

- [x] The orphan error names the story, its file, and both fixes (return it to Draft in a `.project/`-only PR, or push its branch).

### i18n

- [x] Not applicable: CI output only.

### Observability

- [x] The check prints how many story files it read, how many are In Progress, and how many PRs and branches it searched, so a pass is never silent about what it saw.

## BDD Scenarios

**Scenario: An abandoned story goes back to the backlog**

- **Given** SHY-0113 is In Progress on develop with no branch and no open pull request
- **When** a pull request changing only `.project/` sets it to Draft and adds its estimate
- **Then** the PR Gate passes it as returned to the backlog

**Scenario: An implementation PR cannot hide behind the backlog**

- **Given** a story is In Progress on develop
- **When** a pull request that also changes code sets it to Draft
- **Then** the PR Gate refuses it

**Scenario: An orphan blocks every pull request until it is fixed**

- **Given** a story is In Progress and no open pull request or branch names it
- **When** any pull request runs the Pre-Merge Gate
- **Then** the orphan check fails, naming the story and both fixes

## Test Plan

- Gate: new cases beside the SHY-0486 and SHY-0518 ones in `express-api/tests/scripts/pre-merge-gate.test.js` (that file drives the real script against throwaway repos; SHY-0574 moves it out of unit).
- Orphan check: `express-api/tests/scripts/check-orphaned-stories.test.js`, in-process, one test per case.
- Each new test seen RED before the code.

## Out of Scope

- Recording a `branch:` field in frontmatter. The branch name already carries the id, which is what the orphan check reads.
- Other projects: whether this becomes a global rule is Shyden's call.

## Risks & Mitigations

- An implementation PR sends its story back to Draft to dodge In Review: refused, because the exemption needs a PR that changes nothing outside `.project/`, read from the unfiltered diff.
- An orphan blocks every PR: intended (Shyden: "must be fixed right away"); the error names the story and both fixes.
- The check cannot see (gh or git fails, or the PR list may be cut short): it fails closed rather than passing.

## Dependencies

None.

## Definition of Done

All criteria ticked; the backlog-return line seen in a real PR's Pre-Merge Gate (PR #2323, SHY-0113) and the orphan step green in the required gate; merged to develop.

## Notes

- **2026-10-13**: Filed and implemented in one PR at P0 on Shyden's instruction ("must be fixed right away"). Unblocks PR #2323 (SHY-0537), which scores SHY-0113.
- **Order (three PRs, forced by the rule itself):** this PR changes code, so by its own scope rule it cannot return SHY-0113; and wiring the orphan check now would fail on SHY-0113 until it is returned. So: (1) this PR, the gate exemption and the orphan-check script, not yet wired; (2) PR #2323 (SHY-0537, `.project/` only) returns SHY-0113 to Draft with its score, the first real use of the exemption; (3) a follow-up PR wires the orphan check into the Pre-Merge Gate, green because no orphan is left.
