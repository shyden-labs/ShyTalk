---
id: SHY-0684
status: Draft
owner: claude
created: 2026-10-21
priority: P0
effort: S
estimate: 3
type: chore
roadmap_ids: []
mvp: true
epic: EPIC-0016
blocked_by: [SHY-0674]
---

# SHY-0684: the Python estimate tools are measured

## User Story

As the operator, I want every line of Python (.project/estimates) measured by a coverage tool
in CI, so that SHY-0674's gate can judge it and ShyTalk's coverage only rises,
to 100%.

## Why

Shyden, 2026-10-21, global ruling "Ratchet to 100%, unmeasured fails now":
every changed code line must be run by a test, and a changed line in a file
no suite measures fails the pull request (no exemption list); coverage tops
every project's queue, ahead of release work. For ShyTalk the same day: the
gate (SHY-0674) judges the whole repo ("Whole repo (Recommended)"), and the
group-roles hotfix waits behind this epic ("Waits behind coverage"). Until
this story lands, any PR changing Python (.project/estimates) fails SHY-0674's gate.

Measured 2026-10-21: 4 Python files in .project/estimates (apicheck, calib, census, sizes) and no Python test exists.

## Acceptance Criteria

### Happy path

- [ ] A pytest unit suite covers the four tools, with coverage.py (`branch = true`) writing lcov joined into SHY-0674's report, and `gc.collect()` then `gc.freeze()` in `pytest_collection_finish` (the global Python rule) with a test red without it.
- [ ] SHY-0674's classification moves these files to "measured" and the
      their untested counts join the record, written in the same PR.

### Error paths

- [ ] A run whose report is missing, empty or measured none of these files
      fails CI, naming the suite (fails closed).

### Edge cases

- [ ] A tool run as a script (`__main__`) is run by its test through its main function, in-process.

### Performance

- [ ] Coverage runs as its own CI command, never in the 1 s unit step; its
      measured time is its limit at that step.

### Security

- [ ] Nothing is counted as run that did not run: a planted unrun line and an
      unrun branch arm are reported unrun, and a planted file outside every
      suite stays classed unmeasured and fails a PR that changes it.

### UX

- [x] Not applicable: developer tooling.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] CI prints this kind's measured file count, its untested counts and every file
      still classed unmeasured.

## Announce

None: internal quality tooling with no change users can see.

## BDD Scenarios

**Scenario: a run line is reported run**

- **Given** an estimate tool's function
- **When** the Python suite runs with coverage on
- **Then** its run lines are reported run

## Test Plan

- Unit tests of the conversion; planted unrun lines, branch arms and an
  unmeasured file, each seen in CI by step name.
- The no-holes rule applies: before/after lists, coverage of the changed
  code, mutations of every new control.

## Out of Scope

- The gate itself (SHY-0674) and the other kinds (EPIC-0016).

## Dependencies

- SHY-0674

## Risks & Mitigations

- Each converter can over-report; the Security AC's planted unrun lines keep
  it honest.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-21**: filed from the global ruling "Ratchet to 100%, unmeasured
  fails now" and Shyden's "Whole repo" choice for ShyTalk. P0: coverage tops
  the queue, and the group-roles hotfix waits on this epic. Scored 3
  from the measured counts above.
