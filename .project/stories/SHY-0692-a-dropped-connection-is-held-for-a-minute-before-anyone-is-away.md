---
id: SHY-0692
status: Draft
owner: claude
created: 2026-10-22
priority: P0
effort: L
estimate: 8
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0011
---

# SHY-0692: a dropped connection is held for a minute before anyone is away (server)

## User Story

As anyone on a mic seat in a voice room, I want a short network outage to
change nothing for a minute, so that a blip never closes my room, moves me
off my seat or shows the room that anything happened.

## Why

Shyden found it on dev, 2026-10-22: _"if a room owner is on their own and
they suffer a temporary network outage, the room is closed instantly."_ His
rule, for every voice user: _"We detect a disconnection, we keep that
connection live for at least 1 minute. making no changes to the room not
showing the users in the room of any issues. after that 1 minute, if the
user hasn't managed to reconnect, the grace period begins. the original
grace period rules still apply, we are just adding a 1 minute buffer before
this process."_

Measured in the code on develop f4e95481a92, four paths treat a drop as
"away", none with a buffer:

| Who drops | Who acts | After | What happens |
|---|---|---|---|
| Owner, alone | server (`owner-left-handler.js`, `decideOwnerLeftAction`) | seconds (RTDB onDisconnect) | room closes (`CLOSE_IMMEDIATE`) |
| Owner, others seated | server (same) | seconds | `OWNER_AWAY`, then `OWNER_LEAVE_TIMEOUT_MS` (5 min) |
| Anyone, seen by others | other members' apps (`ActiveRoomManager.startPresenceMonitor`) | 0 s dim, `PRESENCE_TIMEOUT_MS` (30 s) | dimmed, then removed (owner: set away) |
| Non-owner, voice only | their own app (`ActiveRoomManager` connection monitor) | `VOICE_DISCONNECT_GRACE_PERIOD_MS` (15 s) | leaves the seat |

Shyden's rulings (2026-10-22): the minute applies to every voice user; a
swiped-away app or a dead phone gets the same minute (the server cannot tell
them from lost signal; Leave and Close stay instant); a reconnect during the
original grace gets the same refresh as one inside the minute. Also
Shyden: _"this also needs to work in case of the user accidently closing the
app and rejoining the room. they should just reconnect as they originally
were. the only time they wouldn't is if they've already been removed from
the seat (after the grace period)"_; reopening the app takes them straight
back in (his choice). And: _"if the person swipes away to leave, they
haven't actually left. it moves to the background. but they they actively
choose to quit, by choosing the quit button. pressing the close button or
closing the chat-head (if enabled) then they're not away, they have actively
quit and should not be automatically rejoined. Also if they join another
room they're automatically cancelled from the any other room"_; and the room-switch rules (another room, the owner's warning) are SHY-0696. Per
"app draws, server decides" (2026-10-20), the server times and stores the
minute and every decision after it; the apps only draw (SHY-0693).

## Acceptance Criteria

### Happy path

- [ ] A seated voice user whose connection drops (whole connection or voice
      only) is recorded by the server as dropped at that moment, with a
      deadline one minute later. Until the deadline the room document,
      seats, state and member list are unchanged, and the server tells no
      app the user is away.
- [ ] A reconnect before the deadline clears the record. Nothing else is
      written: the seat keeps the server's current state (mic on stays on,
      mic off stays off).
- [ ] At the deadline, still dropped: the ORIGINAL rules start, unchanged
      in length and outcome: owner alone → the room closes; owner with
      others seated → `OWNER_AWAY` and the 5-minute countdown; non-owner →
      the 30-second grace, then removal from the seat.
- [ ] A reconnect during the original grace, still seated, ends it as today
      (owner: the room returns to `ACTIVE`), and is reported to apps the
      same way as a reconnect inside the minute (SHY-0693 draws the
      refresh).
- [ ] An app closed by accident and opened again is the same drop: the
      server answers a signed-in user's start-up with the room and seat it
      still holds for them (inside the minute or the grace), and their
      rejoin counts as a reconnect (record cleared, grace ended, owner's
      room back to `ACTIVE`), never as a new join. Once removed, the answer
      is "no seat" and a rejoin is an ordinary join.
- [ ] An active quit (the app's Quit button, Close button, or closing the
      chat-head) is a leave, at once: no minute, no grace beyond today's
      leave rules (member: off the seat and out of the room; owner with
      others seated: `OWNER_AWAY`; owner alone: the room closes), any
      pending drop record cleared, and the start-up answer is "no seat", so
      the app never rejoins them by itself.
