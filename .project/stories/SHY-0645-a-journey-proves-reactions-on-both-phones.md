---
id: SHY-0645
status: In Review
owner: claude
created: 2026-10-19
priority: P0
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0645: A journey proves reactions on both phones

## User Story

As the person shipping ShyTalk, I want one journey that reacts to messages
on a real Android phone and a real iPhone and checks that everybody sees the
result, so that a rules change can never again stop reactions without a red
test saying so.

## Why

Found on 2026-10-19 while testing SHY-0614's rules lock. The live rules
refuse every recipient's reaction in private and group chats (SHY-0644), and
no test noticed: 0 of the 46 journey feature files mention a reaction, and the
journey runner (`express-api/scripts/device-journey-runner.js`) has no
reaction step.

The runner cannot reach reactions today. The "React" menu item, the six
emojis in the reaction picker and the badges under a message carry no test
tags. The picker is a `Popup`, its own Compose window, so on Android even a
tag needs `exposeTestTagsToPlatformDumps()` (as `privateChat_reportMenuItem`
does). Reactions and group creation have no API route: the app writes them
straight to Firestore, so the people not holding the phone must write the
same way, as themselves, through the real rules (the admin SDK skips the
rules and would prove nothing).

SHY-0614 must not reach production until this journey is green on dev
(journey-first), and SHY-0644 proves its fix with it.

## Acceptance Criteria

### Happy path

