---
id: SHY-0570
status: Draft
owner: claude
created: 2026-10-12
priority: P2
effort: M
estimate: 3
type: chore
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0570: The root moves to firebase 13 with rules-unit-testing 6, proved by its integration runs

## User Story

As the operator keeping dependencies current, I want the root `firebase`
and `@firebase/rules-unit-testing` to move to 13 and 6 together, so that the
root stays on a supported SDK without breaking its install.

## Why

SHY-0568 reverted firebase 13.0.0 because `@firebase/rules-unit-testing`
5.0.2 peers `firebase ^12`. Measured 2026-10-12: rules-unit-testing 6.0.0
peers `firebase ^13.0.0`. The root integration specs (`tests/integration/07`
and `10`) import `firebase/firestore` and have never run on 13.

## Acceptance Criteria

### Happy path

- [ ] Root `firebase` ^13 and `@firebase/rules-unit-testing` ^6; the root
      `npm ci` succeeds; the SHY-0568 peer test passes.
- [ ] The integration and Playwright suites run green on the PR (CI).
- [ ] The Dependabot ignore added by SHY-0568 is removed.

### Error paths

- [ ] Any API change the majors bring is fixed in the specs, never by
      pinning back without Shyden.

### Edge cases

- [ ] `express-api`'s own rules-unit-testing is judged separately (it keeps
      its own firebase).

### Performance

- [ ] Not applicable.

### Security

- [ ] Not applicable.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] Not applicable.

## BDD Scenarios

**Scenario: the root moves to firebase 13**

- **Given** root firebase ^13 and rules-unit-testing ^6
- **When** the PR's checks run
- **Then** the root install, the integration suite and Playwright pass

## Test Plan

- CI integration and Playwright runs; the peer test.

## Out of Scope

- `express-api`'s firebase-admin (SHY-0292).

## Risks & Mitigations

- **A breaking API change in the SDK.** Found by the integration runs on the
  PR, fixed in the specs.

## Dependencies

- SHY-0571 (so the PR's checks install the root packages).

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Filed with SHY-0568. Scored 3: two package majors and
  their integration proof.
