---
id: SHY-0553
status: Draft
owner: claude
created: 2026-10-11
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0553: The store apps catch up with the v0.99.0 server, so the device lock holds again

## User Story

As the operator, I want the Play Store and App Store builds to match the
server's release, so that the device lock and the other client-side checks
the server now expects actually run on people's phones.

## Why

Measured 2026-10-11 (code read at the tags, not yet observed on a device):

- The v0.99.0 deploy (SHY-0550, run 38185801589) updated the API and the
  Firestore rules but not the apps (android=false, ios=false, standing
  choice); the store apps are the v0.97.14 builds from 2026-06-12.
- v0.99.0 rules deny all client access to `deviceBindings/{deviceId}`
  (SHY-0170). The June apps read and write it directly
  (`DeviceRepositoryImpl.kt:22,33`, `IosSmallRepositories.kt:34,46` at
  v0.97.14). Their sign-in treats the refused read as `/* lenient */`
  (`AuthViewModel.kt:326,353`), so sign-in still works, but the device lock
  now FAILS OPEN on every store install: the v0.99.0 lock decision lives in
  `POST /api/devices/lock-check`, which the June apps never call.
- The `funFacts` rule was removed; the June splash catches the refusal and
  keeps its cached facts (no hang). Room creation is unaffected (both June
  clients send `ownerFirebaseUid`).

## Acceptance Criteria

### Happy path

- [ ] Shyden decides how the apps catch up (store release of v0.99.0 or of a
      later release), recorded here with the date.
- [ ] The released Android and iOS builds call `/api/devices/lock-check`;
      a second account on a bound device is refused on a real device.

### Error paths

- [ ] If a store review delays the release, the gap's length is recorded and
      the decision whether to keep the fail-open window is Shyden's.

### Edge cases

- [ ] People who never update: whether a minimum-version gate is needed is
      decided and recorded.

### Performance

- [ ] Not applicable beyond the release's own gates.

### Security

- [ ] The fail-open window (2026-10-11 23:52Z until the new builds are live)
      is recorded with its start and end, for the moderation record.

### UX

- [ ] The device-locked screen shows on the released builds (SHY-0512 fixes
      its support link).

### i18n

- [ ] Not applicable: no new copy.

### Observability

- [ ] A check that the store builds' version matches the server's release
      is named for SHY-0551's "nothing stops silently" work.

## BDD Scenarios

**Scenario: A second account on a bound device is refused**

- **Given** a phone bound to one account, on the store build
- **When** a different account signs in on it
- **Then** the device-locked screen shows and the sign-in is refused

## Test Plan

- Real-device runs on the released builds (the one local exception).

## Out of Scope

- Changing the rules back (the server decision is the fix).

## Dependencies

- SHY-0550 (server on v0.99.0, done for the API 2026-10-11).

## Risks & Mitigations

- Store review time: start the release early.

## Definition of Done

- [ ] Every AC ticked with evidence; board item Done.

## Notes

- Found 2026-10-11 checking whether the v0.99.0 rules break the June apps
  (prompted by Shyden's side note).