- [ ] The server, not any app, decides every step: no app removes a member,
      sets a room away or closes it on a connection signal. The routes the
      apps call today for that refuse it (or are retired), with tests.

### Error paths

- [ ] The minute survives a server restart or a move to another instance:
      the deadline is stored, and a restarted server acts on every deadline
      it finds (past ones at once).
- [ ] A failed write at the deadline fails loudly (logged with room and
      user, alert per the "nothing stops silently" rule) and is acted on at
      the next check; it never closes the room early.

### Edge cases

- [ ] Each fresh drop after a reconnect starts a fresh minute.
- [ ] Two devices: the user counts as dropped only when no device holds the
      connection (today's `isUserPresent` re-check).
- [ ] Swiping the app away (backgrounded or killed from the app switcher)
      is a drop, never a quit: the minute applies.
- [ ] An active quit during the minute or the grace ends it as a quit (the
      deadline does nothing afterwards).
- [ ] Joining another room during the minute or the grace is SHY-0696's
      switch: the old room's record and deadline are cleared by it.
- [ ] A member who drops while not on a seat changes nothing (as today).
- [ ] A room closed by any other path during the minute: the deadline does
      nothing.

### Performance

- [ ] Deadlines are acted on within 10 seconds of falling due (the check's
      period is measured and stated).

### Security

- [ ] Only the server writes the dropped record and deadline; Firestore and
      RTDB rules refuse members, with DENY tests that fail on the base
      rules (SHY-0657's rule).
- [ ] A member cannot arm, clear or extend another member's record.

### UX

- [x] Drawn by SHY-0693.

### i18n

- [x] Not applicable here: no copy (SHY-0693 owns the banner).

### Observability

- [ ] Each drop, reconnect, deadline reached and grace started is logged
      once with room, user and timing (personal data per the logging rule).

### Runtime proof

- [ ] The bug measured RED first on a real phone before any fix is pushed:
      owner alone, flight mode on for 10 s, the room closes. Recorded.
- [ ] Integration suite (real emulators) covers each path above; the dev
      deploy is healthy and its smoke passes after merge.
- [ ] A journey, one test on Android AND iOS, on the linked phones: flight
      mode for 20 s inside the minute (room unchanged), then for 90 s (the
      original rule fires after the minute).

## Announce

Rooms ride out short connection drops: a blip of under a minute no longer
closes your room or takes you off your seat.

## BDD Scenarios

**Scenario: owner alone loses signal briefly**

- **Given** an owner alone in their ACTIVE room
- **When** their connection drops for 20 seconds and comes back
- **Then** the room is still ACTIVE and unchanged

**Scenario: owner alone does not come back**

- **Given** an owner alone in their ACTIVE room
- **When** their connection stays down for over a minute
- **Then** at the minute the room closes, as the original rule says

**Scenario: a seated member drops for longer**

- **Given** a non-owner on a mic seat
- **When** their connection stays down
- **Then** nothing changes for a minute, then the 30-second grace runs,
  then they leave the seat

## Test Plan

- RED first: unit tests of the decision with the clock stubbed (inside the
  minute, at it, after it; each original rule after it; reconnect in each
  window; fresh minute after a reconnect; restart with past and future
  deadlines; closed room).
- Integration on the emulators: signal → record → deadline → rule.
- Rules DENY tests, red on the base rules.
- Mutation on each new branch; the phone journey on both phones.

## Out of Scope

- The apps' drawing (SHY-0693).
- Changing the original grace lengths.

## Dependencies

- None. Built right after SHY-0691 merges (Shyden, 2026-10-22).

## Risks & Mitigations

- **Risk:** a lost deadline leaves a dead room open. **Mitigation:** stored
  deadlines, acted on after restart; the existing stale-room cron stays as
  the backstop.
- **Risk:** old app versions still remove members themselves.
  **Mitigation:** the server refuses those calls; old versions are blocked
  once the release is in both stores (EPIC-0011).

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; the phone runs recorded.

## Notes

- **2026-10-22**: filed from Shyden's report and rulings above (memory
  `project-reconnect-buffer-one-minute`). P0: a defect. Scored 8: a stored
  deadline with a restart-safe check, four paths moved behind it, rules
  DENY tests, and a two-phone journey.
