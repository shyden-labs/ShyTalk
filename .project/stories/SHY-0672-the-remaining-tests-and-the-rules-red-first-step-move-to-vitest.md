---
id: SHY-0672
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
blocked_by: [SHY-0668, SHY-0669]
---

# SHY-0672: the remaining tests and the rules red-first step move to Vitest

## User Story

As the operator, I want the remaining test folders (firestore-rules, rtdb-rules, contracts, client-core, admin-client, helpers, drivers) and SHY-0657's rules red-first step on Vitest, so that express-api runs on one modern
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

- [ ] Those tests run on Vitest, the rules emulator tests included.
- [ ] SHY-0657's step (express-api/scripts/rules-red-first.js) lists, selects and runs tests with Vitest's own options (name filter, JSON output, setup file), its unit tests updated, and its guards (jest setup pin, stub scanner categories, library-form rules) rewritten for Vitest.

### Runtime proof

- [ ] The moved red-first step is proven in CI by what it does, not only by
      its unit tests: on a planted PR that changes the rules, a DENY test that
      passes on the base rules turns the step red, and the real step goes
      green, each read by step name in test-backend.
- [ ] The rules emulator suites run in CI on Vitest against the real
      emulators, with per-file test counts equal to the Jest run before.

### Error paths

- [ ] The red-first step's fail-closed paths (no output, unparsable output, listing that ran a test) keep their tests.

### Edge cases

- [ ] The base-rules setup wraps assertSucceeds the same way under Vitest.

### Performance

- [ ] The red-first step's measured limit is set again on Vitest.

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

- SHY-0668, SHY-0669

## Risks & Mitigations

- jest.mock factories that close over outer variables need vi.hoisted;
  timer mocks and module registry resets differ: each is listed per file
  before it moves.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name on both runners;
      merged to `develop`.

## Notes

- **2026-10-21**: filed from the Vitest ruling. Scored 8: the remaining ~29 test files plus the red-first runner layer and its guards. SHY-0657 is blocked by this story.
- **2026-10-21**: Runtime proof ACs added: the red-first step is CI tooling
  every rules PR depends on, so it is proven on a planted rules PR, not only
  by its unit tests.
