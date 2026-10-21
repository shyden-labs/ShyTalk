---
id: SHY-0671
status: Draft
owner: claude
created: 2026-10-21
priority: P0
effort: XL
estimate: 13
type: chore
roadmap_ids: []
mvp: true
epic: EPIC-0015
blocked_by: [SHY-0668, SHY-0670]
---

# SHY-0671: the second half of the routes moves to ES modules and Vitest

## User Story

As the operator, I want the second half of src/routes (M to Z) moved to ES modules with its tests on Vitest, so that express-api runs on one modern
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

- [ ] Those route files use import/export and their route tests run on Vitest.
- [ ] No route file is left on CommonJS: a guard over src/routes.

### Runtime proof

- [ ] Before any file moves, its CommonJS-only constructs are listed in
      the PR and each one's ES-module form has a test. Measured 2026-10-21 by text search over the area (comments included, so
      an upper bound; each file is re-measured before it moves): routes M to Z (17 files): function-scoped `require()` in 2,
      `exports.x =` in 2.
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

- [ ] As SHY-0670.

### Edge cases

- [ ] As SHY-0670.

### Performance

- [ ] As SHY-0670.

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

- SHY-0668, SHY-0670

## Risks & Mitigations

- jest.mock factories that close over outer variables need vi.hoisted;
  timer mocks and module registry resets differ: each is listed per file
  before it moves.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name on both runners;
      merged to `develop`.

## Notes

- **2026-10-21**: filed from the Vitest ruling. Scored 13: the other half of the route tests and their mocks.
- **2026-10-21**: Runtime proof ACs added. The first draft proved only the
  tests, though this story rewrites code the live API runs (found by a side
  agent; Shyden: "proper checks are, of course, required").
