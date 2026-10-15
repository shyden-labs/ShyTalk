---
id: SHY-0594
status: Draft
owner: unassigned
created: 2026-10-15
priority: P2
effort: S
estimate: 2
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0594: The effort line reports points remaining, never a percentage

## User Story

As **Shyden, the operator**, I want ShyTalk's effort progress line to state the
story points remaining on open stories, so that the figure I am given at every
close-out is fully measured and follows the rule I set on 2026-10-12.

## Why

Found 2026-10-15 while closing out SHY-0536 and SHY-0537.

- Shyden's global rule (2026-10-12): the effort estimate is **points REMAINING
  on open tickets, never a %**.
- `node scripts/story-progress.js` on `origin/develop` 0cdfac0ecb1 prints
  `By effort: 32% complete (684 of 2145 points Done; 175 Done stories unscored,
  counted at the scored mean of 3.8 points (assumed))`.
- The percentage needs a total, and the total carries an assumption: 175 Done
  stories have no estimate, so they are counted at the mean. The open side has
  none: every open story is scored. A board read the same day found 324 open
  cards, 0 without an `Estimate`, and a board sum of 1461 equal to the story
  files' sum of 1461.
- `scripts/story-progress.js:191` builds the line; 3 assertions in
  `express-api/tests/scripts/story-progress.test.js` pin its text.
- SHY-0535's AC (line 71) still asks for "% complete" on both lines. It was
  written before the rule; this story supersedes that part of it.

## Acceptance Criteria

### Happy path

- [ ] The effort line reads `By effort: <n> points remaining on <m> open
      stories`, followed by the measured pace in points and the ETA date.
- [ ] `<n>` is the sum of `estimate:` over open in-scope stories, and nothing
      else: no Done story and no assumed mean enters it.
- [ ] The tickets line and the MVP line are unchanged.

### Error paths

- [ ] While any open in-scope story is unscored, the line keeps reading
      `By effort: unavailable, <scored> of <open> open tickets scored`.

### Edge cases

- [ ] With no open stories the line says `0 points remaining` and gives no ETA.
- [ ] The pace still counts points closed per day; a Done story with no
      estimate adds nothing to the pace and the line says how many such stories
      the window held.

### Performance

- [ ] N/A: the script's run time is unchanged (one pass over the story files).

### Security

- [ ] N/A: reads local files only.

### UX

- [ ] No `%` appears anywhere on the effort line; a test asserts this.

### i18n

- [ ] N/A: operator-facing English.

### Observability

- [ ] N/A.

## BDD Scenarios

**Scenario: the close-out gives effort as points remaining**

- **Given** every open story carries an estimate
- **When** `node scripts/story-progress.js` runs
- **Then** the effort line names the points remaining and the open story count,
  with pace and ETA, and contains no percentage

## Test Plan

1. RED first: change the three effort-line assertions to the new wording and
   add a no-`%` assertion; watch them fail against the current script.
2. Fixture with Done stories that have no estimate: the remaining figure is
   unchanged by them.
3. Mutation: add a Done story's points to the remaining sum; a test goes red.

## Out of Scope

- `repo-template`'s `scripts/board-progress.ts`, which prints the same
  percentage: that repo's own ticket.
- Editing SHY-0535's text (In Review); this story records the supersession.

## Dependencies

- None blocking.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A hook or note quotes the old wording | grep for `By effort:` across the repo and the global hooks before merging; update every quote found. |

## Definition of Done

- [ ] The script's real output quoted in Notes after merge.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed while closing out SHY-0536/0537. Measured on
  `origin/develop` 0cdfac0ecb1: 1461 points remaining on 324 open stories,
  board and files equal.
