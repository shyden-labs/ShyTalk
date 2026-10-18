---
id: SHY-0560
status: Cancelled
owner: claude
created: 2026-10-12
priority: P0
effort: S
estimate: 3
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0560: The story index shows each story's real status, read from the story file

## CANCELLED — superseded by SHY-0603

SHY-0603 retires the story files and this tooling with them; this story
fixes no live defect (only speed or index tidiness).

Closed in the 2026-10-18 backlog sweep, on Shyden's decision ("Close the cosmetic ones only").

## User Story

As the operator reading the backlog, I want every row of `SHY-INDEX.md` to
show the status its story file holds, so that the index never tells me a
finished story is still in review, or a story in review has not started.

## Why

Measured 2026-10-12 on `origin/develop` at `5e3644ab842`, over every row and
every story file: 481 story files, 481 index rows, none missing either way.
**38 rows show a status different from their file**:

- 36 are drift. 33 stories are Done but shown as Draft or In Review:
  SHY-0092, 0136, 0143, 0144, 0145, 0147, 0148, 0151, 0169, 0195, 0269,
  0270, 0295, 0296, 0297, 0298, 0299, 0300, 0328, 0330, 0334, 0338, 0342,
  0345, 0346, 0347, 0348, 0350, 0351, 0359, 0362, 0363, 0372. SHY-0103 is
  Cancelled but shown as Draft; SHY-0244 and SHY-0289 are In Review but
  shown as Draft.
- 2 (SHY-0019, SHY-0053) have a title holding an escaped pipe (`\|`), so a
  plain split on `|` reads their status cell as `\`. Any tool that reads the
  table has to honour the escape.
- 4 rows use `🔍 In Review`; the index's own legend says `👀 In Review`.

Nothing makes the column follow the file. `scripts/reconcile-story-index.sh`
adds missing rows but by design "never edits a row that already exists", and
SHY-0533 (Draft) will refuse a pull request that leaves a row missing or
dangling, not one whose status is stale. Each session that moves a story is
trusted to edit its row by hand, and 38 times one did not.

## Acceptance Criteria

### Happy path

- [ ] The reconciler's report mode names every row whose status cell differs
      from its file's `status:`, as `STATUS <id>: index "<cell>", file
      "<status>"`, and exits non-zero when there is any.
- [ ] With `--apply` it rewrites only the status cell of those rows, to the
      legend's marker for the file's status (`📝 Draft`, `🚧 In Progress`,
      `👀 In Review`, `✅ Done`, `❌ Cancelled`); row order and every other
      cell stay byte-identical.
- [ ] One `--apply` run on develop fixes all 38 rows above, and report mode
      then exits 0.
- [ ] SHY-0533's CI job, when built, runs this check too (one job, one
      script); until then this story's PR states which check holds it.

### Error paths

- [ ] A story whose `status:` has no legend marker fails the run naming the
      file and the value; it is never written as blank or guessed.
- [ ] A row whose cells cannot be read fails the run naming the row; it is
      never skipped.

### Edge cases

- [ ] Titles with an escaped pipe (`\|`, SHY-0019 and SHY-0053 today) are
      read as one cell, and `--apply` leaves the title untouched.
- [ ] `🔍 In Review` counts as a mismatch with the legend and is rewritten
      to `👀 In Review`.
- [ ] Rows in the Done and Cancelled tables are checked the same as Active
      ones.

### Performance

- [ ] Report mode over all 481 rows finishes in under 2 s, measured and
      recorded.

### Security

- [ ] Not applicable: reads and writes repository files only.

### UX

- [ ] Each mismatch line names the story id, the index cell and the file's
      status, so the fix is clear without opening either file.

### i18n

- [ ] Not applicable: the index is English, operator-facing.

### Observability

- [ ] Report mode ends with a count line: rows read, rows mismatched, and the
      file count, so a run that read nothing cannot read as clean.

## BDD Scenarios

**Scenario: A finished story still shown in review is caught**

- **Given** SHY-0345 is Done in its file and `👀 In Review` in the index
- **When** the reconciler runs in report mode
- **Then** it prints `STATUS SHY-0345` and exits non-zero

**Scenario: Apply fixes only the status cell**

- **Given** the 38 mismatched rows
- **When** the reconciler runs with `--apply`
- **Then** only those status cells change and report mode exits 0

**Scenario: An escaped pipe does not shift the columns**

- **Given** SHY-0019, whose title holds `\|`
- **When** the reconciler reads its row
- **Then** its status cell is read correctly

## Test Plan

- Unit tests of the row parser (escaped pipe, every legend marker, the stray
  `🔍`) and of the rewrite (only the status cell changes), each run RED
  first.
- A planted mismatch in a fixture index goes RED; the count line's file and
  row totals are asserted against the fixture.

## Out of Scope

- Reordering rows (operator-curated).
- Board or issue status (the story-to-issue sync, SHY-0545).

## Dependencies

- Folds into SHY-0533's CI job. SHY-0513 (the reconciler cannot insert rows)
  touches the same script: whichever lands second rebases onto the first.

## Risks & Mitigations

- **A rewrite damages a row.** Mitigation: the rewrite is cell-scoped and
  a test asserts every other byte of the file is unchanged.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the index on develop has 0 status mismatches.

## Notes

- **2026-10-12**: Found while moving SHY-0544 to In Review: its own row read
  `📝 Draft` though the story had been In Progress for days.
- Scored 3: one parser fix, a cell-scoped rewrite and a report line in an
  existing script, plus a one-off apply; above SHY-0513 (2, insert rows into
  the same script), below SHY-0559 (5, a CI gate change).
