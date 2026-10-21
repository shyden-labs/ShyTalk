---
id: SHY-0657
status: Draft
owner: claude
created: 2026-10-20
priority: P0
effort: L
estimate: 13
type: chore
roadmap_ids: []
mvp: true
epic: EPIC-0001
---

# SHY-0657: Every new refusing rules test is shown failing on the rules it replaces, in CI

## User Story

As the operator, I want CI to show that each new rules test which expects a
refusal would have failed on the rules before the change, so that a rules
fix is proven to close the gap it names and no test passes by accident.

## Why

Shyden, 2026-10-20, from written options ("Build a lasting CI check").
SHY-0653's Security AC asks that each rules test be seen RED against the
old rules first. Five of its nine refusing cases were, as passing TODAY
cases that were then flipped; four added with the fix
(`conversations-rules.test.js:900, :909, :939, :948`) never ran on the old
rules. Proving them by putting the old `firestore.rules` back in a branch
tripped the push hook (`banned-claim-rules-static.unit.test.js` fails on
the old rules) and is the wrong shape: weaker live rules should never sit
in a branch meant for pushing.

## Acceptance Criteria

### Happy path

- [ ] On a PR that changes `firestore.rules`, a required CI step loads the
      base branch's `firestore.rules` into the rules emulator, as test input
      only, and runs every rules test the PR adds whose name starts `DENY`;
      each must fail there. The step prints every such test with its result.
- [ ] The rules tests read their rules file from one place that accepts an
      override path, so the live `firestore.rules` is never swapped out.
- [ ] Every rules test is named by what it asserts: a test reaching
      `assertFails` is titled `DENY: …`, any other reaching `assertSucceeds`
      is titled `ALLOW: …`, and a rules test reaching neither fails a guard
      (Shyden, 2026-10-21: "consistency is important"). Only then does the
      `DENY: ` prefix find every refusal.

### Error paths

- [ ] A new DENY test that passes on the base rules fails the step, naming
      the test (it tests nothing the change made).
- [ ] A PR changing `firestore.rules` with no added or rewritten test that
      fails on the base rules fails the step, the change named unproven
      (Shyden, 2026-10-21: "should go red, yes"; then "Every change proven":
      a DENY test failing for assertFails' reason proves a tightening, an
      ALLOW test refused there proves a loosening, an ALLOW test passing
      there is a control that proves nothing; an edit to the rules' comments
      or spacing alone is no change).
- [ ] A failure to load or parse the base rules fails the step (fails
      closed).

### Edge cases

- [ ] SHY-0653's four cases are proven once, from a copy of the pre-fix
      rules (`1ca1299476d`) kept as a test fixture, and the run is recorded
      in SHY-0653's Security AC.
- [ ] A PR that renames a DENY test is not counted as adding one.
- [ ] A DENY test kept by name whose code changed is run against the base
      rules too and must fail there (Shyden, 2026-10-21: "they should");
      a change to its comments or whitespace alone is not a rewrite.
      No way out (Shyden, 2026-10-21): a rewritten DENY test that passes on
      the base rules fails the step, whose text says to move a tidy to its
      own PR.
- [ ] ALLOW tests are not run against the base rules by this step.

### Performance

- [ ] The step runs only the added tests, and only when `firestore.rules`
      or a rules test changed; its measured time is its CI limit.

### Security

- [ ] The step is required through PR Gate, which develop's ruleset
      requires (Shyden, 2026-10-21): PR Gate fails when the step fails, and
      also when `firestore.rules` changed but `test-backend` did not succeed;
      the live `firestore.rules` and its deploy are untouched.

### UX

- [x] Not applicable: CI only.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] The step's summary lists each added DENY test, the base SHA it ran
      against and its result.

## Announce

None: an internal check with no change users can see.

## BDD Scenarios

**Scenario: a new refusing test that the old rules fail**

- **Given** a PR adds "DENY: a muted member posts" and the rule it needs
- **When** CI runs the test against the base branch's rules
- **Then** the test fails there, and the step passes

**Scenario: a new refusing test that tests nothing**

- **Given** a PR adds a DENY test the base rules already refuse
- **When** CI runs it against the base rules
- **Then** the step fails, naming the test

## Test Plan

- Planted cases, each seen to turn the step red: a DENY test that passes
  on the base rules; an unparsable base rules file; a renamed DENY test
  counted as new.
- The guard rules apply: population inside the verdict, a recorded floor,
  fail-closed parsing.

## Out of Scope

- Red-first for non-rules tests.
- Moving mutes to a server route (SHY-0629).

## Dependencies

- None. SHY-0653's Security AC waits on this story.

## Risks & Mitigations

- Test names change between base and head: added tests are found by name
  in the head that is absent from the base, with renames printed for review.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the step required on `develop`; SHY-0653's Security AC
      ticked from its run.

## Notes

- **2026-10-20**: Shyden chose this over a one-off throwaway PR and over
  running the proof by hand. P0: it blocks SHY-0653 (P0), so it takes
  that level. MVP: the group-roles hotfix waits on it. Scored 5: a new CI
  step with name-diffing, an override path in the rules test setup, a
  fixture, planted cases and a required-check change; level with SHY-0653
  and SHY-0656, above SHY-0652's 3.
- **2026-10-21**: a side note measured that only 3 of the 10 rules test
  files named refusals `DENY`; Shyden ruled "consistency is important", so
  every rules test is renamed to `DENY: ` / `ALLOW: ` by what it asserts
  (109 of 231 renamed, bodies byte-identical) and a guard keeps it. Shyden
  also ruled the step is required through PR Gate, not its own ruleset
  context. Re-scored 5 to 8 for the rename and the naming guard. The loader
  population is 8 files (two migration-script tests also load the rules).
- **2026-10-21**: Shyden "Every change proven" (written options, after a side
  note found a rules change with no DENY test passed with a notice). Then the
  global no-holes rule found more on this branch: string whitespace in test
  code (now tokens), other ways to take the rules library (a form guard over
  15 files), computed module mocks and the jest setup (pinned; 588 files
  read), and RTDB rules with no red-first proof (filed SHY-0665). Re-scored
  8 to 13 for the ALLOW proof path, the rules tokenizer and the guards.
- **2026-10-21**: a side note found the step planned only ADDED DENY tests,
  a call made alone and noted only in the design file. Shyden: rewritten
  DENY tests "should" meet the base rules too. Code is compared with
  comments stripped and whitespace collapsed (my call, stated to him).
