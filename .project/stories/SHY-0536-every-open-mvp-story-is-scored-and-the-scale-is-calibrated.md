---
id: SHY-0536
status: Done
owner: claude
created: 2026-10-07
priority: P1
effort: L
estimate: 8
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0536: Every open MVP story is scored, and the scale is calibrated against merged work

## User Story

As **Shyden, the operator**, I want every open `mvp: true` story to carry a
story-point estimate checked against work that has already merged, so that the
"by effort" progress line gives a release-ready ETA for the stories being
worked first.

## Why

**Operator standing rule (2026-10-04, global):** *"If effort remaining isn't
available then review tickets to add an estimate on effort for better eta
reliability"*. The backfill is the first task for any project whose board has
no estimates: score every open ticket AND a calibration sample of recently
closed tickets, because a pace in points needs closed points to measure.

SHY-0535 gives the mechanism (`estimate:` in frontmatter, the board's
`Estimate` field, `scripts/story-progress.js`). Until the backfill is done the
effort line reads `By effort: unavailable, 1 of 270 open tickets scored`.

**Operator decision (2026-10-07, AskUserQuestion):** release-ready counts the
whole backlog, but *"2 but obviously complete 1 first"*: MVP stories are
worked first. So the backfill is split the same way: this story scores the
165 open MVP stories, and SHY-0537 scores the other 105.

Measured on the working tree at `aabe8e7`, 2026-10-07 (one `grep` of
`status:` and `mvp:` per story file):

| | Draft | In Progress | In Review | open total |
| --- | --- | --- | --- | --- |
| `mvp: true` | 119 | 0 | 46 | **165** |
| `mvp: false` or unset | 83 | 2 | 20 | 105 |

ShyTalk sets `Done` only at a release cut, and the last one was 2026-08-27,
so no story has been closed in the last 14 days. The calibration sample is
therefore taken from stories whose code **merged** into `develop`, and this
substitution is stated wherever the sample is quoted. Measured 2026-10-07:
226 non-Dependabot PRs merged into `develop` since 2026-07-01 (43 in July,
156 in August, 27 in September), naming 187 stories; the four merged in the
last 30 days only filed stories (0 hand-written lines), so the 20 most recent
stories with code reach back to about mid-August.

## Acceptance Criteria

### Happy path

- [x] Every open (`Draft`, `In Progress`, `In Review`) story with
      `mvp: true` carries `estimate:` from 1, 2, 3, 5, 8, 13, and the
      frontmatter check passes on the whole corpus.
- [x] Each score is set from the story's acceptance criteria compared with
      merged stories of the same shape, never from guessed hours. A story
      larger than 13 is not given a number: it is recorded in Notes as an
      epic to split, with a follow-up story filed for the split.
- [x] A calibration sample of the 20 or more most recent stories with code
      merged into `develop` is scored too, and their points are compared with
      measured size: hand-written lines changed, summed over every PR naming
      the story, leaving out lock files, generated files, snapshots,
      `.project/**` and Markdown. The Spearman rank correlation is recorded in
      Notes with the sample list.
