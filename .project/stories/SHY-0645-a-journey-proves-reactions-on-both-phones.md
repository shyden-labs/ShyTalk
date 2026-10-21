---
id: SHY-0645
status: Draft
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

- [ ] The "React" menu item, each picker emoji and each reaction badge has a
      test tag (`privateChat_reactMenuItem`, `privateChat_reactionPick_<n>`,
      `privateChat_reactionBadge_<messageId>_<n>`, `n` = the emoji's place in
      the picker), reachable in the Android and iPhone dumps.
- [ ] j28 gains three scenarios. The phone holder and Selma each react to the
      sender's group message, and both reactions show. The phone holder takes
      theirs back by tapping it, and Selma's stays. In a one-to-one chat, the
      recipient's reaction shows to the sender.
- [ ] One runner journey walks those scenarios from the same definition, on
      the phones as they are linked:
      - Android: Alice holds the phone and Theo sends.
      - iPhone: Theo holds the phone and Alice sends.
      Selma and the sender act over the network as themselves, and the sender
      reads the store.
- [ ] Each claim is checked on the phone's screen AND in the stored message
      read back through `GET /api/conversations/:id/messages`.

### Error paths

- [ ] A reaction the rules refuse fails the step naming the refusal (HTTP
      status and Firestore's message), never a timeout.
- [ ] Run against today's develop rules before SHY-0614 PR 3 deploys to dev,
      the recipient scenarios go red by name (recorded in the PR).

### Edge cases

- [ ] Every run starts from its own new group and chat, so a run that died
      halfway cannot leave reactions the next run reads.
- [ ] Removing a reaction is checked as gone from the screen AND the store,
      with the other person's reaction still on both.

### Performance

- [ ] The journey's duration on each phone is recorded in the PR; no fixed
      waits (each wait is for a named element or stored value, with a
      ceiling).

### Security

- [ ] The network writes use each persona's own ID token against the rules;
      no admin credential writes a reaction or a group.

### UX

- [x] Not applicable: tags only, nothing a person sees changes.

### i18n

- [x] Not applicable: steps match tags, never localised labels.

### Observability

- [ ] The report names each step, the phone, and a screenshot per step.

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
