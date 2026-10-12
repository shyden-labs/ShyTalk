---
id: SHY-0535
status: In Review
owner: claude
created: 2026-10-07
priority: P1
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0535: Every story carries a points estimate, and progress is measured from it

## User Story

As **Shyden, the operator**, I want every ShyTalk story to carry a story-point
estimate that reaches the board, and one command that reports progress by
tickets and by effort with an ETA for each, so that I can track how close
ShyTalk is to release-ready from measured figures rather than feel.

## Why

**Operator standing rule (2026-10-04, global, every project):** *"we continue
to report as it is but give 2 estimates. 1 based on tickets complete and 2
based on effort remaining. If effort remaining isn't available then review
tickets to add an estimate on effort for better eta reliability"*. Decided in
the same exchange: effort is in **story points** (Fibonacci 1, 2, 3, 5, 8, 13;
anything larger is an epic to split), held in a Number field named
`Estimate` on the project board, and a ticket is not fully defined until it
carries one.

ShyTalk's board is a mirror of the story files (`scripts/sync-stories-to-issues.sh`),
so the estimate belongs in each story's frontmatter, beside `effort:`, and the
sync carries it to the board. Measured on `origin/develop` `21e1b5c` before
this story:

- 470 story files: 175 Done, 12 Cancelled, 283 open (208 Draft, 66 In Review,
  9 In Progress). None carries a points estimate; `effort:` is a T-shirt size
  (XS 66, S 142, M 165, L 70, XL 13, missing 14).
- **A frontmatter-only edit never reaches the board.** `sync_one` skips a story
  when its body hash and status marker are unchanged
  (`sync-stories-to-issues.sh` "body-hash + status unchanged; skipping"), and
  frontmatter is outside the body hash. Adding `estimate:` to 470 files would
  sync nothing. The items query must read each card's current Estimate so the
  sync can write the number where it differs, without rewriting issue bodies.
- The board has no `Estimate` field. The sync already creates the `Type` field
  when it is missing (`ensure_project_type_field`), so it can create this one
  the same way.

The scoring itself (every open story plus a calibration sample of closed ones)
is SHY-0536, so this story stays reviewable.

## Acceptance Criteria

### Happy path

- [x] `check-story-frontmatter.sh` accepts an optional `estimate:` whose value
      is one of 1, 2, 3, 5, 8, 13, and refuses any other value (0, 4, 21, `M`,
      `5.0`, empty) with exit code `E_INVALID_VALUE`.
- [x] The sync creates a NUMBER field named `Estimate` on the board when it is
      missing, once per run, and reuses it when present.
- [x] Creating a story with `estimate: 5` sets the card's Estimate to 5.
- [x] A story whose body and status are unchanged but whose `estimate:` differs
      from the card's Estimate gets ONE number mutation and no issue update.
- [x] A story whose `estimate:` equals the card's Estimate makes no mutation
      (the unchanged corpus still syncs as all-skip).
- [x] `node scripts/story-progress.js` prints two lines, one by tickets and one
      by effort, each with a % complete, the measured pace and an ETA date,
      over the whole backlog, then a third line with the same tickets figures
      for the `mvp: true` subset.

### Error paths

- [x] A failed field creation or number mutation is reported as a `[gh-error]`
      and counted as a failure (exit 40), like every other field write.
- [x] A story whose `estimate:` is removed while the card still holds a value
      has the card's value cleared (`clearProjectV2ItemFieldValue`), so the
      board never shows a stale estimate.
- [x] `story-progress.js` refuses, by file name, a story whose frontmatter it
      cannot parse, rather than leaving it out of the counts.

### Edge cases

- [x] Epic files (`EPIC-*.md`) and `SHY-INDEX.md` are not counted as stories.
- [x] Cancelled stories are left out of both totals.
- [x] Done stories with no estimate are counted at the mean estimate of the
      scored Done stories, and the effort line says how many were assumed.
- [x] Until any story is scored, the effort line reads
      `By effort: unavailable, <n> of <m> open tickets scored`.
- [x] Pace counts the day a story became Done from git history (the latest
      commit on the current branch whose diff adds `status: Done` to that
      file). With no closures in the last 7 days, the line says so and
      reports the ETA at the 30-day pace, labelled as such; with none in 30
      days either, it says the ETA is unavailable at the measured pace.

### Performance

- [x] The Estimate check adds no extra GraphQL call per story: the card's
      value arrives in the existing items query.
- [x] `story-progress.js` runs in under 5 s on the full corpus (one `git log`
      call, not one per file).

### Security

- [x] No new token or permission: field creation and number writes use the
      sync's existing `GH_PAT_PROJECT`, which already creates `Type`.

### UX

- [x] The progress lines read in plain words, e.g.
      `By tickets: 37% complete (175 of 470 …); pace 1.4/day over 7 days; ETA 2026-11-30`.

### i18n

- [x] Not applicable: operator-facing tooling, English only.

### Observability

- [x] The sync summary counts Estimate writes inside its existing
      `fields updated` total, and logs `Estimate field auto-created` when it
      creates the field.

## BDD Scenarios

**Scenario: An estimate reaches the board without touching the issue**

- **Given** a synced story whose body and status are unchanged
- **And** its card's Estimate is empty
- **When** `estimate: 3` is added and the sync runs
- **Then** the card's Estimate becomes 3 and the issue body is not rewritten

**Scenario: A bad estimate is refused**

- **Given** a story with `estimate: 21`
- **When** the frontmatter check runs
- **Then** it fails, naming the allowed values

**Scenario: Progress is reported twice**

- **Given** scored stories, some Done in the last 7 days
- **When** `node scripts/story-progress.js` runs
- **Then** it prints a tickets line and an effort line, each with an ETA date

