---
id: SHY-0676
status: Draft
owner: claude
created: 2026-10-21
priority: P0
effort: M
estimate: 5
type: chore
roadmap_ids: []
mvp: true
epic: EPIC-0016
blocked_by: [SHY-0674]
---

# SHY-0676: express-api and Node code run in child processes is measured

## User Story

As the operator, I want every line of express-api code, or other Node code, that a test runs in a child process measured by a coverage tool
in CI, so that SHY-0674's gate can judge it and ShyTalk's coverage only rises,
to 100%.

## Why

Shyden, 2026-10-21, global ruling "Ratchet to 100%, unmeasured fails now":
every changed code line must be run by a test, and a changed line in a file
no suite measures fails the pull request (no exemption list); coverage tops
every project's queue, ahead of release work. For ShyTalk the same day: the
gate (SHY-0674) judges the whole repo ("Whole repo (Recommended)"), and the
group-roles hotfix waits behind this epic ("Waits behind coverage"). Until
this story lands, any PR changing express-api code, or other Node code, that a test runs in a child process fails SHY-0674's gate.

Measured 2026-10-21: 90 express-api test files start a process (child_process, execFileSync, spawnSync, execSync or spawn); the integration, e2e and Playwright suites start the server as `node src/index.js`; the repo's Node scripts outside express-api (scripts/ 26 .js and 7 .mjs, local/ 4, assets/ 2) run only when something starts or loads them.

## Acceptance Criteria

### Happy path

- [ ] Every child Node process a test or suite starts writes V8 coverage (`NODE_V8_COVERAGE`), converted with ast-v8-to-istanbul to lcov and joined into SHY-0674's report.
- [ ] The server started by the Integration Tests, e2e and Playwright suites is measured the same way, so the routes those suites call count as run.
- [ ] Never Vitest's `coverage.autoAttachSubprocess`. It merges a file's
      in-worker (Vite-transformed) and child-process (native) coverage by
      URL, reads never-called functions as run, and lost 20 real lines in
      shyden.co.uk's report (their PR #921, measured 2026-10-21). The
      converter keeps only entries whose code is the file's own text.
      Planted: a module a test imports and a child also runs, with a
      rewritten import and an uncalled function, which must stay unrun.
- [ ] Node scripts outside express-api that a test loads in-process are in the coverage `include`; the rest are measured as child processes.
- [ ] SHY-0674's classification moves these files to "measured" and the
      their untested counts join the record, written in the same PR.

### Error paths

- [ ] A run whose report is missing, empty or measured none of these files
      fails CI, naming the suite (fails closed).

### Edge cases

- [ ] A child process killed or exiting through `process.exit` still writes its coverage (planted: a script that exits early, its lines before the exit reported run).

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

- **Given** a script run as a child process
- **When** the test that starts it runs with coverage on
- **Then** the script's run lines are reported run in the joined report

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
  the queue, and the group-roles hotfix waits on this epic. Scored 5
  from the measured counts above.
- **2026-10-22**: the autoAttachSubprocess warning added, relayed by the
  shyden.co.uk session from its measured PR #921.