- [x] Each PR's file list is read through `gh api …/pulls/<n>/files
      --paginate`, never `gh pr list --json files`, which stops at 100 files
      per PR (measured 2026-10-07: #2131 reads exactly 100).
- [x] Any sample story whose score disagrees with its measured size by more
      than one Fibonacci step is re-read and either re-scored or kept with a
      one-line reason in Notes.
- [x] A spread of at least 15 open MVP stories (five each scored 1-2, 3-5 and
      8-13) is re-read in full after the first pass, and every wrong score is
      corrected; the number corrected is recorded.
- [x] `node scripts/story-progress.js` is run after the merge and its three
      lines are quoted in Notes; the MVP line still reports by tickets, and
      the effort line still reads `unavailable` until SHY-0537 lands, with the
      scored count moved from 1 to at least 166.

### Error paths

- [x] A story whose ACs are too thin to score (no AC list, or ACs that only
      say "TBD") is not given a number; it is listed in Notes and a follow-up
      is filed to define it, because a ticket is not fully defined until it
      carries an estimate.

### Edge cases

- [x] A story already carrying `estimate:` (SHY-0535) keeps its value unless
      the re-read finds it wrong, and any change is recorded.
- [x] Stories with `mvp:` missing are left to SHY-0537 and are not scored
      here; their count (18 Draft, 5 In Review at `aabe8e7`) is re-measured
      at the start.

### Performance

- [x] The change is frontmatter-only: one line added per story, no body
      edits, so the sync updates the `Estimate` field and skips the issue
      body for every scored story (the SHY-0535 skip path).

### Security

- [x] Not applicable: frontmatter edits only, no code or permission change.

### UX

- [x] The PR body gives the totals in plain words: stories scored, points
      total, the calibration correlation and the number of scores corrected.

### i18n

- [x] Not applicable: operator-facing metadata, English only.

### Observability

- [x] After the merge and the board sync, one GraphQL read of the board
      shows an `Estimate` value on every scored card, and the sum matches the
      sum from the story files.

## BDD Scenarios

**Scenario: every open MVP story is scored**

- **Given** the story corpus after this change
- **When** check-story-frontmatter.sh scans every story
- **Then** it passes
- **And** every open story with mvp: true has an estimate on the Fibonacci scale

**Scenario: the scale is checked against merged work**

- **Given** 20 or more stories merged in the last 30 days with their points
- **When** their points are ranked against hand-written lines changed per PR
- **Then** the Spearman correlation is recorded in Notes
- **And** every disagreement of more than one Fibonacci step is re-read

**Scenario: the board shows what the files say**

- **Given** the sync has run after the merge
- **When** the board's Estimate values are read
- **Then** their sum equals the sum of estimate: in the scored story files

## Test Plan

- The frontmatter check (`scripts/check-story-frontmatter.sh --scan`) is the
  automated gate; it already refuses an off-scale value (SHY-0535).
- A one-off count, recorded in Notes: open MVP stories without `estimate:`
  must be 0.
- The calibration script and its output are committed under
  `.project/estimates/` so the correlation can be re-run.

## Out of Scope

- Scoring non-MVP open stories (SHY-0537).
- Scoring Done stories older than the sample: `story-progress.js` counts them
  at the sample mean, labelled as assumed.

## Dependencies

- SHY-0535 merged and deployed, so the board has the `Estimate` field.

## Risks & Mitigations

- **One quick pass makes the effort ETA look more precise than it is.**
  Mitigation: the calibration and the 15-story re-read above, and the first
  effort ETA is labelled a starting point until two weeks of stories close
  with their points recorded.
- **165 one-line edits in one PR are hard to review.** Mitigation: the PR adds
  a table (story, score, the merged story it was compared with) under
  `.project/estimates/`.

## Definition of Done

- [x] Every AC checkbox above is met.
- [x] The frontmatter scan passes on the whole corpus in CI.
- [x] The calibration table and correlation are committed and quoted in Notes.
- [x] CI green by step name on the PR head SHA; merged into `develop`; the
      board read shows the scored values.

## Notes

- **2026-10-07**: Filed from the standing backfill task (operator rule
  2026-10-04). Split from the non-MVP half (SHY-0537) by the operator's
  MVP-first decision.
- Scored 8 as a judgement, not against closed work: ShyTalk has no merged
  story of this shape. 165 stories read and compared at roughly the pace of
  SHY-0535's own research pass. Re-score from this story's actual duration
  when it closes.
- **2026-10-12** (scored): every open `mvp: true` story now carries `estimate:`:
  164 scored in this pass, plus the eight SHY-0062 batch stories filed here
  (SHY-0575 to SHY-0582, 40 points), 778 points in all. SHY-0062 itself could
  not be scored (94 roadmap entries, far over 13); Shyden chose "Split into 8"
  (AskUserQuestion, 23:01Z) and it is Cancelled, replaced by the batches.
  Method, table and calibration: `.project/estimates/`.
  - Calibration: 25 most recent stories with merged code, **Spearman 0.765**.
    Optimistic: 19 of the 25 scores were set after their line counts were seen.
    Three >1-step disagreements re-read and kept: SHY-0289, SHY-0448, SHY-0470
    (deletions and a formatter rewrite).
  - All 43 sample PRs were read through `gh api …/files --paginate`; 42 match
    `git show --numstat`; #2086 differs because it was stacked on SHY-0494's
    branch, and the squash commit (90 lines) is used.
  - Spread re-read of 15 (five per band): **4 corrected, all up one step**
    (SHY-0047 1→2, SHY-0391 3→5, SHY-0009 3→5, SHY-0336 5→8). The remaining
    total is a floor, not a point estimate.
  - No story was too thin to score. SHY-0523's criteria are plain bullets
    rather than checkboxes; it was scored normally.
  - Stories with `mvp:` missing: 37 at this tree, left to SHY-0537.
  - Checks: `check-story-frontmatter.sh --scan .project/stories` exit 0; every
    one of the 164 files changed by exactly one `+estimate:` line; open MVP
    stories without an estimate: 0. Board read and `story-progress.js` follow
    the merge.
- **2026-10-15 (Done)**: merged as #2314; on its head `PR Gate`,
  `Validate SHY story frontmatter` and `Story status must be In Review before
  merge` all success. SHY-0537 has since landed, so the effort line is no
  longer `unavailable`; `node scripts/story-progress.js` on `origin/develop`
  0cdfac0ecb1:
  ```
  By tickets: 36% complete (180 of 504 stories Done; 13 cancelled left out). Measured pace 0.71 a day over the last 7 days (0, 0, 0, 1, 4, 0, 0). ETA at that pace: 2028-01-12, before outside waits.
  By effort: 32% complete (684 of 2145 points Done; 175 Done stories unscored, counted at the scored mean of 3.8 points (assumed)). Measured pace 2.71 points a day over the last 7 days (0, 0, 0, 8, 11, 0, 0). ETA at that pace: 2028-04-06, before outside waits.
  MVP subset (worked first): 27% complete (69 of 254 stories Done). Measured pace 0.00 a day over the last 7 days (0, 0, 0, 0, 0, 0, 0). ETA unavailable at the measured pace: nothing closed in the last 30 days.
  ```
  Board read after the sync: one GraphQL read of ShyTalk Stories (title asserted): 521 items, 324 open cards, every one a SHY story, 0 without an `Estimate`; board sum 1461 equals the story files' sum of 1461, 0 per-story mismatches. The one card that had no estimate, #1653, was a placeholder retired the same day (Shyden's ruling). The effort line still gives a
  percentage, against Shyden's 2026-10-12 rule (points remaining, never a %):
  SHY-0594.
