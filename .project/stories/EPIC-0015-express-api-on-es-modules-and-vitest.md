---
id: EPIC-0015
status: Draft
owner: claude
created: 2026-10-21
priority: P0
title: express-api on ES modules and Vitest, one test runner and coverage tool
child_shys: [SHY-0667, SHY-0668, SHY-0669, SHY-0670, SHY-0671, SHY-0672, SHY-0673, SHY-0674]
---

# EPIC-0015: express-api on ES modules and Vitest, one test runner and coverage tool

## Vision

express-api is brought up to date (Shyden, 2026-10-21: "express-api needs
bringing up to date"): ES modules throughout, its tests on Vitest with
@vitest/coverage-v8, the one test runner and coverage tool every JS/TS
project uses (global ruling relayed from shyden.co.uk, confirmed for ShyTalk:
"Yes, file it"), and a PR that leaves a changed line or branch unrun fails.

## Scope

Vitest's docs (v5.0.5, vitest.dev/api/vi.html): "vi.mock works only for
modules that were imported with the import keyword. It doesn't work with
require." express-api is pure CommonJS (153 source files: utils 71, routes 49,
cron 15, middleware 9, safety 8, the entry point; 0 using import/export; 590
test files with 914 jest.mock and 5,694 jest.fn sites, measured 2026-10-21).
So each area moves to ES modules and its tests to Vitest together. Node 24+
can require() an ES module without top-level await, so moved and unmoved areas
run side by side, Jest and Vitest both in CI, until the last area moves.

Order:

1. SHY-0667: Vitest beside Jest, one runner per file (5).
2. SHY-0668 (utils, safety, middleware, 8) and SHY-0669 (cron, entry point,
   scripts, 8), each after SHY-0667.
3. SHY-0670 and SHY-0671: the routes in two halves (13 each), after SHY-0668.
4. SHY-0672: the remaining tests and SHY-0657's red-first step (8).
5. SHY-0673: Jest removed (5).
6. SHY-0674: a changed-line coverage verdict (5), after SHY-0673.

Out of scope: Kotlin keeps JaCoCo; iosApp's Swift has no coverage tool today:
none is configured (measured 2026-10-21; build.gradle.kts:135 only holds a
TODO naming Slather or xchtmlreport for later).

## Child SHYs

- SHY-0667: express-api runs Vitest beside Jest, one runner per test file (P0, 5)
- SHY-0668: utils, safety and middleware move to ES modules and Vitest (P0, 8)
- SHY-0669: cron, the entry point and the scripts move to ES modules and Vitest (P0, 8)
- SHY-0670: the first half of the routes moves to ES modules and Vitest (P0, 13)
- SHY-0671: the second half of the routes moves to ES modules and Vitest (P0, 13)
- SHY-0672: the remaining tests and the rules red-first step move to Vitest (P0, 8)
- SHY-0673: Jest leaves express-api (P0, 5)
- SHY-0674: a pull request fails on any changed line or branch that no test runs (P1, 5)

65 points.

## DoD at Epic Level

- [ ] Every child SHY Done.
- [ ] express-api has no CommonJS source file and no Jest dependency; every
      test runs on Vitest; no test was dropped (per-file counts before and
      after recorded).
- [ ] The changed-line coverage verdict is required and has failed a planted PR.

## Notes

- **2026-10-21**: filed from the Vitest ruling. Order chosen by Shyden from
  written options, "Vitest first, then 0657", and re-confirmed with the cost
  shown (the ES-module conversion; my guess then, 40-80 points; scored here at
  65). SHY-0657 (P0) is blocked by SHY-0672, so SHY-0653's Security AC and the
  group-roles hotfix wait on this epic. P0: the epic blocks a P0, so it takes
  that level; SHY-0674 is P1 (a quality gate, not on the hotfix path).
