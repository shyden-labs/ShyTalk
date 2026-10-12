---
id: SHY-0547
status: Draft
owner: claude
created: 2026-10-08
priority: P0
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0547: No backend test is retried, so a failure shows the first time it happens

## User Story

As a developer, I want a failing Jest test to fail on its first run, so that a
slow or flaky test is seen and fixed, and the 1 s limit (SHY-0548) cannot be
dodged by trying again.

## Why

Global rule (operator 2026-10-02): *"retries are not acceptable. if retries
are required that means it's flaky, adding a retry is NOT a fix"*. Existing
retries are defects with tickets. There is no open ticket for this one.

`express-api/jest.config.js` loads `tests/_helpers/jest-retry-setup.js`, which
calls `jest.retryTimes(3, { logErrorsBeforeRetry: true })`. Every Jest test
gets three more tries.

Measured 2026-10-08 on develop `4b94b70`, whole suite as CI runs it (Jest
`--json`, which reports each test's `invocations`):

- **The retry hid a failure.** `tests/cron/index.unit.test.js` ::
  `startCronJobs production expireDataExports callback invokes the job` failed
  on its first try and passed on its second.
- **10 tests failed on all four tries** on this machine, in two files about
  `50-matrix.sh stop`:
  - `tests/scripts/runner-process-identity.test.js` (6): the five
    `50-matrix.sh stop` cases and `a hostile run id shell metacharacters in the
    run directory name cannot execute`. Each failed with `Error: exited 1`.
  - `tests/scripts/50-matrix-cmd-stop.test.js` (4): `clean run (dead pid, no
    live runners)`, `missing pid file`, `reaps a process tagged with THIS
    run_id` and `a survivor of THIS run`. These failed with `cmd_stop exited 1`
    or a `toMatch` miss.
  - Not diagnosed. Per the standing rule, each is shown to the operator with
    its full output before anyone decides whether it is a bug or a broken
    test. Other sessions' processes were running on the same machine at the
    time.

## Acceptance Criteria

### Happy path

- [ ] `jest.retryTimes` is removed, and so is `jest-retry-setup.js` (and its
      `setupFiles` entry) if nothing else is left in it.
- [ ] The once-hidden `cron/index.unit.test.js` failure is reproduced, its
      cause found and fixed (not re-run until it passes). The cause is
      recorded here.
- [ ] Each of the 10 failures is shown to the operator with its full output
      before work on it. Each is then fixed (code or test, as decided), and
      the decision recorded here.
- [ ] The whole Jest suite passes, first try, on the PR and in three local
      runs on develop's tip, each read for `invocations > 1` (expected: none).

### Error paths

- [ ] A meta-guard refuses any retry in the express-api test setup, read from
      the parse tree with planted forms: `jest.retryTimes`, a `retries` or
      `retryTimes` config key, `--retries` / `--retry` flags in
      `package.json` scripts and workflows, and a try-twice wrapper around
      `it` or `test`.

### Edge cases

- [ ] `tests/scripts/manual-qa-runner-retry-flag.test.js` tests a product
      `--retry` flag of the QA runner, not a test retry. The guard tells the
      two apart, and that file is planted as a known negative.

### Performance

- [ ] Suite wall time before and after is recorded. With no retry, a failure
      now costs one attempt, not four.

### Security

- [ ] Not applicable beyond the shell-metacharacter case above, which must
      pass for real, not on a later attempt.

### UX

- [ ] Not applicable: no user-facing surface changes.

### i18n

- [ ] Not applicable: no copy changes.

### Observability

- [ ] CI's backend step prints the count of tests run, passed and failed
      (`invocations` is always 1), and fails if the count falls below the
      recorded floor.

## BDD Scenarios

**Scenario: A failing test fails the first time**

- **Given** a Jest test that fails once
- **When** the suite runs
- **Then** the run is red on that first failure, with no second attempt

**Scenario: A retry cannot come back**

- **Given** a pull request adding `jest.retryTimes(1)` to a setup file
- **When** the meta-guard runs
- **Then** it fails naming the file and line

**Scenario: The QA runner's own retry flag is not mistaken for a test retry**

- **Given** the `--retry` flag tests for the manual-QA runner
- **When** the meta-guard runs
- **Then** it does not flag them

## Test Plan

- Three local whole-suite runs plus CI, each read for `invocations`.
- Each planted retry form RED against the meta-guard, then removed.

## Out of Scope

- Retries outside the Jest backend suite (Playwright `retries`, workflow
  retry loops). A sweep for them is its own story if one is found.
- The time limits (SHY-0548).

## Dependencies

- SHY-0544 (backend CI must run), then SHY-0546. Operator order 2026-10-08.

## Risks & Mitigations

- **The 10 failures depend on the machine.** Mitigation: they are shown to
  the operator first and reproduced alone and in CI before any change. A
  test that reads the whole machine's process list is a defect in its
  isolation, not a reason to retry.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name with every test
      at one invocation; merged to `develop`.

## Notes

- **2026-10-08**: Filed with SHY-0546, SHY-0548 and SHY-0549 from the global
  1 s rule. A side review pointed out the retry would let a test that breaks
  the 1 s limit pass on a later try.
- Scored 5: removing the retry is one line, but 11 failures (10 consistent,
  1 hidden) must each be shown, traced and fixed, plus one meta-guard.
