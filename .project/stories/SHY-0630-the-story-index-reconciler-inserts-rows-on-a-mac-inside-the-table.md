---
id: SHY-0630
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: S
estimate: 2
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0630: The story index reconciler inserts its rows on a Mac, inside the Active table

## User Story

As the operator filing stories, I want `scripts/reconcile-story-index.sh
--apply` to insert every missing row on the Mac it runs on, as part of the
Active table, so that the index stays derived from the story files.

## Why

Measured on 2026-10-18 at `c19df941c00`, filing SHY-0626 to SHY-0629:

- **It fails on a Mac with two or more missing rows.** Line 100 passes the
  rows as `awk -v rows="$rows"`. BSD awk (macOS) refuses a newline inside a
  `-v` value: `awk: newline in string`, exit 2, nothing inserted. One row
  works only because its single trailing newline is the only one.
- **Its rows land outside the table.** It prints the rows directly before
  `## Done`, but a blank line already sits between the last Active row and
  that header, so inserted rows start a new paragraph and render as text,
  not as table rows.

It fails loudly (exit 2), so nothing was lost; the four rows were added by
hand in the same format and checked with the report mode.

## Acceptance Criteria

### Happy path

- [ ] `--apply` inserts several missing rows in one run under macOS awk and
      under GNU awk.
- [ ] Inserted rows follow the last Active row with no blank line between.

### Error paths

- [ ] An index with no `## Done` header fails with a clear message and
      changes nothing.

### Edge cases

- [ ] A title holding `&` or `\` is inserted unchanged.

### Performance

- [ ] Not applicable: one file, run by hand.

### Security

- [ ] Not applicable: reads and writes one tracked file.

### UX

- [ ] Its report mode output is unchanged.

### i18n

- [ ] Not applicable: no user-facing text.

### Observability

- [ ] The run prints each row it inserted.

## BDD Scenarios

**Scenario: several stories filed at once**

- **Given** three story files missing from the index
- **When** the operator runs `--apply` on a Mac
- **Then** all three rows are inserted at the end of the Active table

## Test Plan

- Unit test in-process with a fixture index, one test per case, with the
  awk call stood in where the unit rules forbid a child process; the real
  run under both awks in a non-unit suite.

## Out of Scope

- Retiring story files (SHY-0603), which retires this script too; if
  SHY-0603 lands first, this story is cancelled.

## Dependencies

- None blocking.

## Risks & Mitigations

- None beyond the test above.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-18**: Found filing SHY-0626 to SHY-0629. P0 by the standing rule
  that any defect is P0. Scored 2: two lines of shell and their tests;
  smaller than SHY-0624 (3).
