---
id: SHY-0689
status: Draft
owner: claude
created: 2026-10-22
priority: P1
effort: M
estimate: 3
type: chore
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0689: the story sync looks up each story without re-reading the whole board

## User Story

As the operator, I want the story sync's full pass to cost about the same per
story whatever the size of the board, so that the daily pass stays far inside
its limit as stories are added.

## Why

Measured 2026-10-22 while building SHY-0686. `map_lookup` in
`scripts/sync-stories-to-issues.sh` pipes `ITEMS_MAP_JSON`, the whole board
with every issue body, through `jq` twice for every story. So a full pass
costs roughly the number of stories times the size of the board:

- A dry run, which loads no items map, did all 609 stories in 92 s.
- A real full pass took about 15 minutes. Run 39635193459 reached ~588 of
  609 stories in 13.5 minutes of its sync step.

SHY-0686 moved pushes off the full pass. The daily pass still pays this cost,
and it grows with every story.

## Acceptance Criteria

### Happy path

- [ ] The items map is read into a per-story form once per run, so each
      lookup costs the same whatever the board's size.
- [ ] A full pass over the live corpus takes under 5 minutes, measured by a
      dispatched run and recorded here; the full-pass limit in the workflow is
      set again from that measurement.

### Error paths

- [ ] A malformed items map still fails before any mutation, as today.

### Edge cases

- [ ] Multi-line issue bodies survive the per-story form unchanged (the
      body-hash comparison reads them).
- [ ] The script keeps running on the bash the tests use (macOS /bin/bash 3.2
      has no associative arrays).

### Performance

- [ ] A test with a synthetic board of 1,000 items shows lookup time flat in
      the board's size (two board sizes, the per-lookup time within the same
      measured spread).

### Security

- [ ] No change to what the sync writes: the existing sync suites stay green
      with the same recorded calls.

### UX

- [x] Not applicable: operator tooling.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] The run's summary prints the full pass's time.

## Announce

None: operator tooling.

## BDD Scenarios

**Scenario: a big board costs no more per story**

- **Given** a board of 1,000 items
- **When** the full pass runs
- **Then** each lookup takes about as long as on a board of 100

## Test Plan

- The scaling test above; the existing sync suites unchanged; a dispatched
  full pass measured.
- The no-holes rule applies: before/after lists, coverage of the changed
  code, mutations of every new control.

## Out of Scope

- What the sync writes (unchanged).

## Dependencies

- None.

## Risks & Mitigations

- **A per-story form that loses part of a body changes the hash and rewrites
  every issue.** Covered by the multi-line Edge cases AC and the unchanged
  suites.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-22**: filed from SHY-0686's measurement. P1: SHY-0686 removed the
  failure on pushes; this keeps the daily pass small. Scored 3: one function
  reshaped, a scaling test, a measured run.