## Test Plan

- `express-api/tests/scripts/check-story-frontmatter.test.js`: one test per
  accepted value and one per refused value.
- `express-api/tests/scripts/sync-stories-to-issues-board-fields.test.js`:
  mock-gh cases for field creation, create-path write, estimate-only drift,
  equal value (no mutation), removal (clear), and mutation failure (exit 40).
- `express-api/tests/scripts/story-progress.test.js`: pure-function cases for
  counting, assumed means, pace windows and the unavailable line, plus one
  run against a temporary git repository with dated commits.
- Every new guard is mutation-checked: each listed behaviour is broken once in
  the source and the matching test goes red.

## Out of Scope

- Scoring the stories (SHY-0536).
- Making `estimate:` required on open stories: SHY-0536 turns that on once
  every open story is scored, so CI does not go red on 283 files at once.
- Changing what "release-ready" means. Shyden decided it on 2026-10-07: the
  whole backlog (*"2 but obviously complete 1 first"*), so the headline lines
  count every non-cancelled story and a third line reports the MVP subset,
  which is worked first.

## Dependencies

- None. SHY-0536 depends on this story.

## Risks & Mitigations

- **Mass board write on the first sync after SHY-0536**: around 280 number
  mutations in one run. Mitigated by writing only where the value differs and
  reporting failures by story; a rerun converges.
- **Git history rewritten by squash merges**: the Done date is the squash
  commit on `develop`, which is the date the work landed. Accepted.

## Definition of Done

- [ ] All ACs ticked with the test that proves each.
- [ ] Each new behaviour mutation-checked red, results in Notes.
- [ ] CI green by step name on the PR head; merged to `develop`; dev deploy
      read by job name.
- [ ] After merge, the sync run on `develop` read: the `Estimate` field exists
      on the board (read back by name).
- [ ] `released_in:` set on the next release cut.

## Notes

- **2026-10-07**: Filed as the first of the operator's standing tasks for
  ShyTalk, chosen first by Shyden via AskUserQuestion ("Standing jobs first").
  Shyden also chose "Score now, field later": if the board field cannot be
  created, scores still land in the story files.
- Scored 5 against closed work of the same shape: SHY-0074 and SHY-0082 each
  added a board field path to the sync with mock-gh tests.
- **2026-10-07, AC to proof** (test files under `express-api/tests/scripts/`):
  - Fibonacci scale: `check-story-frontmatter.test.js` › SHY-0535 (accepts
    1, 2, 3, 5, 8, 13 one case each; refuses 0, 4, 21, M, 5.0, -3, 05,
    "13 points", empty and a bare `estimate:` with exit 11).
  - Field created once / reused: `sync-stories-to-issues-board-fields.test.js`
    › "a board without an Estimate field gets a NUMBER field…" and "a board
    that has the Estimate field is not given a second one".
  - Create path sets the number: same file › "create path: estimate: %s sets
    the new card Estimate" (one case per value) and "a story with no estimate
    writes no Estimate".
  - One number write, no issue update: › "an estimate-only change writes ONE
    number and does not rewrite the issue"; "a changed estimate (5 → 8) is
    rewritten".
  - Equal makes no mutation: › "an estimate equal to the card value makes no
    mutation at all" (`project fields updated: 0`).
  - Failed writes are `[gh-error]`, exit 40: › "a failed Estimate write…" and
    "a failed Estimate field creation…".
  - Removed estimate cleared: › "a removed estimate clears the card value".
  - No extra GraphQL call: › "the items query reads each card Estimate in the
    same request".
  - Progress lines, MVP line, effort unavailable, assumed mean, Cancelled,
    epics/index left out, pace from git, 30-day fallback, unavailable ETA,
    unparseable file refused by name: `story-progress.test.js` (parseStory,
    doneDatesFromLog, progress, formatLines, and the end-to-end block on a
    real git repository holding `SHY-INDEX.md` and an `EPIC-` file).
  - One `git log` call: `scripts/story-progress.js` calls `git` twice in all
    (`rev-parse --show-toplevel` and one `log`), never per file.
  - Security: the branch changes no workflow; writes go through the sync's
    existing `GH_PAT_PROJECT`.
  - Observability: the summary counts Estimate writes in `project fields
    updated` and prints `estimate-field auto-created: yes|no`, the same shape
    as the existing `type-field auto-created` entry (the AC's wording
    "Estimate field auto-created" follows that line's house form).
- **Mutations** (`.superpowers/sdd/SHY-0535/mutate.py`, all eight suites per
  mutation, file restored and tree checked clean after each), baseline 495/495:
  - M1 scale accepts 21: RED 3 (the three `21` checks).
  - M2 equal-estimate early return removed: RED 2 (equal makes no mutation;
    no-estimate create path).
  - M3 estimate sync skipped: RED 4 (changed, failed write, removed,
    estimate-only).
  - M4 clear written as update: RED 1 (removed estimate cleared).
  - M5 failed field creation swallowed: RED 1 (failed creation, exit 40).
  - M6 Cancelled kept: RED 3 (the three Cancelled checks: tickets, effort,
    MVP).
  - M7 7-day window shortened to 6: RED 6, wider than predicted (the window
    test, both ETA lines, the scored-effort total and the end-to-end run all
    read the 7-day pace).
  - M8 unscored Done counted at 0: RED 2 (assumed-mean count and its line).
  - M9 oldest commit dates a closure: RED 1 (newest-commit date).
  All nine as predicted in direction; M7 reached further than named.
- **2026-10-07**: full corpus run of `node scripts/story-progress.js`: real
  1.55 s (limit 5 s), prints the three lines (39% by tickets, 175 of 445; by
  effort unavailable, 1 of 270 open scored; MVP 29%, 69 of 234).
