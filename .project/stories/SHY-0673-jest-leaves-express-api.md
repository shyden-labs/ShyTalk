---
id: SHY-0673
status: Draft
owner: claude
created: 2026-10-21
priority: P0
effort: M
estimate: 5
type: chore
roadmap_ids: []
mvp: true
epic: EPIC-0015
blocked_by: [SHY-0668, SHY-0669, SHY-0670, SHY-0671, SHY-0672]
---

# SHY-0673: Jest leaves express-api

## User Story

As the operator, I want Jest removed from express-api once every file runs on Vitest, so that express-api runs on one modern
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

- [ ] No jest, babel-jest or jest config remains; --experimental-vm-modules is dropped from every script and workflow.
- [ ] Coverage is @vitest/coverage-v8, lcov kept for SonarCloud and the html report kept for publishing.
- [ ] SHY-0548's limits run on Vitest.

### Runtime proof

- [ ] The deploy's `npm install --omit=dev` and `pm2 restart` still serve the
      API with Jest gone: Deploy To Dev's "Verify dev API health" serves the
      merge SHA and its "Dev Sanity Check" and "Dev Smoke Tests" jobs are green.
- [ ] Files removed from express-api are removed from the servers too: today
      the deploy extracts the tarball over the old tree, so a deleted file
      stays; the deploy replaces the tree, proven by a planted removed file
      absent after a dev deploy.
- [ ] Both CI boot checks (local and deployed mode) stay green.

### Error paths

- [ ] A workflow or hook still calling jest fails a guard naming it.

### Edge cases

- [ ] The stub scanner (SHY-0108) counts vi.mock and vi.fn as it counted jest.mock and jest.fn.

### Performance

- [ ] The backend test job is no slower than before the epic, measured.

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

- SHY-0668, SHY-0669, SHY-0670, SHY-0671, SHY-0672

## Risks & Mitigations

- jest.mock factories that close over outer variables need vi.hoisted;
  timer mocks and module registry resets differ: each is listed per file
  before it moves.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name on both runners;
      merged to `develop`.

## Notes

- **2026-10-21**: filed from the Vitest ruling. Scored 5: removal, coverage provider, scanner and SonarCloud wiring.
- **2026-10-21**: Runtime proof ACs added. The first draft proved only the
  tests, though this story rewrites code the live API runs (found by a side
  agent; Shyden: "proper checks are, of course, required").
