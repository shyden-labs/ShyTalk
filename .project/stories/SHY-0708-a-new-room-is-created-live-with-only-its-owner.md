---
id: SHY-0708
status: Draft
owner: claude
created: 2026-10-24
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
blocked_by: [SHY-0657]
---

# SHY-0708: a new room is created live with only its owner

## User Story

As a member, I want a room someone else creates to be unable to name me
as its member or mark itself already closed or away, so that nobody can
pull me out of the room I am in or fake a room's moderation state.

## Why

The room create rule (`firestore.rules:264`) checks only the cohort, the
owner's id and the owner's Firebase uid. Every other field a client
writes is taken as given: `state`, `ownerLeftAt`, `ownerAwayCause`,
`participantIds`, `seats`, `hostIds`, `bannedUserIds`, `kickInfo` and the
rest. Updates are server-only, but a create is not. Found 2026-10-24 by
the automated security review of SHY-0692's owner-away watch:

- a room created already `OWNER_AWAY` with an old `ownerLeftAt` is closed
  by the server, which then clears `currentRoomId` for every id the
  client put in `participantIds`, other members' included;
- the owner's own `/rooms/:id/close` (on `develop` today) clears every
  listed `participantIds` entry the same way;
- a far-future `ownerLeftAt` overflowed Node's timer and spun every server
  (fixed in the watch on the SHY-0692 branch, bcec7e5448d, which also
  stops a non-digit id becoming a `users/{id}` path).

Both apps create a room with `state: 'ACTIVE'`, `participantIds: [owner]`,
the owner on seat 0 of 8 seats, and empty host, ban, kick, invite and
join-time fields (`RoomRepositoryImpl.kt:118`, and the iOS
`IosRoomRepositoryImpl.kt`).

## Acceptance Criteria

### Happy path

- [ ] The create rule admits exactly the fields both apps write, with
      `state == 'ACTIVE'`, `participantIds == [ownerId]`,
      `allTimeSeatUserIds == [ownerId]`, seat 0 the owner OCCUPIED and
      every other seat EMPTY with no user, and empty `hostIds`,
      `bannedUserIds`, `allTimeHostIds`, `kickInfo`, `pendingInvites`,
      `firstJoinTimestamps`.
- [ ] A room created by the Android and the iPhone app still opens and
      the owner can join, on both phones (one test, both phones).

### Error paths

- [ ] Each DENY is a rules test red on the base rules in CI (SHY-0657,
      the lasting red-first check; this AC waits for it, as SHY-0653's did):
      a create with `state` OWNER_AWAY, CLOSED, or missing; with
      `ownerLeftAt` or `ownerAwayCause` present; with another member in
      `participantIds`; with a non-owner seated; with a host or ban set;
      with a field the apps never write.

### Edge cases

- [ ] A member is cleared from a room only while their own
      `currentRoomId` is that room, one transaction per member, on every
      path that clears another user's `currentRoomId` from a room's list:
      `/rooms/:id/close` and `/rooms/:id/disconnect-user` on `develop`
      (measured 2026-10-24; the stale-room reap clears none), and the drop
      store's `closeOwnerAwayRoom` on SHY-0692's branch, which adopts
      `clearCurrentRoomFor` when it merges `develop` in.
- [ ] Rooms already in production that break the new create shape are
      counted (a read-only query); none is changed without Shyden.

### Performance

- [ ] The membership check on close costs at most one read per listed
      member, measured on the emulator.

### Security

- [ ] The rule and the close check above, each proven red first.

### UX

- [x] Not applicable: no screen changes.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] A close that skips a member whose `currentRoomId` is elsewhere logs
      the room and the count.

### Runtime proof

- [ ] On dev, a create forged with another member's id is refused (the
      rules test's case run against dev's deployed rules), recorded by
      step name.

## Announce

None: a fix with no visible change for honest use.

## BDD Scenarios

**Scenario: a forged room naming another member is refused**

- **Given** Alice is signed in
- **When** her client creates a room whose `participantIds` lists Theo
- **Then** Firestore refuses the create

**Scenario: a forged away room cannot exist**

- **Given** Alice is signed in
- **When** her client creates a room with `state: 'OWNER_AWAY'`
- **Then** Firestore refuses the create, and no server ever closes it

**Scenario: a close never clears a member sitting elsewhere**

- **Given** Theo's `currentRoomId` is room B
- **When** room A, whose list names Theo, is closed
- **Then** Theo's `currentRoomId` is still room B

## Test Plan

- Rules: `express-api/tests/firestore-rules/room-rules.test.js` DENY
  cases, red on base in CI.
- Unit: each close path's membership check.
- Phones: room creation and join on Android and iPhone.

## Out of Scope

- The watch's own time bound and id filter (done in SHY-0692).

## Dependencies

- None. SHY-0692's watch is safe without this (bounded time, filtered
  ids), but a forged list can still clear members until this lands.

## Risks & Mitigations

- **Risk:** an app version writes a field the rule does not list, so
  room creation breaks on phones.
  **Mitigation:** the allowed fields are read from both apps' create
  code, and the phone AC runs before merge.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; phones signed off by Shyden.

## Notes

- 2026-10-24: raised by the security review of SHY-0692 (3eab574ec43).
