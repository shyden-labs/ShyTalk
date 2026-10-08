---
id: SHY-0548
status: Draft
owner: claude
created: 2026-10-08
priority: P0
effort: XL
estimate: 13
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0548: Every Jest unit test runs in under one second, and no test raises its own limit

## User Story

As a developer, I want every backend unit test to finish in under a second
under a 1 s runner limit that nothing can raise, so that the unit suite stays
fast and a slow new test fails the day it is written.

## Why

Global rule (operator 2026-10-07, every project): *"units tests are meant to be
super fast. 5 seconds for a single test is already too long"*, and 2026-10-08:
*"these unit tests should take up to 1 SECOND each, not 1 minute or more ...
file a ticket for all projects to make their unit tests follow this rule. and
prevent any new tests from failing to abide by it"*, and *"all new tests must
follow this limit too - global rule"*. Two more global decisions the same day
(first made in Steadyhand, steadyhand#282, relayed by the shyden.co.uk
session): **(A)** the 1 s limit is judged in its own CI step with coverage
OFF, and coverage steps carry no per-test limit; **(B)** a test cut to fit
lands at or under **0.3 s of its own CPU**, for headroom against a loaded
machine.

Measured 2026-10-08 on develop `4b94b70`, after splitting the 543 files into
tiers by the services they reach (SHY-0546's measurement):

- **The limit today:** `express-api/jest.config.js` sets `testTimeout: 10000`,
  and its comment says the extra time absorbs machine load.
- **Raised limits, counted from the parse tree** of all 548 express-api test
  and config files: 54 sites in 15 files.
  - The config's `testTimeout: 10000`.
  - 3 `jest.setTimeout` calls.
  - 50 third-argument timeouts, 32 of them in
    `tests/cron/accountDeletion.test.js`.
  - A text search also hit 19 other files; every one was a false match, such
    as `_resetConfigCache` or a comment.
- **Raised limits in browser specs:** 4 `test.setTimeout(40_000)` in
  `tests/web/admin-suggestions.spec.ts` (lines 701, 787, 1585, 1656). That is
  a Playwright suite: it keeps one limit at its CI step, and no test inside it
  raises its own. These matched the shyden.co.uk census of 58 sites.
- **Unit tier, coverage off:** 14,465 tests. 140 take over 1 s, in 35 files;
  the summed wall time is 730.7 s.
  - The worst is `tests/scripts/check-story-frontmatter.test.js` :: `every
    story actually in the repository parses the validator`, at 138.4 s (161.7 s
    with coverage) using 0.02 s of CPU. It is a wait on child processes.
  - By file: `sync-stories-to-issues-board-fields.test.js` 45,
    `pre-merge-check.test.js` 12, `identity-graph-new-routes.test.js` 9,
    `check-story-frontmatter.test.js` 7, `gh-pages-publisher-loop.unit.test.js`
    6, `ios-journey-device-timeouts.test.js` 4, then 29 more files.
  - With coverage on, the same tier has 151 over 1 s in 34 files, which is
    why (A) judges with coverage off.
- **CPU** (worker `process.cpuUsage()` per test, with coverage on, so an upper
  bound): 147 of the 151 slow tests used less than half their wall time in
  CPU, so they are waits on child processes or I/O, and the processes are what
  to cut. 113 unit-tier tests use over 0.3 s of CPU. The top two are
  `tests/scripts/firebase-admin-namespace-surface.test.js` at 6.78 s and
  5.52 s of CPU: repeated work, so the walk or parse is to be shared.
- **Integration tier** (63 files, 1,016 tests; real services, so not bound by
  1 s): 25 tests over 1 s; summed wall time 143.0 s. It keeps one measured
  limit at its own CI step.

## Acceptance Criteria

### Happy path

- [ ] The unit tier (SHY-0546) runs with `testTimeout: 1_000`, in its own CI
      step with coverage OFF (decision A). The coverage step carries no
      per-test limit and is not where the 1 s limit is judged.
- [ ] Every one of the 140 unit tests over 1 s (and any others found on the
      branch) has its WORK cut until its own CPU is at or under 0.3 s
      (decision B) and its wall time is under 1 s with coverage off. Before
      and after are recorded per test in Notes. Nothing is skipped, deleted
      without a replacement assertion, or moved to the integration tier to
      escape the limit.
- [ ] All 54 raised limits in express-api and the 4 `test.setTimeout` calls
      in `tests/web/admin-suggestions.spec.ts` are removed. The integration
      tier and the browser suite each keep one limit, at their CI step, set
      from their measured time plus a stated margin.
- [ ] All of this lands in one push. There is no burn-down list and no
      exemption.

### Error paths

- [ ] A guard refuses any raised limit, read from the parse tree (the
      repo's source-text lexer, not a regex), in every express-api test,
      setup and config file and every Playwright spec: a third argument to
      `it`/`test`/`it.each(...)`/hooks, `jest.setTimeout`, `testTimeout` above
      1 000 in the unit config, `test.setTimeout`, `{ timeout }`, and a named
      budget constant passed to any of these. Each form is planted and seen
      RED.
- [ ] A unit-tier setup file fails any test whose own CPU passes the limit,
      naming it, so a busy machine cannot hide slow code. A planted
      CPU-burning test is seen RED.

### Edge cases

- [ ] The guard's population is counted in its own verdict and checked
      against a recorded floor (the global floor rules). A loss mutant (a file
      the guard cannot read) and a growth mutant are both seen RED.
- [ ] Shared fixtures built once per file (or once per run) replace per-test
      setup where that is what was slow. A test that depended on an earlier
      test's state is caught by running the file shuffled
      (`--randomize`) once.

### Performance

- [ ] The unit tier's summed wall time with coverage off (730.7 s before) and
      its CI step time are recorded before and after.

### Security

- [ ] No security test is weakened to fit (the shell-metacharacter and
      auth cases keep every assertion). Any that cannot fit stay in the
      integration tier only if they reach a real service.

### UX

- [ ] Not applicable: no user-facing surface changes.

### i18n

- [ ] Not applicable: no copy changes.

### Observability

- [ ] The unit step prints its slowest 10 tests with wall and CPU, so creep
      toward the limit is visible before it fails.

## BDD Scenarios

**Scenario: A new slow unit test fails the day it is written**

- **Given** a new unit test whose work takes 1.2 s
- **When** the unit step runs with coverage off
- **Then** it fails on the 1 s limit, naming the test

**Scenario: A raised limit cannot come back**

- **Given** a pull request adding `}, 30000)` to a unit test
- **When** the guard runs
- **Then** it fails naming the file and line

**Scenario: A busy machine cannot hide slow code**

- **Given** a unit test that burns 1.1 s of CPU on an idle machine
- **When** the CPU check runs
- **Then** the test fails on CPU even if its wall time passed

**Scenario: The integration tier keeps one measured limit**

- **Given** a slow integration test that reaches the emulator
- **When** the integration step runs
- **Then** it is judged by that step's one limit, with no per-test raise

## Test Plan

- The whole unit tier three times locally with coverage off, every test read
  for wall time and CPU, plus CI.
- Each planted form RED against both guards, then removed.
- Mutation per cut test: the assertion it protects is broken once and seen
  RED, so a cut never empties a test.

## Out of Scope

- The split into tiers (SHY-0546), the retry (SHY-0547), and the Kotlin and
  Swift suites (SHY-0549).
- Speeding up the integration tier beyond removing its per-test raises.

## Dependencies

- SHY-0544, SHY-0546 (the unit tier must exist), SHY-0547 (no retry can mask
  the limit). Operator order 2026-10-08: SHY-0544 first.

## Risks & Mitigations

- **13 points is the board's ceiling and this could exceed it.** Mitigation:
  measured before the first edit; most of the 140 are child-process waits in a
  few script-test files (45 in one file) that share one fix each. If the
  re-measure shows more, the operator is asked before splitting, because the
  rule requires one push.
- **Wall time varies with machine load** (other sessions share the laptop).
  Mitigation: CPU is the judge (decision B); wall is checked in CI and on an
  idle machine.

## Definition of Done

- [ ] Every AC ticked with its proof; unit step green with coverage off and
      every test under 1 s; guards mutation-verified; merged to `develop`.

## Notes

- **2026-10-08**: Filed with SHY-0546, SHY-0547 and SHY-0549 at the request
  of the shyden.co.uk session (copying the shape of shyden.co.uk #629). Until
  this lands, every agent brief in ShyTalk says a new unit test over 1 s is a
  defect the day it is written. Machine-wide,
  `~/.claude/hooks/unit-limit-never-raised.py` already refuses edits that add
  a raised limit.
- Measurement method: a scratch `setupFilesAfterEnv` recording each test's
  `process.cpuUsage()` and wall time, plus Jest `--json`. The run with
  coverage on matched CI's command; the run with coverage off had the
  connection recorder loaded.
- Scored 13: 140 tests in 35 files to cut (mostly shared child-process
  fixes), 58 limit sites removed, two guards with planted forms, CI step
  changes.
