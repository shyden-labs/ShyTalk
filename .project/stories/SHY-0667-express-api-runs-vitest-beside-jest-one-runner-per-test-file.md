---
id: SHY-0667
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
---

# SHY-0667: express-api runs Vitest beside Jest, one runner per test file

## User Story

As the operator, I want Vitest 5 and @vitest/coverage-v8 running beside Jest in CI, so that express-api runs on one modern
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

- [ ] vitest and @vitest/coverage-v8 are dev dependencies pinned to the same exact version, with a test pinning both and a Dependabot group moving them together.
- [ ] vitest.config mirrors jest.config (test files, the node environment, the global setup, the public/js/core transform); the retry setup is not carried over (no retries, SHY-0547).
- [ ] test-backend runs both runners; a guard proves every test file is claimed by exactly one runner, from a recorded list of moved files that only grows.

### Runtime proof

- [ ] A deployed-mode boot check runs in CI on every PR that changes
      express-api: `npm start` with `NODE_ENV` not `local`, a throwaway
      service-account file made in the job and a stand-in
      `FIREBASE_DATABASE_URL`, and `/api/health` must answer. The
      service-account load (`src/utils/firebase.js:79`) runs only on the
      deployed servers today, since every CI boot uses `NODE_ENV=local`; this
      proves it before merge. Planted: the load broken, the check red.
- [ ] The three "Start Express API" steps (`integration-tests.yml:86`,
      `e2e-tests.yml:195`, `playwright-tests.yml:219`) wait for `/api/health`
      with no ceiling (`until curl …; do sleep 1; done`), so a server that
      crashes at boot shows as a hung job. Each fails at a measured ceiling,
      or as soon as the server process exits, printing the server's own
      output. Planted: a boot crash, each step red within its ceiling.
- [ ] How moved files are marked as ES modules (`.mjs`, or `"type": "module"`
      with `.cjs` for the rest) is chosen in the plan. Before any change that
      makes Node read a `.js` file as an ES module, the servers' pm2
      `ecosystem.config.js` (on the servers only, not in git:
      `ORACLE-CLOUD-SETUP.md` §11) is brought into git as `.cjs` and the
      deploy restarts pm2 from it.
- [ ] No ES module reaches the servers in this story: the deploy tarball's
      express-api files are all CommonJS, checked by a guard over the
      files the deploy packs (planted: one `.mjs` source, the guard red).

### Error paths

- [ ] A test file claimed by both runners, or by neither, fails the guard naming it.
- [ ] A Vitest run that finds no file for a moved path fails (fails closed).

### Edge cases

- [ ] The one test file that already uses import keeps working under whichever runner claims it.

### Performance

- [ ] Each runner's CI step has one measured limit; no unit limit is raised (SHY-0548 applies to both).

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

- None.

## Risks & Mitigations

- jest.mock factories that close over outer variables need vi.hoisted;
  timer mocks and module registry resets differ: each is listed per file
  before it moves.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name on both runners;
      merged to `develop`.

## Notes

- **2026-10-21**: filed from the Vitest ruling. P0: SHY-0657 (P0) waits on this epic, so the epic takes its level. Scored 5: config, CI, the one-runner guard and its floor.
- **2026-10-21**: Runtime proof ACs added (a side agent found the epic proved
  only tests; Shyden: "proper checks are, of course, required"). Rescored 8:
  the deployed-mode boot check, three bounded server waits and the pm2 config
  in git, each with a planted failure, on top of the 5 above.
