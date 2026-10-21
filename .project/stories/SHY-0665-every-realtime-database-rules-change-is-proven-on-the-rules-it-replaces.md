---
id: SHY-0665
status: Draft
owner: claude
created: 2026-10-21
priority: P1
effort: L
estimate: 8
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0665: Every Realtime Database rules change is proven on the rules it replaces

## User Story

As the operator, I want every change to `database.rules.json` shown by a
test that fails on the rules before the change, so that a Realtime
Database rules fix closes the gap it names and no rules change merges
unproven, the same as `firestore.rules` since SHY-0657.

## Why

Found 2026-10-21 while building SHY-0657 (its no-holes check): Shyden ruled
that every `firestore.rules` change must be proven by a test red on the base
rules ("Every change proven"). `database.rules.json` has no such check. Its
tests in `express-api/tests/rtdb-rules/` read the JSON (owner-left-rules
reads it with `readFileSync`), and none runs the rules in the RTDB emulator,
so a Realtime Database rules change can merge with nothing shown red first.

## Acceptance Criteria

### Happy path

- [ ] Realtime Database rules tests run the rules in the RTDB emulator
      through one loader with an override path, as SHY-0657 does for
      Firestore; each is titled `DENY: ` or `ALLOW: ` by what it asserts.
- [ ] On a PR changing `database.rules.json`, a required CI step runs every
      added or rewritten RTDB rules test against the base rules; each DENY
      test must fail there for the refusal reason, and at least one added or
      rewritten test must fail there (DENY for tightening, ALLOW refused for
      loosening).

### Error paths

- [ ] A `database.rules.json` change with no test failing on the base rules
      fails the step, naming the change.
- [ ] A failure to load or parse the base rules fails the step.

### Edge cases

- [ ] A change to `database.rules.json` that only reorders keys or spacing is
      not a rules change (compared as parsed JSON).

### Performance

- [ ] The step runs only when `database.rules.json` or an RTDB rules test
      changed; its measured time is its CI limit.

### Security

- [ ] Required through PR Gate, like SHY-0657's step; the live
      `database.rules.json` and its deploy are untouched.

### UX

- [x] Not applicable: CI only.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] The step's summary lists each test it ran, the base SHA and the result.

## Announce

None: an internal check with no change users can see.

## BDD Scenarios

**Scenario: an RTDB rules change with its proof**

- **Given** a PR tightens a `database.rules.json` rule and adds a DENY test
- **When** CI runs that test against the base rules
- **Then** it fails there, and the step passes

## Test Plan

- Reuse SHY-0657's planner and verdict (`express-api/scripts/rules-red-first.js`)
  where the shape allows; planted PRs as in SHY-0657 Task 6.

## Out of Scope

- `firestore.rules` (SHY-0657).

## Dependencies

- SHY-0657 merged (its planner, loader pattern and guards).

## Risks & Mitigations

- The RTDB emulator is already started in test-backend (start-firebase-emulators);
  measure its cost before adding suites.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the step required through PR Gate.

## Notes

- **2026-10-21**: filed from SHY-0657's no-holes check (the global rule of
  2026-10-21). P1: a proof gap, not a live defect; level with SHY-0657's
  other follow-ups. Scored 8: SHY-0657 was 8 for Firestore with its tests
  already in the emulator; RTDB needs its emulator tests built first.
