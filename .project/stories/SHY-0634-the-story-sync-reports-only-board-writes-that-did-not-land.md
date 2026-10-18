---
id: SHY-0634
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0634: The story sync reports only the board writes that did not land

## User Story

As the operator, I want the story sync to fail only when a board field it
wrote does not hold the value it meant to write, so that a red sync and its
alert always mean the board is wrong, never that GitHub answered badly to a
write that worked.

## Why

Measured on 2026-10-18: twice in one day the sync failed and opened an
alert for Estimate writes that had landed.

- Run 39100412818 (`c19df941c00`): one HTTP 502 on SHY-0340's Estimate
  write; the board read 5 afterwards (alert #2405).
- Run 39105955303 (`c9e7227`): GitHub answered "Something went wrong while
  executing your query" to SHY-0318's and SHY-0340's Estimate writes
  (`scripts/sync-stories-to-issues.sh:817`, counted at `:1460`), so the run
  exited 40 and opened alert #2413. Both read 5 on the board afterwards,
  matching their story files.

GitHub's answer to those writes was ambiguous, not a refusal: the write
may or may not have happened. Treating it as a failure gives false alarms;
re-sending it would be a retry. Reading the field back answers the question.

## Acceptance Criteria

### Happy path

- [ ] After a field write that GitHub answers with an error, the sync reads
      that item's field back once; if it holds the value meant, the write
      counts as done and the run logs "landed despite error" with the item.
- [ ] The read-back covers every field the sync writes (Estimate, Priority,
      Status, Effort, Type, SHY ID), from one helper.

### Error paths

- [ ] A read-back that shows any other value, or that itself fails, counts
      as a failed operation, as today.
- [ ] The write is never re-sent (no retry).

### Edge cases

- [ ] A write GitHub accepts without error is not read back (no extra calls
      on a clean run).

### Performance

- [ ] At most one extra query per failed write.

### Security

- [ ] Not applicable: the same App token and board as today.

### UX

- [ ] Not applicable: a CI job.

### i18n

- [ ] Not applicable: no user-facing text.

### Observability

- [ ] The run's summary line counts "landed despite error" separately from
      created, updated, skipped and failed.

## BDD Scenarios

**Scenario: GitHub errs but the write landed**

- **Given** an Estimate write that GitHub answers with "Something went wrong"
- **When** the sync reads the field back and finds the meant value
- **Then** the run counts it as landed despite error and stays green

**Scenario: GitHub errs and the write did not land**

- **Given** the same error
- **When** the read-back finds another value
- **Then** the run fails, naming the item and both values

## Test Plan

- Tests in the sync script's existing suite with the GitHub calls stood in
  (error then meant value; error then other value; error then read-back
  error; no error).

## Out of Scope

- Alerts reaching the board (SHY-0612).
- The swallowed `createProjectV2Field Type` error (SHY-0539).

## Dependencies

- None blocking. Retired with the script by SHY-0603 if that lands first.

## Risks & Mitigations

- A read straight after a write could see a stale value (not measured): a
  stale read shows the old value, so it counts as failed. The error is on
  the safe side (a false alarm as today, never a false pass).

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; one sync run green on develop.

## Notes

- **2026-10-18**: Filed after the second false alarm of the day (the same
  class twice gets a mechanism, not a note). P0 by the standing rule that
  any defect is P0. Scored 3: one helper, its call sites and their tests;
  larger than SHY-0630 (2).
