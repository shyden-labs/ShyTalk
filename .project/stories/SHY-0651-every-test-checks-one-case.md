---
id: SHY-0651
status: Draft
owner: claude
created: 2026-10-20
priority: P2
effort: L
estimate: 8
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0651: Every test checks one case, so a failure names the case

## User Story

As the operator, I want each case a test checks to be its own test, so
that a red run names exactly which case broke and one broken case cannot
hide the others behind it.

## Why

The standing rule (2026-10-02, every project) is one test per case: a
population (exception types, locales, roles, field groups) is generated as
one test each, never looped inside a single test. Only a population that
exists only at runtime may be looped, with a comment saying so. Each
project gets a meta-guard with a burn-down list; ShyTalk has neither the
guard nor a ticket for it.

Measured on develop 278b6434e43 (2026-10-20), files whose test code holds
a loop (an upper bound: some loops are setup or runtime populations):

- Kotlin: 77 of 263 test files (`for (` or `.forEach {`). Example:
  `shared/.../core/util/FirebaseCallTest.kt`, last test, loops three
  exception types in one test.
- Jest: 220 of 579 test files (`for (const` or `.forEach(`); 97 files
  already use `test.each`/`it.each`, the idiom to convert to.
- Swift: 2 of 8 test files.

## Acceptance Criteria

### Happy path

- [ ] A meta-guard in the `guards` suite finds every test (Kotlin `@Test`
      functions, Jest `test`/`it` bodies, XCTest `func test...`) whose body
      loops over a population and asserts inside the loop.
- [ ] Every hit found today is in a burn-down list in one recorded file;
      the guard is red on any hit not in the list and on any listed entry
      that no longer exists (the list only shrinks).
- [ ] A loop over a population that exists only at runtime is allowed when
      a comment on the loop says so; the guard reads that comment.

### Error paths

- [ ] A test file the guard cannot parse fails the guard, naming the file
      (fail closed).

### Edge cases

- [ ] Planted in every form the code writes it (`for (x in xs)`,
      `xs.forEach {}`, `for (const x of xs)`, `xs.forEach(x =>`,
      `for x in xs` in Swift), each plant goes red, then is removed.
- [ ] A loop that only builds data (no assertion inside) is not a hit.

### Performance

- [ ] The guard runs in the `guards` suite under one measured limit at its
      CI step.

### Security

- [x] Not applicable: test tooling.

### UX

- [x] Not applicable: operator tooling only.

### i18n

- [x] Not applicable: no user-facing text.

### Observability

- [ ] The guard's verdict prints the files read and hits found, against a
      recorded floor for each (equality, ratcheted by the recorder only).

## Announce

Nothing: test tooling with no learner-facing change.

## BDD Scenarios

**Scenario: a new looped test is refused**

- **Given** the burn-down list recorded today
- **When** a PR adds a test that loops three cases and asserts in the loop
- **Then** the guard is red naming that test, and the PR's fix is one test
  per case (`test.each`, or one Kotlin test per case)

## Test Plan

- Guard tests with planted fixtures for each loop form, red then green.
- Floor and burn-down list checked for equality in their own tests.
- Mutation: drop each detector form; its plant must survive red.

## Out of Scope

- Converting the listed tests: one story per area, filed from the list
  once the guard lands, scored from its counts.

## Dependencies

- None. Lands in the `guards` suite (whole-repo guards are not unit tests).

## Risks & Mitigations

- False hits on data-building loops: the assertion-inside-the-loop rule,
  with plants for both shapes.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-20**: Filed while writing SHY-0648's logging test, on seeing
  `FirebaseCallTest`'s looped last test. P2: test quality, no learner or
  data risk. Not MVP (tooling). Scored 8, measured against SHY-0642 (a
  whole-repo guard's file count) and the counts above: three languages'
  detectors, plants per form, a burn-down list of up to ~300 files.
  Searches ("one test per case", "loop inside a test", "test.each",
  "population looped", "meta-guard") found no existing ticket.
