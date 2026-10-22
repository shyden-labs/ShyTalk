---
id: SHY-0696
status: Draft
owner: claude
created: 2026-10-22
priority: P0
effort: M
estimate: 5
type: feature
roadmap_ids: []
mvp: true
epic: EPIC-0011
---

# SHY-0696: joining another room leaves the old one, and an owner is warned first

## User Story

As anyone in a voice room, I want entering another room to take me out of
the one I was in, so that I am never counted in two rooms; and as a room
owner, I want to be warned before entering another room closes mine, so
that I never close it by accident.

## Why

Shyden, 2026-10-22, with the reconnect rules (SHY-0692, SHY-0693): _"Also if
they join another room they're automatically cancelled from the any other
room"_, and _"if the owner of a room goes to another room, it'll
automatically close the owner's room. so before they are granted access to
the new room, we should display a warning dialog and inform them that if
they enter, their existing room will be closed first"_.

Per "app draws, server decides" (2026-10-20), the server makes both rules
inside the join (`POST /rooms/:roomId/join`, `express-api/src/routes/room-mutations.js`),
so no app version can skip them.

## Acceptance Criteria

### Happy path

- [ ] A member joining another room is removed from every other room in the
      same server decision: off any seat, out of the member list, any drop
      record or deadline (SHY-0692) cleared.
- [ ] An owner whose room is open (ACTIVE or OWNER_AWAY) joining another
      room is refused with a distinct code ("joining closes your room") and
      the room's name, until the request carries the owner's confirmation.
- [ ] The app shows a warning dialog on that answer, BEFORE the owner
      enters: entering will close their own room first. Enter → the server
      closes the owner's room (the normal close), then joins; Cancel →
      nothing changes and they stay where they were.
- [ ] The dialog appears on every way into a room (room list, link, invite,
      notification), because it is drawn from the server's answer.

### Error paths

- [ ] The close failing refuses the join (never two open rooms, never a
      half-switch), and the owner is told; logged with both room ids.
- [ ] An unconfirmed join changes nothing (proven: room still open, seats
      unchanged).

### Edge cases

- [ ] Re-entering one's own room is not a switch (no dialog, no close).
- [ ] An owner whose room is already CLOSED joins with no dialog.
- [ ] Two quick joins to different rooms: the user ends in exactly one.

### Performance

- [ ] The switch adds at most one transaction to the join (measured).

### Security

- [ ] The confirmation is a field the server checks against the caller's
      own room; a member cannot close someone else's room through it.
- [ ] Firestore rules tests (DENY, red on the base rules) if any rule
      changes; otherwise the route's tests prove the refusal.

### UX

- [ ] The dialog follows the app's existing confirmation style (as the
      chat-head leave confirmation), light and dark, both platforms; it
      names the room that will close.

### i18n

- [ ] The dialog's title, body and buttons in all 19 locales, each read
      back by Google Cloud Translation before commit, writer/reader table
      in the PR.

### Observability

- [ ] Each switch is logged once: user, from-room, to-room, and whether a
      room was closed.

### Runtime proof

- [ ] Integration on the emulators: member switch, owner refused,
      confirmed owner switch closes then joins, failed close refuses.
- [ ] A journey, one test on Android AND iOS on the linked phones: an
      owner opens another room, sees the dialog, cancels (own room still
      open), then enters (own room closed, now in the new room).

## Announce

Entering another room now takes you out of the one you were in. If you own
an open room, you are asked first, because entering will close it.

## BDD Scenarios

**Scenario: an owner is warned**

- **Given** Alice owns an open room
- **When** she opens Theo's room
- **Then** she sees that entering will close her room first, and nothing
  changes until she chooses Enter

**Scenario: a member switches**

- **Given** Theo is on a seat in Alice's room
- **When** he enters another room
- **Then** he is off Alice's seat and out of her room at once

## Test Plan

- RED first: route tests of the switch decision (member, owner refused,
  owner confirmed, close failure, re-entry, closed room, two quick joins).
- Integration on the emulators; dialog tests on both platforms; the phone
  journey.

## Out of Scope

- The drop and quit rules (SHY-0692, SHY-0693).

## Dependencies

- None. Built with SHY-0692/0693 (Shyden, 2026-10-22: after SHY-0691).

## Risks & Mitigations

- **Risk:** an old app version never shows the dialog. **Mitigation:** the
  server refuses an unconfirmed owner join, so an old app cannot close a
  room; old versions are blocked once the release is in both stores
  (EPIC-0011).

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the phone runs recorded.

## Notes

- **2026-10-22**: filed from Shyden's rules above (memory
  `project-reconnect-buffer-one-minute`), split from SHY-0692/0693 so each
  stays within 13. P0 with its siblings. Scored 5: one join decision with a
  confirmation code, one dialog on two platforms in 19 locales, a phone
  journey.
