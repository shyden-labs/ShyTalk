---
id: SHY-0646
status: Draft
owner: claude
created: 2026-10-19
priority: P2
effort: S
estimate: 3
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0646: Merged work keeps its story In Progress until the story closes

## User Story

As the person shipping ShyTalk, I want a story whose pull request has merged
to stay In Progress until it is closed by hand, so that the orphan check does
not turn every other pull request red while merged work waits for its dev
deploy to be checked.

## Why

Shyden ruled on 2026-10-16, for every project (yawelo-idle #580): in the
orphan check, a branch whose pull request MERGED keeps naming its ticket
until the ticket closes. Merged work waits for its dev deploy to be checked
before the ticket is closed by hand. A branch whose pull requests all closed
WITHOUT merging still names nothing. The global rule names ShyTalk's
`scripts/check-orphaned-stories.js` as one of the two checks to change.

Today (origin/develop 84194cf5b3c) the check lets a remote branch claim a
story only while that branch has no closed pull request, "merged or not"
(`scripts/check-orphaned-stories.js:52`). ShyTalk also deletes a branch when
its pull request merges (`delete_branch_on_merge: true`, read 2026-10-19), so
after a merge there is no branch left to count. A merged pull request's own
title or head branch has to be the claim.

## Acceptance Criteria

### Happy path

- [ ] An In Progress story is claimed by a merged pull request whose title or
      head branch names its id, for as long as the story stays In Progress.
- [ ] An open pull request, or a remote branch with no closed pull request,
      still claims the story as today.

### Error paths

- [ ] A story whose only pull requests closed WITHOUT merging is still an
      orphan, and the check names it.
- [ ] A closed pull request whose merge state cannot be read (no `mergedAt`
      field in the answer) stops the check with exit 2, naming the pull
      request, rather than guessing either way.
- [ ] A merged-PR list that may be cut short (it reaches its limit) stops
      the check with exit 2, as the open list does today.

### Edge cases

- [ ] A story named by one merged pull request and one closed-unmerged pull
      request is claimed (the merge counts).
- [ ] An id that only appears inside a longer number (SHY-06460) does not
      claim SHY-0646 (the existing `names()` match, kept).

### Performance

- [ ] The check still asks GitHub a fixed number of questions plus at most one
      per In Progress story, and finishes inside the Pre-Merge Gate's
      measured time on CI.

### Security

- [ ] The check still reads only; it writes nothing to GitHub or the tree.

### UX

- [ ] An orphan's message says which kinds of claim were looked for (open
      pull request, live branch, merged pull request).

### i18n

- [ ] Nothing: developer tooling, English only.

### Observability

- [ ] The check prints how many merged pull requests it read beside the
      counts it prints today, so a blind read shows as 0.

## Announce

Nothing: developer tooling.

## BDD Scenarios

**Scenario: merged work keeps its story claimed**

- **Given** SHY-0001 is In Progress and its only pull request merged, so its
  branch was deleted
- **When** the orphan check runs
- **Then** SHY-0001 is not an orphan

**Scenario: abandoned work is still an orphan**

- **Given** SHY-0002 is In Progress and its only pull request was closed
  without merging
- **When** the orphan check runs
- **Then** the check fails naming SHY-0002

**Scenario: an unreadable merge state stops the check**

- **Given** a closed pull request naming SHY-0003 comes back without `mergedAt`
- **When** the orphan check runs
- **Then** the check exits 2 naming that pull request

## Test Plan

- Unit, test-first, in `express-api/tests/scripts/check-orphaned-stories.test.js`:
  one test per scenario and per error path above, with GitHub's answers
  stood in (no process started, no network).
- Each new test seen red against today's `findOrphans` before the change.
- Mutation: drop the merged-PR claim and watch the merged-work test go red;
  treat a missing `mergedAt` as merged and watch the fail-closed test go red.
- CI: the Pre-Merge Gate runs the check on this pull request's own tree.

## Out of Scope

- Closing a story when its dev deploy is checked: still done by hand.
- repo-template's `scripts/board-orphans.ts`: the template's own session.

## Dependencies

- None.

## Risks & Mitigations

- A merged pull request claims an old story for ever: only while the story
  is In Progress, and closing it by hand ends the claim, as the ruling wants.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the global rule's ShyTalk part reported done so its pending
      note can be retired once repo-template lands its part.

## Notes

- **2026-10-19**: Filed in the weekly clean-up, which found the global rule
  `pending-merged-branch-counts-till-closed.md` (2026-10-16) naming this
  check with no ShyTalk story for it (searched open and closed issues).
  P2: nothing waits on it; until it lands, merged work goes back to Draft.
  Scored 3, the same size as SHY-0644: one function, one more GitHub read,
  six unit tests.
