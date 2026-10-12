---
id: SHY-0556
status: Draft
owner: claude
created: 2026-10-12
priority: P0
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0556: Absence guards check a floor kept in one recorded file

## User Story

As the operator trusting a green guard, I want every "nothing found" verdict
to prove how much it read against a recorded figure, so that a guard that
silently reads less, or nothing, turns red instead of passing.

## Why

Measured 2026-10-12 while building SHY-0544: ShyTalk has no floors record,
no recorder and no `searched()`/`floorBreach()` helpers (a search of
`express-api/tests`, `scripts` and `tests` finds none). The operator's
standing rule (2026-10-02, "every guard proves it saw what it judges") needs
each absence search to carry its population in the verdict and check a floor
recorded in ONE file, for equality, raised only by a recorder that never runs
in CI. SHY-0544's new guard (`no-minio-image.test.js`) had to keep its floor
(459 files) as a literal in the test, so every file added under the scanned
roots means a hand edit.

## Acceptance Criteria

### Happy path

- [ ] One floors file holds every guard's floor, keyed by id; a helper
      checks each guard's population against its key for equality, with the
      check after the verdict in the same test.
- [ ] A recorder re-measures every key, raises only (a drop is refused and
      named), repeats until stable (pass limit 3), prints each delta, and
      refuses to run in CI.
- [ ] `no-minio-image.test.js` moves its floor from a literal to the record.

### Error paths

- [ ] An unknown key, a key asserted from two places, or a key with no
      assertion fails a meta-test naming it.

### Edge cases

- [ ] A population of one takes two mutants (loss and growth), both red.
- [ ] No test writes the floors file; the recorder's own tests run in a
      scratch copy.

### Performance

- [ ] The helper adds no measurable time to a unit test.

### Security

- [ ] Not applicable.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] A floor failure prints the id, the recorded figure and the measured
      one.

## BDD Scenarios

**Scenario: A guard reads fewer files than recorded**

- **Given** a guard whose recorded floor is 459
- **When** a refactor makes it read 300 files
- **Then** the guard fails naming its id, 459 and 300

## Test Plan

- Unit tests of the helper and recorder against fixtures; mutations of each
  control shown red.

## Out of Scope

- Auditing and converting every other ShyTalk guard: a separate story per
  batch, scored from a count of the guards first.

## Dependencies

- None. Read `~/.claude/global-rules/reference-guard-forms-and-floors.md`
  before starting.

## Risks & Mitigations

- **Copying another repo's helper blind.** Run it here, with its own
  mutations, before trusting it.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Shyden: "bring SHY-0556 to the front of the queue". Worked
  next, straight after SHY-0544 (which unblocks every backend PR), because
  SHY-0544's guard holds a hand-kept count of 460 files that any PR adding
  a file under its roots must edit.
- **2026-10-12**: Found while writing SHY-0544's guard. Scored 5: helper,
  recorder, meta-test and one conversion, on the pattern shyden.co.uk
  already runs.
