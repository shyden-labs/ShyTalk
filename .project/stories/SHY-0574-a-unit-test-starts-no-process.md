---
id: SHY-0574
status: Draft
owner: claude
created: 2026-10-12
priority: P0
effort: XL
estimate: 13
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0574: A unit test starts no process; tests that need one run in a suite of their own

## User Story

As a developer, I want the unit suite to call code in the test process, with
any process it would start stood in, so that unit tests are fast and cannot
wait on another program. Tests that really need to run a script keep running,
in a suite of their own.

## Why

Global rule (operator 2026-10-08, every project, from shyden.co.uk #629): a
unit test starts no child process of any kind (a script under node or python,
git, a shell, a device or image tool). A test that needs one is rewritten to
call the code in the test process with the process stood in, or moves to a
non-unit suite with its own measured limit. The unit setup refuses every
process entry point by name. No ShyTalk story covered it: SHY-0546 covers
only the network connections those processes make, and SHY-0548 cuts their
wall time.

Measured 2026-10-12 on develop `7a03c84` (a static count, to be replaced by
the per-test recorder in the first AC):

- 77 of the 550 express-api test files reference `child_process` or call
  `spawn`, `exec`, `execFile` or their sync forms; 4 of them mock it. By
  folder: `tests/scripts` 75, `middleware` 1, `cron` 1.
- 13 source and script modules start processes (12 under `scripts/`, plus
  `src/cron/serverHealth.js`), so tests that load them can start processes
  without naming `child_process`. The static count cannot see those.
- SHY-0548 measured the cost on 2026-10-08: 147 of the 151 unit tests over
  1 s spent under half their wall time on CPU, waiting on child processes. The
  worst waits 138 s.

## Acceptance Criteria

### Happy path

- [ ] Every process start is recorded per test (file, test, command) in one
      full run of the unit tier. The population replaces the static count in
      Why, and both counts are kept.
- [ ] Each test that starts a process is either rewritten to call the code in
      the test process with the process stood in, or moved to a `processes`
      suite (Jest project) with its own CI step and one measured limit. The
      choice for each file, and why, is in Notes. Per the global rule, a move
      keeps a stand-in unit test of the logic in the same PR.
- [ ] The unit tier's test count plus the `processes` suite's is never less
      than before, except for merges, each one named.
- [ ] `local/test-unit.sh` runs no process-starting test; the new suite has
      its own local script.

### Error paths

- [ ] The unit setup file refuses every process entry point by name
      (`spawn`, `spawnSync`, `exec`, `execSync`, `execFile`, `execFileSync`,
      `fork`, and `child_process` loaded through `node:` or a destructured
      import). The test that tried fails, naming the command. No warning-only
      mode.

### Edge cases

- [ ] Each refused form is planted in a scratch unit test and seen red,
      including a call made through one of the 13 modules that start
      processes.
- [ ] A test that mocks `child_process` (4 today) is still allowed: nothing
      starts.

### Performance

- [ ] The unit tier's summed wall time and the new suite's are recorded
      before and after.

### Security

- [ ] The shell-metacharacter and argument-injection tests keep every
      assertion, in whichever suite they land.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] Each suite's report says which suite it is, with its own count.

## BDD Scenarios

**Scenario: A unit test that starts a shell fails by name**

- **Given** a unit test that runs `git status` through `execSync`
- **When** the unit tier runs
- **Then** that test fails, naming `git status`

**Scenario: A script test still runs**

- **Given** a test that must run a bash script
- **When** CI runs on a pull request
- **Then** it runs in the `processes` step and passes there

## Test Plan

- The per-test process recorder over the whole unit tier, before and after:
  zero starts after.
- Every refused form planted and seen red, then removed.
- Both suites green on the PR, every step read by name.

## Out of Scope

- Network connections (SHY-0546), the 1 s limit (SHY-0548), and whole-repo
  guards (SHY-0563), which leave the unit tier first.

## Risks & Mitigations

- **Over 13 points.** The 75 script tests are measured again after SHY-0563
  moves the whole-repo guards out. If the remainder is still over 13, the
  story is split by folder before work starts.

## Dependencies

- SHY-0563 (guards leave the unit tier first, so they are not counted here)
  and SHY-0546 (the tier split and its Jest projects). Operator order
  2026-10-12: SHY-0556, SHY-0518, SHY-0563, then the unit split.

## Definition of Done

- [ ] Every AC ticked with its proof; both suites green in CI by step name;
      merged to `develop`; Notes hold the per-file decisions.

## Notes

- **2026-10-12**: Filed as a gap found while starting SHY-0546. Scored 13
  from the static count (77 files, 13 process-starting modules), with a
  re-measure and split rule above.
