---
id: SHY-0691
status: Done
owner: claude
created: 2026-10-22
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0691: every merge's story edits reach the board: sync runs queue, never drop

## User Story

As the operator, I want every develop merge's story edits on the board within
minutes, however close together the merges land, so that the board never
shows an out-of-date status, estimate or ticked criterion.

## Why

Shyden, 2026-10-22, on a side agent's finding: _"it should not drop a run
just because another has started, it should queue instead."_

SHY-0686 made each push sync only the stories that push changed. The
workflow's concurrency group (`sync-stories`, `cancel-in-progress: false`)
uses GitHub's default `queue: single`: at most one run waits, and a newer
run cancels and replaces it (GitHub Docs, "Control the concurrency of
workflows and jobs"). With three merges close together, the middle merge's
run is cancelled before it starts. The third run syncs only its own range,
so the middle merge's edits wait for the daily full pass, up to a day.
A run cancelled while pending starts none of its jobs, so the sync's
cancel alert (`failure() || cancelled()`) never fires: the loss is silent.

GitHub added `queue: max` (changelog 2026-05-07): up to 100 pending runs
per group, processed one at a time, FIFO by when each began waiting. The
docs also say "ordering is not guaranteed". A run arriving at a full queue
is cancelled. actionlint, which CI pins at 1.7.7, rejects the `queue` key:
no release contains rhysd/actionlint#654 (open, measured 2026-10-22; latest
release v1.7.12, 2026-03-30).

## Acceptance Criteria

### Happy path

- [x] The sync workflow's concurrency group sets `queue: max`, with
      `cancel-in-progress` unset or false. A workflow test pins both.
      Proof: #2538 (a60cec2d1e5); `sync-stories-queue.test.js` (parsed
      YAML), mutants W1 and W2 killed.
- [x] A push sync syncs from the last commit a sync completed on develop
      (the head SHA of the newest successful push or scheduled run of this
      workflow on develop, read through the API with the job's own token)
      to its own head. A run lost for any reason is then covered by the
      next one. Proof: run 39709662060 printed "last completed sync is
      f4e95481a92 (run 39681855262, push)" and synced f4e95481a92..a60cec2d1e5.
- [x] Proven live (amended 2026-10-22, Shyden "Two proofs instead":
      develop's ruleset is strict, so three merges cannot land inside one
      sync's run time). (1) Queue: three dry-run dispatches back to back,
      39714983936, 39714987708, 39715036637: two pending at once, all
      success, run one after another (03:06:01-03:08:56, 03:08:58-03:11:34,
      03:11:36-03:14:31), none cancelled. (2) Lost run: #2542 merged
      (4c1063a744d) while dispatch 39716272552 held the group; its push sync
      39716296139 was cancelled while pending and started no job; SHY-0695
      was then absent from the board. #2543 merged (ba3943d952d): its sync
      39717168088 printed "last completed sync is a60cec2d1e5 (run
      39709662060, push)" and synced a60cec2d1e5..ba3943d952d; SHY-0695
      became #2544 and #2543's edits were read back on #2539 and #2540.

### Error paths

- [x] No completed sync found, or a last-synced SHA that is not an
      ancestor of this run's head, falls back to a full pass and says so.
      Proof: `sync-start-commit.test.js` (none found, diverged), mutants
      M6 and M16 killed; the step's `full` case in
      `sync-stories-queue.test.js`.
- [x] The API lookup failing fails the run, naming the call (fails closed;
      never a silent fall back to BEFORE). Proof: runs and compare failures,
      unreadable answers, unknown status (mutants M7, M8, M14, M15, W5, W7
      killed); the step no longer reads `before` (pinned in
      `sync-stories-alert.test.js`).

### Edge cases

- [x] A run whose head is already covered (the last-synced SHA is its head
      or a descendant of it: a newer run finished first) syncs nothing,
      says so, and succeeds. It never writes older story text over newer.
      Proof: identical and behind give `covered` (mutant M5 killed); the
      step exits 0 without syncing (mutant W4 killed); the checkout stays
      `ref: develop`.
- [x] A dry-run dispatch never counts as a completed sync. Proof: test
      "a dispatch run never counts" (mutant M1 killed); live, #2543's sync
      skipped dispatches 39714983936-39716272552 and started from the push
      run 39709662060.

### Performance

- [x] The lookup adds two API calls per run (amended: the runs listing,
      then compare, which tells ahead, behind and diverged apart); a run
      that syncs prints its time report; a covered run syncs nothing and
      prints why instead.

### Security

- [x] actionlint's refusal of `queue` is silenced only for that message in
      that one file, in `.github/actionlint.yaml`, with the upstream PR
      named. A test fails if the ignore matches any other file or message.
      A ticket drops it once an actionlint release accepts the key.
      Proof: actionlint 1.7.7 (CI's pin, checksum verified) clean with the
      ignore, red on `queue: max` without it, and CI's Lint job green on
      #2538; mutants C1-C3 and the widened path killed; SHY-0694 (#2541).
- [x] The lookup uses the job's own GITHUB_TOKEN with `actions: read`
      (amended: narrower than the App's token), never a personal one.
      Proof: pinned in `sync-stories-queue.test.js` (mutant W3 killed);
      live runs 39709662060 and 39717168088 read the runs list with it.

### UX

- [x] Not applicable: operator tooling.

### i18n

- [x] Not applicable: no copy.

### Observability

- [x] Each run prints the range it synced and where its start came from:
      the last completed sync, a full-pass fallback (with the reason), or
      already covered. Proof: the live lines quoted above; tests of all
      three step cases (mutant W8 killed).

## Announce

None: operator tooling.

## BDD Scenarios

**Scenario: three quick merges**

- **Given** a sync is running
- **When** two more develop merges land, each editing a story
- **Then** both wait in the queue, and every edit reaches the board

**Scenario: a lost run is covered**

- **Given** a merge's sync run was cancelled before it started
- **When** the next merge's sync runs
- **Then** it syncs from the last completed sync, so the lost run's edits
  reach the board

## Test Plan

- RED first: unit tests of the start-commit choice with the API stubbed
  (found and an ancestor; none found; not an ancestor; already covered; the
  call failing; a dry run ignored).
- Workflow tests pin `queue: max` and the narrow actionlint ignore. The
  lint job runs green with it, and red with the ignore widened.
- Mutation on each new branch of the choice.
- The live three-merge proof after merging.

## Out of Scope

- SHY-0689's lookup cost.

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** the ignore hides a real future error in that file.
  **Mitigation:** it matches one message about the `queue` key only, a test
  pins its scope, and its removal is ticketed.

## Definition of Done

- [x] Every AC ticked with its proof; CI green by step name (PR Checks
      39706932267 on 796a9f99a61); merged to `develop` (#2538,
      a60cec2d1e5); the live proof recorded above.

## Notes

- **2026-10-22**: filed from a side agent's finding and Shyden's ruling
  above. P0: edits are lost silently. Scored 5: a workflow change, a
  start-commit choice with six tested cases, a scoped lint ignore with its
  test, and a live proof. Sources: GitHub Docs (concurrency), GitHub
  changelog 2026-05-07, rhysd/actionlint#654 and its releases page.
- **2026-10-22 (Done)**: merged in #2538 and proven live (two proofs, see
  the ACs). Three ACs amended with the reason beside each: the token, the
  call count, and the live-proof method. Filed on the way: SHY-0692 to
  SHY-0696. This file moved to develop ahead of #2454 (held for its phone
  run), which also adds it: take develop's copy when #2454 merges develop.
