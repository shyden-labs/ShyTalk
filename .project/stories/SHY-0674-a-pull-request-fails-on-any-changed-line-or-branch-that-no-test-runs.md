---
id: SHY-0674
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
---

# SHY-0674: a pull request fails on any changed line or branch that no test runs

## User Story

As the operator, I want a required CI verdict that fails a pull request on
any changed code line or branch arm no test runs, on any changed line in a
file no suite measures, and on any file whose count of untested statements or
branch arms rises, so that ShyTalk's untested code only shrinks, to zero.

## Why

Shyden, 2026-10-21, global ruling "Ratchet to 100%, unmeasured fails now"
(replacing "Measure all first"): *"the percentage i pick is 100%"*, then
"Ratchet to 100%", *"apply that ratchet globally"*, and on code no tool
measures yet, *"this should have been in place since the beginning so we are
not moving forward until every project is fixed"*. For ShyTalk the same day:
the gate judges the whole repo ("Whole repo (Recommended)"), and the
group-roles hotfix waits behind this epic ("Waits behind coverage").

Measured 2026-10-21: express-api's Jest already writes lcov
(`sonarcloud.yml:167`, `--coverageReporters=lcov`) and `test-backend.yml:115`
writes html; Android's `app` writes JaCoCo XML (`jacocoDevDebugUnitTestReport`,
`app/build.gradle.kts:432`). Nothing else is measured. lcov is the format
@vitest/coverage-v8 writes too, so this gate starts on today's tools and the
reader is unchanged when SHY-0673 swaps the provider.

## Acceptance Criteria

### Happy path

- [ ] Every tracked file is classed, by one committed list keyed by path
      pattern: code a suite measures, code no suite measures yet, or not code
      (each not-code entry with its reason, shown in the PR for Shyden). Test
      files, tool configs and workflow files are code, measured like any
      other (global ruling 2026-10-22: "all"). A file no entry classes fails
      the check (fails closed).
- [ ] The check joins every measured suite's report (express-api lcov,
      JaCoCo XML converted to the same form, and each EPIC-0016 story's
      report as it lands) and, against the diff to `origin/develop`, fails on
      any changed code line or branch arm no test ran, naming file and line.
- [ ] A changed code line in a file classed "no suite measures yet" fails the
      check, naming the file and the story that will measure it. No list of
      passing exceptions exists.
- [ ] One committed record holds each code file's count of untested
      statements and untested branch arms (every measured suite joined).
      A PR fails when any file's count rises. A file at zero stays at zero,
      and the record must EQUAL the measured counts, so a gain fails CI
      until the PR that earns it records it, by the same record step as
      the floors. Counts, not percentages: a percentage ratchet would
      block a PR that deletes well-tested code. The repo percentage is
      still printed on every run, and the goal is every count at zero.
- [ ] Run-to-run wobble is measured before the first record (the suites
      run repeatedly on one commit and the counts are compared). Any line
      whose coverage wobbles gets a fixed test before the record is
      written.
- [ ] Lines coverage is told to skip (`istanbul ignore`, `c8 ignore`,
      `v8 ignore`, `pragma: no cover`, a JaCoCo exclusion) count as unrun, in
      the untested counts and in the changed-line check (3 such markers in the repo,
      measured 2026-10-22); a test plants each form.
- [ ] Required through PR Gate (the check's job in `gate`'s needs, failing
      when the check did not succeed) and read back from the ruleset.

### Error paths

- [ ] A report missing, unparsable, or older than the PR's head SHA fails the
      check (fails closed).
- [ ] A suite that ran with coverage off, or measured zero files, fails the
      check naming the suite.

### Edge cases

- [ ] Comments and blank lines are not code lines; a deleted line is not
      counted. Each form is planted.
- [ ] A PR that adds a kind's measurement is judged with that measurement:
      the classification and the reports come from the PR's own tree, so a
      measuring story can change the code it starts measuring.
- [ ] Coverage is collected by its own command, never by the 1 s unit step
      (coverage stays OFF there).

### Performance

- [ ] The check's measured time is its limit at its CI step.

### Security

- [ ] No way round the check: it cannot be skipped by a path filter, a label
      or a docs-only fast path when a code file changed (planted: a code
      change inside a docs-only PR, red). Its reader is mutation-tested.
- [ ] "Not code" cannot hide code: a file whose extension is a language
      (`.js .mjs .cjs .ts .kt .kts .swift .sh .zsh .py .rules`, and
      `database.rules.json`), and any workflow or composite action file, can
      never be classed not code; a test plants each and sees the
      classification refused.

### UX

- [x] Not applicable: developer tooling.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] CI prints each changed file's untested counts against the record, the
      repo percentage, each suite's measured
      file count, and every unrun or unmeasured changed line.

## Announce

None: an internal quality gate with no change users can see.

## BDD Scenarios

**Scenario: an unrun changed line fails the PR**

- **Given** a PR changes an express-api line no test runs
- **When** the coverage check runs
- **Then** it fails, naming the file and line

**Scenario: an unmeasured file fails the PR**

- **Given** a PR changes a Swift line and no suite measures Swift yet
- **When** the coverage check runs
- **Then** it fails, naming the file and the story that will measure Swift

## Test Plan

- Unit tests of the classifier, the diff mapper, each report parser and the
  count comparison; planted PRs for an unrun line, an unrun branch arm, an
  unmeasured file, a file whose untested count rose, a gain left unrecorded,
  a missing report and a skipped suite,
  each seen red in CI by step name.
- The no-holes rule applies: before/after lists, coverage of the check's own
  code, mutations of every new control.

## Out of Scope

- Measuring each kind of code: EPIC-0016's other stories.

## Dependencies

- None. It runs on today's tools; each EPIC-0016 story adds its report.

## Risks & Mitigations

- **PRs touching unmeasured kinds cannot merge until their story lands.** That
  is the ruling ("unmeasured fails now"); EPIC-0016's measuring stories are
  P0 so they land first.
- **Kotlin/Native may have no working tool** (SHY-0680): if so, Shyden decides,
  with the evidence.

## Definition of Done

- [ ] Every AC ticked with its proof; the check required and read back; every
      planted PR seen red; merged to `develop`.

## Notes

- **2026-10-21**: filed in EPIC-0015 as a P1 changed-line verdict after the
  Vitest move. Rewritten the same day for the global ruling "Ratchet to 100%,
  unmeasured fails now": moved to EPIC-0016, P0 (coverage tops the queue,
  ahead of release work), no longer blocked by SHY-0673 (it reads lcov, which
  Jest writes today), and widened to the whole repo (Shyden). Rescored 8:
  classifier, joined reports with a JaCoCo converter, the untested-count record and its
  recorder, the required gate, and six planted PRs. Model: shyden.co.uk #896
  and #902 (not read from ShyTalk).
- **2026-10-22**: the global ruling "What counts as code, skipped lines, and
  workflow code" (steadyhand #381, then "Global"): test files, tool configs
  and workflow files are code; skip markers count as unrun; a per-file
  record is the recommended shape. The "test code" class is removed;
  workflow measurement is SHY-0687, never-on-PR jobs SHY-0688.
- **2026-10-22**: the ratchet counts untested statements and branch arms per
  file (global ruling, yawelo-idle #728, "make this apply to every project"):
  the record equals the measured counts and no count rises; wobble measured
  before the first record. Replaces the percentage figure above.
