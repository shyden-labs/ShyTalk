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
blocked_by: [SHY-0667]
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

- [x] Not applicable: developer tooling.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] CI prints, per runner, the files it ran and the totals, so a moved file
      that silently stopped running shows.

## Announce

None: an internal tooling change with no change users can see.

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

## Risks & Mitigations

- jest.mock factories that close over outer variables need vi.hoisted;
  timer mocks and module registry resets differ: each is listed per file
  before it moves.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name on both runners;
      merged to `develop`.

## Notes

- **2026-10-21**: filed from the Vitest ruling. Scored 8: 88 source files, ~86 test files, ~111 module-mock sites (measured).
