---
id: SHY-0680
status: Draft
owner: claude
created: 2026-10-21
priority: P0
effort: L
estimate: 8
type: chore
roadmap_ids: []
mvp: true
epic: EPIC-0016
blocked_by: [SHY-0674]
---

# SHY-0680: Kotlin/Native iOS code is measured, or Shyden decides with the evidence

## User Story

As the operator, I want every line of Kotlin/Native (shared/src/iosMain) measured by a coverage tool
in CI, so that SHY-0674's gate can judge it and ShyTalk's coverage only rises,
to 100%.

## Why

Shyden, 2026-10-21, global ruling "Ratchet to 100%, unmeasured fails now":
every changed code line must be run by a test, and a changed line in a file
no suite measures fails the pull request (no exemption list); coverage tops
every project's queue, ahead of release work. For ShyTalk the same day: the
gate (SHY-0674) judges the whole repo ("Whole repo (Recommended)"), and the
group-roles hotfix waits behind this epic ("Waits behind coverage"). Until
this story lands, any PR changing Kotlin/Native (shared/src/iosMain) fails SHY-0674's gate.

Measured 2026-10-21: shared/src/iosMain holds 60 Kotlin files compiled by Kotlin/Native, which JaCoCo cannot measure. Researched 2026-10-21: the only official document (kotlin-native CODE_COVERAGE.md, at the v1.9.20-Beta tag) describes a compiler flag built on Clang source-based coverage and calls it broken; no current Kover support for Native was found.

## Acceptance Criteria

### Happy path

- [ ] The compiler's coverage instrumentation is tried on a real iosMain test build in CI (iosTest via the simulator), with llvm-profdata and llvm-cov export to lcov, and joined into SHY-0674's report if it works.
- [ ] If no tool can measure iosMain, the evidence (the commands, their output, the versions) goes to Shyden with options and costs before anything else is done; the files stay classed unmeasured until he decides.
- [ ] SHY-0674's classification moves these files to "measured" and the
      joined figure includes them, the figure file raised in the same PR.

### Error paths

- [ ] A run whose report is missing, empty or measured none of these files
      fails CI, naming the suite (fails closed).

### Edge cases

- [ ] Code iosMain shares with commonMain through expect/actual is reported per actual, not merged with the JVM figures.

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

- [ ] CI prints this kind's measured file count, its figure and every file
      still classed unmeasured.

## Announce

None: internal quality tooling with no change users can see.

## BDD Scenarios

**Scenario: a run line is reported run**

- **Given** an iosMain function run by an iosTest
- **When** the iOS test build runs with coverage instrumentation
- **Then** its run lines are reported run, or Shyden has the evidence

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
  the queue, and the group-roles hotfix waits on this epic. Scored 8
  from the measured counts above.
