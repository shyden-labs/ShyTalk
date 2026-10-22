---
id: SHY-0693
status: Draft
owner: claude
created: 2026-10-22
priority: P0
effort: XL
estimate: 13
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0011
blocked_by: [SHY-0692]
---

# SHY-0693: a reconnect replays the seat entry, and nothing shows inside the minute (apps)

## User Story

As anyone in a voice room, I want a member's short connection drop to show
nothing, and their return to look like stepping back onto the seat, so that
a blip never looks like a problem; and as the member who dropped, I want to
know my phone is reconnecting.

## Why

Shyden, 2026-10-22, with SHY-0692's rule: _"if the user does reconnect, we
play the usual animation of a new user entering the mic seat. by this i
mean, we refresh the seat with the existing state. I.e. if mic on, stay on.
if mic off, stay off."_ And: _"this also needs to work in case of the user
accidently closing the app and rejoining the room. they should just
reconnect as they originally were."_ He chose: reopening the app takes them
straight back in; and he chose (2026-10-22) the same refresh for a return
during the original grace, and a small "Reconnecting…" on the dropped
member's own phone only.

Today every other member's app dims an absent member at once
(`ActiveRoomManager.startPresenceMonitor`, `_disconnectedUserIds`), and a
non-owner's own app leaves the seat after 15 s of voice loss. Both act on
their own; under "app draws, server decides" they draw only what the server
says (SHY-0692).

## Acceptance Criteria

### Happy path

- [ ] Inside the minute, no other member's app shows anything different for
      the dropped member: no dimming, no badge, seat as before.
- [ ] Dimming and removal are drawn only when the server says the original
      grace has started or ended; no app starts a timer of its own for
      them.
- [ ] On a reconnect the server reports (inside the minute or during the
      grace, still seated), every member's app plays the existing
      seat-entry animation on that seat, with the server's current seat
      state: mic on stays on, mic off stays off.
- [ ] The dropped member's own phone shows a small "Reconnecting…" banner
      while it is reconnecting, gone on reconnect. No other member sees it.
- [ ] The member's own app no longer leaves the seat on voice loss
      (`VOICE_DISCONNECT_GRACE_PERIOD_MS` retired); it re-joins voice and
      restores its mic state from the server on reconnect.

- [ ] Swiping the app away (backgrounded, killed from the app switcher,
      phone restarted) never sends a leave: it is a drop. Only an active
      quit sends one: the Quit button, the Close button, or closing the
      chat-head (Android, when enabled; today's leave confirmation stays).
- [ ] After an active quit, reopening the app never takes the user back in
      (SHY-0692 answers "no seat"); they rejoin only by choosing the room.
- [ ] Opening the app again while the server still holds a seat for the
      user (SHY-0692's start-up answer) takes them straight into that room
      and onto that seat, no taps, with the entry animation and the
      server's seat state (mic on stays on, mic off stays off). An owner's
      room carries on as before.

### Error paths

- [ ] A reconnect or reopen after the server removed the member shows the
      normal "not on a seat" state (reopen: the normal home screen), never
      a stale seat.
- [ ] The start-up seat check failing never blocks opening the app: it
      opens normally and the failure is logged.

### Edge cases

- [ ] Repeated quick drops replay the entry animation once per reconnect,
      never stacked.
- [ ] An admin mute applied during the minute holds on reconnect (the
      refresh uses the server's state, not the phone's last one).

### Performance

- [ ] The entry animation starts within 1 s of the server's reconnect
      report on both platforms (measured on the linked phones).

### Security

- [x] Not applicable: the apps send no decision (SHY-0692 refuses them).

### UX

- [ ] The banner follows the room screen's existing notice style, in light
      and dark, readable at the smallest supported width.

### i18n

- [ ] "Reconnecting…" in all 19 locales, each read back by Google Cloud
      Translation before commit, with the writer/reader table in the PR.

### Observability

- [ ] Each reconnect replay is logged once on the app with room and seat.

### Runtime proof

- [ ] One journey test on Android AND iOS on the linked phones: a member
      drops for 20 s (others see nothing; the dropper sees the banner),
      then returns (the entry animation plays, mic state unchanged).
- [ ] The same journey with the app swiped away and reopened after 20 s:
      straight back onto the seat, mic state unchanged; and after the grace
      ends: the normal home screen.
- [ ] Both apps boot on dev against SHY-0692's server; the dev smoke passes.

## Announce

None: shipped with SHY-0692's note.

## BDD Scenarios

**Scenario: a blip shows nothing**

- **Given** Alice and Theo on mic seats, Theo's mic on
- **When** Theo's connection drops for 20 seconds and returns
- **Then** Alice saw no change, Theo saw "Reconnecting…", and Theo's seat
  plays the entry animation with his mic still on

## Test Plan

- RED first: shared tests of the presence monitor and connection monitor
  with a fake server feed (nothing drawn inside the minute; dim only on the
  server's word; replay on reconnect with server state).
- Compose and SwiftUI tests for the banner and the replay.
- The two-phone journey.

## Out of Scope

- The server's timing and rules (SHY-0692).

## Dependencies

- SHY-0692: the server's dropped / grace / reconnect reports.

## Risks & Mitigations

- **Risk:** an old app version still dims and leaves on its own.
  **Mitigation:** the server refuses its calls (SHY-0692); old versions are
  blocked once the release is in both stores (EPIC-0011).

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the phone runs recorded.

## Notes

- **2026-10-22**: filed from Shyden's report and rulings (memory
  `project-reconnect-buffer-one-minute`). P0: part of the same defect.
  Scored 8, then 13 the same day when reopening the app joined it: two
  monitors moved to the server's feed and a start-up return into the room
  on two platforms, close never leaving, a replay of an existing animation,
  one translated line, two two-phone journeys.
