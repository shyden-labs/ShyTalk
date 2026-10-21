---
id: SHY-0691
status: Draft
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

- [ ] The sync workflow's concurrency group sets `queue: max`, with
      `cancel-in-progress` unset or false. A workflow test pins both.
- [ ] A push sync syncs from the last commit a sync completed on develop
      (the head SHA of the newest successful push or scheduled run of this
      workflow on develop, read through the API as the App) to its own
      head. A run lost for any reason is then covered by the next one.
- [ ] Proven live: three develop merges land inside one sync's run time,
      each editing a different story. Each edit is read back on the board,
      and the runs' records show all three ran, none cancelled.

### Error paths

- [ ] No completed sync found, or a last-synced SHA that is not an
      ancestor of this run's head, falls back to a full pass and says so.
- [ ] The API lookup failing fails the run, naming the call (fails closed;
      never a silent fall back to BEFORE).

### Edge cases

- [ ] A run whose head is already covered (the last-synced SHA is its head
      or a descendant of it: a newer run finished first) syncs nothing,
      says so, and succeeds. It never writes older story text over newer.
- [ ] A dry-run dispatch never counts as a completed sync.

### Performance

- [ ] The lookup adds one API call per run; the run's time report still
      prints.

### Security

- [ ] actionlint's refusal of `queue` is silenced only for that message in
      that one file, in `.github/actionlint.yaml`, with the upstream PR
      named. A test fails if the ignore matches any other file or message.
      A ticket drops it once an actionlint release accepts the key.
- [ ] The lookup uses the App's token, never a personal one.

### UX

- [x] Not applicable: operator tooling.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] Each run prints the range it synced and where its start came from:
      the last completed sync, a full-pass fallback (with the reason), or
      already covered.

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

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the live proof recorded.

## Notes

- **2026-10-22**: filed from a side agent's finding and Shyden's ruling
  above. P0: edits are lost silently. Scored 5: a workflow change, a
  start-commit choice with six tested cases, a scoped lint ignore with its
  test, and a live proof. Sources: GitHub Docs (concurrency), GitHub
  changelog 2026-05-07, rhysd/actionlint#654 and its releases page.
