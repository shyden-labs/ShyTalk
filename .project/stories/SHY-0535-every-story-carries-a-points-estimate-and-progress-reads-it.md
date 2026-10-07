---
id: SHY-0535
status: In Progress
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

- [ ] `check-story-frontmatter.sh` accepts an optional `estimate:` whose value
      is one of 1, 2, 3, 5, 8, 13, and refuses any other value (0, 4, 21, `M`,
      `5.0`, empty) with exit code `E_INVALID_VALUE`.
- [ ] The sync creates a NUMBER field named `Estimate` on the board when it is
      missing, once per run, and reuses it when present.
- [ ] Creating a story with `estimate: 5` sets the card's Estimate to 5.
- [ ] A story whose body and status are unchanged but whose `estimate:` differs
      from the card's Estimate gets ONE number mutation and no issue update.
- [ ] A story whose `estimate:` equals the card's Estimate makes no mutation
      (the unchanged corpus still syncs as all-skip).
- [ ] `node scripts/story-progress.js` prints two lines, one by tickets and one
      by effort, each with a % complete, the measured pace and an ETA date,
      over the whole backlog, then a third line with the same tickets figures
      for the `mvp: true` subset.

### Error paths

- [ ] A failed field creation or number mutation is reported as a `[gh-error]`
      and counted as a failure (exit 40), like every other field write.
- [ ] A story whose `estimate:` is removed while the card still holds a value
      has the card's value cleared (`clearProjectV2ItemFieldValue`), so the
      board never shows a stale estimate.
- [ ] `story-progress.js` refuses, by file name, a story whose frontmatter it
      cannot parse, rather than leaving it out of the counts.

### Edge cases

- [ ] Epic files (`EPIC-*.md`) and `SHY-INDEX.md` are not counted as stories.
- [ ] Cancelled stories are left out of both totals.
- [ ] Done stories with no estimate are counted at the mean estimate of the
      scored Done stories, and the effort line says how many were assumed.
- [ ] Until any story is scored, the effort line reads
      `By effort: unavailable, <n> of <m> open tickets scored`.
- [ ] Pace counts the day a story became Done from git history (the latest
      commit on the current branch whose diff adds `status: Done` to that
      file). With no closures in the last 7 days, the line says so and
      reports the ETA at the 30-day pace, labelled as such; with none in 30
      days either, it says the ETA is unavailable at the measured pace.

### Performance

- [ ] The Estimate check adds no extra GraphQL call per story: the card's
      value arrives in the existing items query.
- [ ] `story-progress.js` runs in under 5 s on the full corpus (one `git log`
      call, not one per file).

### Security

- [ ] No new token or permission: field creation and number writes use the
      sync's existing `GH_PAT_PROJECT`, which already creates `Type`.

### UX

- [ ] The progress lines read in plain words, e.g.
      `By tickets: 37% complete (175 of 470 …); pace 1.4/day over 7 days; ETA 2026-11-30`.

### i18n

- [ ] Not applicable: operator-facing tooling, English only.

### Observability

- [ ] The sync summary counts Estimate writes inside its existing
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
