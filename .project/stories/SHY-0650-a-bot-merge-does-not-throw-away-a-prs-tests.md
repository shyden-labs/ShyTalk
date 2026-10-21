---
id: SHY-0650
status: Draft
owner: claude
created: 2026-10-19
priority: P2
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0650: A bot's merge does not throw away a PR's tests

## User Story

As the operator, I want a pull request whose checks have passed to merge
without starting over because a bot merged something unrelated meanwhile,
so that urgent fixes reach dev in one CI run, not three.

## Why

Measured on 2026-10-19 on #2461 (SHY-0648, a P0 security fix). `develop`
requires a PR's head to contain develop's latest commit before it merges,
so the tested tree is the landed tree. Dependabot's auto-merge landed on
`develop` twice while #2461's checks ran: #2462 and #2466 (Playwright and
Mailpit bumps, plus a board sync) during run 39206323568, then #2467
(LiveKit) during run 39213526092. Each time the green run could not be
used, develop was merged in, and the full PR Checks ran again (about 25
minutes each, every job). Neither bump touched a file the PR changed.

Same family as the note that a docs merge strands an in-flight strict run:
any merge into `develop` does it, and a bot merges without looking.

## Acceptance Criteria

### Happy path

- [ ] First, the choice is Shyden's, asked with costs: a GitHub merge
      queue on `develop` (each PR tested in landing order, no re-run by
      hand), or bot merges held to set windows, or bot merges waiting while
      any PR's checks are running. The choice is recorded here.
- [ ] A PR whose checks pass on a head that contains develop merges without
      a second full run caused by a bot merge, shown on a real PR.

### Error paths

- [ ] A bot merge that really conflicts with a PR still stops that PR
      (no tree lands untested).

### Edge cases

- [ ] Dependabot security updates still land the same day.

### Performance

- [ ] Measured before and after: how many full PR Checks runs a PR needs
      to merge across one week of Dependabot activity.

### Security

- [ ] The landed tree is still the tested tree (strict checks kept, or the
      merge queue's equivalent).

### UX

- [x] Not applicable: operator tooling only.

### i18n

- [x] Not applicable: no user-facing text.

### Observability

- [ ] A stranded run (develop moved under a green PR) is visible in the PR,
      naming the commit that moved it.

## Announce

Nothing: operator tooling with no learner-facing change.

## BDD Scenarios

**Scenario: a bot merge does not restart a green PR**

- **Given** a PR's checks are running on a head that contains develop
- **When** Dependabot's auto-merge wants to land an unrelated bump
- **Then** the PR merges on that run, and the bump lands without making
  the PR run again

## Test Plan

- Workflow contract tests for whatever is chosen (the auto-merge workflow's
  condition, or the merge-queue settings read back).
- One week's count of PR Checks runs per merged PR, before and after.

## Out of Scope

- The tests' own run time (SHY-0563 and the 1 s work).

## Dependencies

- None.

## Risks & Mitigations

- Holding bot merges delays a security bump: security updates are exempt.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-19**: Filed after #2461 needed three full runs. P2: CI time,
  no learner or data risk. Not MVP (tooling). Scored 5: one decision, a
  workflow or settings change, contract tests, a week's measurement.
  Searches for an existing ticket ("Dependabot strands", "strict run
  stranded", "Dependabot auto-merge", "auto-merge develop moves",
  "merge queue") found none.
