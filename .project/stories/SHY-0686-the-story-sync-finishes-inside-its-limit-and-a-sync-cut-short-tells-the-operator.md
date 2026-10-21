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
      _Proof so far: run 39672510270 (the #2519 merge push) synced its range plus the 15 stories with no issue, SHY-0675 to SHY-0689, in 136 s. The one-story timing comes from the next small push._
- [x] A full `--all` pass runs on a schedule and on dispatch, inside its own
      measured limit (30 minutes: twice the ~15 minutes measured). Its
      per-story cost (each lookup re-reads the whole items map) is SHY-0689.
      _Proof: the dispatched full pass, run 39673123365, took 12 min 53 s, inside its 30-minute limit. The schedule `17 3 * * *` is pinned by `sync-stories-alert.test.js`._
- [x] After this merges, every story on develop has an issue and a board
      item with Estimate and Priority, read back (SHY-0675 to SHY-0686
      included).
      _Proof: issues #2520 to #2534 (SHY-0675 to SHY-0689) were read back on the board, each with the Estimate and Pri of its story file. The full pass then refreshed the four stale ones (SHY-0671 to SHY-0674)._

### Error paths

- [x] A sync that times out or is cancelled opens the operator's alert, as a
      failed one does (`failure() || cancelled()`). Planted: a sync cut short,
      the alert opened.
      _Proof: planted live. Dry run 39675531476 was dispatched, then cancelled. The alert job ran and opened #2535, assigned to ShydenMcM and naming the run (closed as planted). The mutant `alert only on failure` was killed._
- [x] `GH_PAT_PROJECT` unset fails the step, naming the secret; it never
      exits 0.
      _Proof: `an unset project token fails the step instead of passing it` (sync-stories-alert.test.js). The mutant `unset token passes` was killed._

### Edge cases

- [x] A push that renames or deletes a story file syncs that story (closed or
      re-titled), never skips it.
      _Proof: a rename syncs once under its new path. A deletion fails the run with exit 41, naming the file. Stories are cancelled, never deleted, so a delete is refused rather than closed. Both are tested; the mutants `deleted story ignored` and `rename read as delete` were killed._
- [x] Two pushes close together: the second waits on the first (the global
      `sync-stories` group), and each syncs its own changed stories.
      _Proof: the global group and `cancel-in-progress: false` are pinned by sync-stories-to-issues-develop-source.test.js. Each push diffs its own before..after (the --changed tests)._

### Performance

- [x] The push sync's limit is its measured time, and the full pass's limit
      is its measured time, each at its own step.
      _Proof: a push keeps 15 minutes (measured: 136 s for 15 creates). The full pass gets 30, from its measured ~15 minutes (12 min 53 s dispatched). Both come from one expression, pinned by tests._

### Security

- [x] No way round the sync: a story with no issue is found by every push
      sync, not only by the full pass. Planted: a story file with no issue,
      synced on the next push.
      _Proof: tested (`a push touching no story still creates a missing one`; the mutant `sweep removed` was killed). Live: the #2519 merge push created SHY-0675 to SHY-0685, which it never changed._

### UX

- [x] Not applicable: operator tooling.

### i18n

- [x] Not applicable: no copy.

### Observability

- [x] Each run prints how many stories it read, created, updated and skipped,
      and its time; the full pass prints its distance from its limit.
      _Proof: `--changed` prints how many stories it reads, and every run prints its created, updated and skipped counts. `Sync took N s of its M-minute limit (P%)` is tested in board-fields, and the workflow passes the job's own limit (pinned equal to timeout-minutes)._

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
