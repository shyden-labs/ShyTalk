---
id: SHY-0686
status: Draft
owner: claude
created: 2026-10-21
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
---

# SHY-0686: the story sync finishes inside its limit, and a sync cut short tells the operator

## User Story

As the operator, I want every story merged to develop to reach its issue and
the board, and a sync that cannot finish to tell me, so that the board picks
the next ticket from every story and never silently misses new ones.

## Why

Measured 2026-10-21. Two develop pushes in a row ran the sync
(`sync-stories-to-issues.yml`, runs 39587696742 and 39635193459), and both
ended "cancelled". The job hit `timeout-minutes: 15`: run 39635193459 ran
from 16:31:29 to 16:46:46.

On every push the sync runs `--all`, which reads all 609 stories in order.
It reached the first changed story (SHY-0566) after about 10.6 minutes of
reads, and was at SHY-0656 when the limit hit. So the newest stories
(SHY-0675 to SHY-0684, merged in #2514) never got an issue or a board
item. The run still committed its id-map, and nothing told the operator:
the alert job is `if: failure()`, and GitHub reports a timeout as
cancelled. Every new story makes the full pass longer, so every push
sync now fails the same way.

The step also exits 0 with only a warning when `GH_PAT_PROJECT` is unset, so
a sync that never ran shows green.

## Acceptance Criteria

### Happy path

- [ ] A develop push syncs only the stories whose files changed in that push
      (the diff between the push's before and after SHAs), plus any story on
      develop with no issue yet. Measured: a one-story push finishes in under
      a minute.
- [ ] A full `--all` pass runs on a schedule and on dispatch, inside its own
      measured limit (30 minutes: twice the ~15 minutes measured). Its
      per-story cost (each lookup re-reads the whole items map) is SHY-0689.
- [ ] After this merges, every story on develop has an issue and a board
      item with Estimate and Priority, read back (SHY-0675 to SHY-0686
      included).

### Error paths

- [ ] A sync that times out or is cancelled opens the operator's alert, as a
      failed one does (`failure() || cancelled()`). Planted: a sync cut short,
      the alert opened.
- [ ] `GH_PAT_PROJECT` unset fails the step, naming the secret; it never
      exits 0.

### Edge cases

- [ ] A push that renames or deletes a story file syncs that story (closed or
      re-titled), never skips it.
- [ ] Two pushes close together: the second waits on the first (the global
      `sync-stories` group), and each syncs its own changed stories.

### Performance

- [ ] The push sync's limit is its measured time, and the full pass's limit
      is its measured time, each at its own step.

### Security

- [ ] No way round the sync: a story with no issue is found by every push
      sync, not only by the full pass. Planted: a story file with no issue,
      synced on the next push.

### UX

- [x] Not applicable: operator tooling.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] Each run prints how many stories it read, created, updated and skipped,
      and its time; the full pass prints its distance from its limit.

## Announce

None: operator tooling.

## BDD Scenarios

**Scenario: a new story reaches the board**

- **Given** a push to develop adds one story file
- **When** the sync runs
- **Then** that story gets its issue and board item, and the run finishes in
  under a minute

**Scenario: a sync cut short tells the operator**

- **Given** a sync that runs past its limit
- **When** GitHub cancels it
- **Then** the operator's alert issue opens, naming the run

## Test Plan

- Unit tests of the changed-story selection (add, edit, rename, delete, none)
  and of the missing-issue sweep; the alert condition pinned by a test; a
  planted timeout and a planted unset secret, each seen in CI.
- The no-holes rule applies: before/after lists, coverage of the changed
  code, mutations of every new branch.

## Out of Scope

- The board's other fields and their writers (SHY-0573, SHY-0596).

## Dependencies

- None.

## Risks & Mitigations

- **A story changed on develop by a path the diff misses** (a merge commit,
  a force-pushed base): the missing-issue sweep on every push and the
  scheduled full pass catch it.

## Definition of Done

- [ ] Every AC ticked with its proof; the planted timeout seen alerting; every
      story on develop on the board; merged to `develop`.

## Notes

- **2026-10-21**: found when the stories merged in #2514 never reached the
  board. P0: a silent stop ("nothing we rely on stops silently") that hides
  P0 stories from the queue. A local `--story` run as the ShyTalk App was
  tried and stopped by the gh router before any write: the script names the
  board by owner and number, not its node id. Scored 5: the selection and
  sweep with their tests, the bulk read, two workflow conditions and two
  planted failures.
- **2026-10-22**: corrected while building it. The cost is not reading or
  parsing story files (a dry run, which loads no items map, did all 609 in
  92 s); it is map_lookup piping the whole items map, every issue body,
  through jq twice per story. A push now looks up only what it changed;
  the full pass keeps the per-story cost, filed as SHY-0689.
