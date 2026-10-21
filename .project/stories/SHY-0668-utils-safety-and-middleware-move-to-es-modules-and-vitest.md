---
id: SHY-0668
status: Draft
owner: claude
created: 2026-10-21
priority: P0
effort: L
estimate: 8
type: chore
roadmap_ids: []
mvp: true
epic: EPIC-0015
blocked_by: [SHY-0667, SHY-0675]
---

# SHY-0668: utils, safety and middleware move to ES modules and Vitest

## User Story

As the operator, I want src/utils (71), src/safety (8) and src/middleware (9) moved to ES modules with their tests on Vitest, so that express-api runs on one modern
test runner and coverage tool like every other project, with no test lost on
the way.

## Why

Shyden, 2026-10-21 (global ruling relayed from shyden.co.uk, confirmed for
ShyTalk: "Yes, file it"; order "Vitest first, then 0657", re-confirmed with
the cost shown; "express-api needs bringing up to date"): every JS/TS project
uses one test runner and coverage tool, Vitest + @vitest/coverage-v8.
Vitest's docs (v5.0.5, vitest.dev/api/vi.html): "vi.mock works only for
modules that were imported with the import keyword. It doesn't work with
require." express-api is pure CommonJS (153 source files, 0 using
import/export; tests: 914 jest.mock and 5,694 jest.fn sites, measured
2026-10-21), so each area moves to ES modules and its tests to Vitest
together. Node 24+ can require() an ES module without top-level await, so
moved and unmoved areas run side by side until the last one moves.

## Acceptance Criteria

### Happy path

- [ ] The 88 source files use import/export; their callers still unmoved require them (Node require of ES modules).
- [ ] Their tests (tests/utils 59, tests/safety 11, tests/middleware 16 and the unit tests that cover them) run on Vitest with vi.mock/vi.fn; 111 module-mock sites rewritten.

### Runtime proof

- [ ] Before any file moves, its CommonJS-only constructs are listed in
      the PR and each one's ES-module form has a test. Measured 2026-10-21 by text search over the area (comments included, so
      an upper bound; each file is re-measured before it moves): utils (71 files): `__dirname`/`__filename` in 2, function-scoped
      `require()` in 6, `exports.x =` in 1, non-literal `require()` in 1
      (two more matches are comments): `src/utils/firebase.js:79` loads the
      service-account JSON, a branch only the deployed servers run (every
      CI boot uses `NODE_ENV=local`); safety (8): function-scoped
      `require()` in 2 (its one non-literal match is a comment); middleware
      (9): function-scoped `require()` in 2.
- [ ] Circular imports among the moved files are listed (static `import` is
      hoisted, so a cycle a function-scoped `require()` tolerated can fail at
      load); each is untangled, or proven by the boot checks below.
- [ ] The server boots from `npm start` with the moved files in both CI boot
      checks: local mode (Integration Tests' "Start Express API") and deployed
      mode (SHY-0667's check: not `NODE_ENV=local`, a throwaway
      service-account file, `/api/health` answering). A crash fails at the
      stated ceiling and prints the server's own output.
- [ ] The Integration Tests job is green on the PR's head SHA, read by step
      name ("Start Express API", "Run integration tests").
- [ ] After the merge, Deploy To Dev serves the merge SHA ("Verify dev API
      health") and its "Dev Sanity Check" and "Dev Smoke Tests" jobs are green
      on that run; a red one is fixed before the next area moves.
- [ ] No production deploy carries this area until the journeys that exercise
      it (each moved route or job mapped to its journey scenarios in the PR)
      are green on dev for that SHA (the journey PROD GATE), and the prod
      deploy's "Verify prod API health" and "Smoke Test (API)" pass.

### Error paths

- [ ] A module still required by an unmoved file but using top-level await fails a guard (Node cannot require it).

### Edge cases

- [ ] Default and named exports keep the names callers use: a guard compares each moved module's exports before and after.

### Performance

- [ ] Per-test limits hold on Vitest; the unit CPU limit pinned for the new runner.

### Security

- [ ] No test is dropped, skipped or weakened by the move: the number of
      tests and assertions per moved file is the same before and after,
      checked by a guard that counts both runners' results.

### UX

- [ ] No change a user can see, proven by the Runtime proof ACs (dev
      health, sanity and smoke runs, the journey PROD GATE), not assumed:
      this story rewrites code the live API runs.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] CI prints, per runner, the files it ran and the totals, so a moved file
      that silently stopped running shows.

## Announce

None, once the Runtime proof ACs show the deployed API unchanged. A change
users can see that they find is a defect fixed before release, never
announced.

## BDD Scenarios

**Scenario: a moved area keeps every test**

- **Given** an area moved to ES modules with its tests on Vitest
- **When** CI runs both runners
- **Then** every test of the area runs under Vitest, none under Jest, and the
  totals match the count before the move

## Test Plan

- Count tests per file under Jest before the move and under Vitest after;
  plant a dropped test and a file run by neither runner, each seen red.
- The no-holes rule applies: before/after lists, coverage of changed code,
  mutations of every new guard.

## Out of Scope

- Kotlin (JaCoCo stays) and iosApp; other epics' feature work.

## Dependencies

- SHY-0667
- SHY-0675

## Risks & Mitigations

- jest.mock factories that close over outer variables need vi.hoisted;
  timer mocks and module registry resets differ: each is listed per file
  before it moves.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name on both runners;
      merged to `develop`.

## Notes

- **2026-10-21**: filed from the Vitest ruling. Scored 8: 88 source files, ~86 test files, ~111 module-mock sites (measured).
- **2026-10-21**: Runtime proof ACs added. The first draft proved only the
  tests, though this story rewrites code the live API runs (found by a side
  agent; Shyden: "proper checks are, of course, required").
  Blocked by SHY-0675: the first ES module to reach the servers needs a Node
  there that can require one, and the servers' Node is unmeasured.