- [x] The "React" menu item, each picker emoji and each reaction badge has a
      test tag (`privateChat_reactMenuItem`, `privateChat_reactionPick_<n>`,
      `privateChat_reactionBadge_<messageId>_<n>`, `n` = the emoji's place in
      the picker), reachable in the Android and iPhone dumps.
      Proof: every J28R journey finds and taps them on both phones, green on
      dev 2026-10-23 (#2454 comment 6347905077; #2549 comment 6350793934); ReactionTagsTest 9/9 (#2454).
- [x] j28 gains three scenarios. The phone holder and Selma each react to the
      sender's group message, and both reactions show. The phone holder takes
      theirs back by tapping it, and Selma's stays. In a one-to-one chat, the
      recipient's reaction shows to the sender.
      Proof: journey-tests/j28-groups-and-second-chances.feature (#2454,
      a8de00dfa0f).
- [x] Three runner journeys, one per scenario (J28R-GROUP, J28R-UNDO,
      J28R-DM), each from one definition, on the phones as they are linked
      (one journey until 2026-10-23: it stopped at its first red and hid the
      later checks; Shyden: "if there's more things to check, then you must
      make sure you always check them"):
      - Android: Alice holds the phone and Theo sends.
      - iPhone: Theo holds the phone and Alice sends.
      Selma and the sender act over the network as themselves, and the sender
      reads the store.
      Proof: all three green on dev on both phones (#2454 comment 6347905077; #2549 comment 6350793934).
- [x] Each claim is checked on the phone's screen AND in the stored message
      read back through `GET /api/conversations/:id/messages`.
      Proof: each journey's "Store:" step reads that route as the sender and
      its "UI:" step reads the badge; both green in the runs above.

### Error paths

- [x] A reaction the rules refuse over the network fails the step naming the
      refusal (HTTP status and Firestore's message). A refused tap on the
      phone shows nothing there (SHY-0644), so its step fails after the 15 s
      store wait, naming the stored value and SHY-0644, until SHY-0644 makes
      the phone show the refusal (reworded by Shyden, 2026-10-23).
      Proof: Selma's refusal "HTTP 403 PERMISSION_DENIED ... L478"; the
      phone taps' failures name SHY-0644 (#2454 comment 6347070265).
- [x] Run against production's rules (origin/main's, the rules before
      SHY-0614 PR 3; PR 3 had reached dev before this story's PR opened) on
      the local stack, every recipient write goes red by name (recorded in
      the PR).
      Proof: 4 of 4 red, each refused at rules line 478 in the emulator log
      (#2454 comment 6347070265).

### Edge cases

- [x] Every run starts from its own new group and chat, so a run that died
      halfway cannot leave reactions the next run reads.
      Measured 2026-10-23: a one-to-one chat cannot be new, since the route
      gives two people one chat (`conversationIdFor`), so J28R-DM's run gets
      its own new MESSAGE in that chat and reacts to and reads only that
      message by id; the purpose (no left-over reaction is ever read) holds.
      Proof: each group is created in the journey's setup named with the
      run's time (`JR-<journey>-<ms>`); each message carries the run's time.
- [x] Removing a reaction is checked as gone from the screen AND the store,
      with the other person's reaction still on both.
      Proof: J28R-UNDO green on both phones ("Store: ... reads only Selma's
      👍", "UI: ... sees 👍 and no ❤️").

### Performance

- [x] The journey's duration on each phone is recorded in the PR; no fixed
      waits (each wait is for a named element or stored value, with a
      ceiling).
      Proof: #2454 comment 6352440662; no sleep or setTimeout in the
      journeys' code (0 in reactionWorld..J28R_DM; the same search finds
      them elsewhere in the runner).

### Security

- [x] The network writes use each persona's own ID token against the rules;
      no admin credential writes a reaction or a group under test. On the
      local stack only, J28R-UNDO's starting reactions are placed by the
      emulator admin as set-up, so its take-back can be tested against
      production's rules (allowed by Shyden, 2026-10-23); on dev each person
      writes their own.
      Proof: express-api/scripts/lib/firestore-as-person.js; placeReactions
      uses the admin handle only when ctx.state.db exists (local).

### UX

- [x] Not applicable: tags only, nothing a person sees changes.

### i18n

- [x] Not applicable: steps match tags, never localised labels.

### Observability

- [x] The report names each step, the phone, and a screenshot per step.
      Proof: each run's latest-report.md (kept with the runs cited above).

## Announce

Nothing: test tooling.

## BDD Scenarios

**Scenario: two people react to a group message**

- **Given** Alice, Theo and Selma are in a group, and the sender (the one of
  Alice and Theo not on the phone) has posted a message
- **When** the phone holder taps ❤️ on it and Selma reacts with 👍
- **Then** the sender reads ❤️ and 👍 on the message, and the phone shows both

**Scenario: taking a reaction back**

- **Given** the phone holder's ❤️ and Selma's 👍 are on the sender's message
- **When** the phone holder taps their ❤️ again
- **Then** the sender reads only Selma's 👍, and the phone shows 👍 and no ❤️

**Scenario: the recipient's reaction reaches the sender**

- **Given** the sender has written to the phone holder one-to-one
- **When** the phone holder reacts with 😂
- **Then** the sender reads 😂 under their message, and the phone shows it

## Test Plan

- Runner unit tests (`express-api/tests/scripts/device-journey-runner.test.js`)
  for the new Firestore-as-a-person helper with the network stood in: the
  request it sends, a refusal, a malformed reply.
- The journey on dev on both phones; red against the old rules first.

## Out of Scope

- Making a failed reaction say so (SHY-0644); whose name a reaction carries
  (SHY-0643); reactions on web, which has none.
- Running both phones at once (SHY-0618): this journey runs once per phone.

## Dependencies

- None to start. Its dev-green run needs SHY-0614 PR 3 deployed to dev.

## Risks & Mitigations

- Popup tags missing from the Android dump: each tag is asserted present in
  the dump before it is tapped, so a missing one fails by name.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; green on dev on both phones; Shyden signs off the phones.
      Done so far: every AC ticked; #2454 merged (a8de00dfa0f) with PR Checks
      run 39823456722 green by step name; green on dev on both phones
      (#2454 comment 6347905077, #2549 comment 6350793934). Waiting on:
      Shyden's sign-off of the phones (recordings and reports kept with the
      runs).

## Notes

- **2026-10-19**: Filed from SHY-0614 Task 10, which assumed the runner could
  already reach reactions. P0: SHY-0614 (P0) and SHY-0644 (P0) wait on it.
  Not MVP (test tooling). Scored 5, the same size as SHY-0643: three tags in
  one shared Compose file, one runner helper with unit tests, one journey and
  three scenarios, two phone runs.
- **2026-10-22**: recast for the linked phones (memory: Alice on the Android
  phone, Theo on the iPhone; signing anyone else in is refused). The phone
  holder now taps both the reaction and the take-back on both platforms, where
  the take-back tap used to run on iOS only. The sender (the other of Alice
  and Theo) creates the group, which stays within the follow graph, and reads
  the store.
  The rest of j28 (its header, "Leaving a group" and the block scenarios) still
  casts Theo on Android and Selma on the iPhone; that is SHY-0658's sweep (#2490).
- **2026-10-23**: proofs complete. The red run first proved 1 of 4
  recipient writes (the journey stopped at its first red); split into three
  journeys and re-run, 4 of 4 red. Greens on dev on both phones; the
  iPhone J28R-GROUP waited on SHY-0702 (#2549). Shyden reworded two ACs
  (phone refusals, local admin set-up). In Review until his phone sign-off.
