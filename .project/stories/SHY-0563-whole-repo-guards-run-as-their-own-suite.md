---
id: SHY-0563
status: Draft
owner: claude
created: 2026-10-12
priority: P0
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0563: Whole-repo guards run as their own required suite, not as unit tests

## User Story

As the operator holding unit tests to one second and 0.1 s of CPU each, I
want the tests that read the whole repository to run in a separate
`guards` suite with its own measured limit, so that the unit rules bind
only unit tests and no guard is relabelled to dodge them.

## Why

Global rule (Shyden, 2026-10-08, every project): "Whole-repo guards are
their own suite, not unit": a test that reads or parses the whole tree to
check a rule goes in a required `guards` suite with one measured limit at
its CI step, still run by the full test command; the unit rules bind
everything else. Measured on develop at `f47af768ce8`: Express Jest runs
every `tests/**/*.test.js` as one suite (543 files); 34 of them walk
directories or list git files, and 26 of those start from the repository
root. SHY-0546 and SHY-0548 (the unit-suite stories) do not plan this
split.

## Acceptance Criteria

### Happy path

- [ ] A `guards` suite exists with its own Jest config and CI job, and the
      unit config no longer matches its files.
- [ ] Every test that reads the whole tree is in it; the choice per file is
      listed in Notes, decided per test from what it reads, not by folder.
- [ ] The suite's CI step carries one limit, set from measured runs and
      recorded in Notes; no limit sits inside the suite.
- [ ] `guards` is a required status check on `develop` (merge, then
      require, then re-read the protection).

### Error paths

- [ ] A test file matched by both configs, or by neither, fails a check
      naming it.

### Edge cases

- [ ] A guard that can cut its work to fit unit stays in unit; a file moves
      only when the cost is the tree itself (each kept or moved file says
      which in Notes).
- [ ] The full test command still runs both suites.

### Performance

- [ ] Unit wall time and guards wall time are recorded before and after.

### Security

- [ ] Not applicable.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] Each suite's file count is checked against a recorded floor
      (SHY-0556), so a file silently dropped from both is seen.

## BDD Scenarios

**Scenario: A new tree-reading guard is added**

- **Given** a new test that walks every workflow file
- **When** it is added under the unit config's match
- **Then** the split check fails naming it until it moves to `guards`

## Test Plan

- A unit test of the split check against fixture file lists; a planted
  file in both configs and in neither, each shown red.

## Out of Scope

- Cutting unit tests to one second (SHY-0548) and removing service calls
  from unit (SHY-0546).

## Dependencies

- SHY-0556 for the file-count floors.

## Risks & Mitigations

- **A guard moved to dodge the unit limit.** Each move names what the test
  reads; one that does not read the tree is cut, not moved.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Filed while starting SHY-0556 (its guard
  `no-minio-image.test.js`, from SHY-0544, walks 460 files from the root).
  Scored 5: one config split, about 26 to 34 files classified, one CI job
  and one required check. The 26 and 34 are file-level greps
  (`readdirSync`, `git ls-files`, `globSync`, `opendirSync`; repo-root
  spellings); the per-test count is taken at the start.
