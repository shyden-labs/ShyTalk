---
id: SHY-0537
status: Draft
owner: claude
created: 2026-10-07
priority: P2
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0537: Every open non-MVP story is scored, so effort progress covers the whole backlog

## User Story

As **Shyden, the operator**, I want the open stories outside the MVP to carry
story-point estimates too, so that the "by effort" progress line covers the
whole backlog that release-ready is measured against.

## Why

**Operator decision (2026-10-07, AskUserQuestion):** release-ready means the
WHOLE backlog, MVP first (*"2 but obviously complete 1 first"*). SHY-0536
scores the 165 open MVP stories; until the remaining open stories are scored,
`story-progress.js` keeps the effort line at `unavailable`, because a partial
sum would understate what is left.

Measured at `aabe8e7`, 2026-10-07: 105 open stories are not `mvp: true`
(83 Draft, 2 In Progress, 20 In Review), of which 23 have no `mvp:` field at
all (18 Draft, 5 In Review).

## Acceptance Criteria

### Happy path

- [ ] Every open story without `mvp: true` carries `estimate:` from 1, 2, 3,
      5, 8, 13, scored from its ACs against the calibrated sample SHY-0536
      recorded, never from guessed hours.
- [ ] After the merge, `node scripts/story-progress.js` prints a real effort
      line (% complete, pace in points, ETA date), quoted in Notes with the
      measured and assumed figures named.
- [ ] A spread of at least 10 scored stories is re-read in full after the
      first pass and the number corrected is recorded.

### Error paths

- [ ] A story too thin to score is listed in Notes and a follow-up is filed to
      define it; it is not given a number.
- [ ] A story larger than 13 is recorded as an epic to split, with the split
      filed.

### Edge cases

- [ ] Each of the 23 stories with no `mvp:` field gets an explicit `mvp:`
      value. Where the right value is not plain from the story, the question
      goes to Shyden with AskUserQuestion, one decision per question.

### Performance

- [ ] Frontmatter-only edits, so the sync takes the SHY-0535 skip path.

### Security

- [ ] Not applicable.

### UX

- [ ] The PR body states stories scored, points total and corrections made.

### i18n

- [ ] Not applicable.

### Observability

- [ ] One board read after the sync shows every open card with an `Estimate`;
      the count of open cards without one is 0.

## BDD Scenarios

**Scenario: the whole backlog is scored**

- **Given** SHY-0536 and this story are merged
- **When** story-progress.js runs
- **Then** the by-effort line shows a % complete and an ETA date
- **And** it no longer says unavailable

## Test Plan

- `scripts/check-story-frontmatter.sh --scan` in CI.
- A one-off count recorded in Notes: open stories without `estimate:` is 0.

## Out of Scope

- Re-scoring the MVP stories (SHY-0536).

## Dependencies

- SHY-0536 (the calibrated scale this story scores against).

## Risks & Mitigations

- **The non-MVP backlog holds older, thinner stories.** Mitigation: thin ones
  are refused a number and filed for definition, never scored on a guess.

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] CI green by step name on the PR head SHA; merged into `develop`; the
      board read shows no open card without an estimate.

## Notes

- **2026-10-07**: Filed with SHY-0536 from the standing backfill task.
- Scored 5 against SHY-0536 (8): about two thirds of its stories, with the
  calibration already done. A judgement until SHY-0536's duration is known.
