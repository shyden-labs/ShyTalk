---
id: SHY-0620
status: Draft
owner: claude
created: 2026-10-16
priority: P1
effort: L
estimate: 13
type: infra
roadmap_ids: []
mvp: false
---

# SHY-0620: The rooms, chat, money and profile phone tests run on Android and iPhone

## User Story

As the operator, I want the Android-only on-device tests of voice rooms,
messages, gifts, the wallet and profiles rewritten as journeys that both
phones run, so that the iPhone is held to exactly what Android is.

## Why

Shyden's global rule (2026-10-16): every mobile test is one test, run on
Android and iOS. Shyden, for ShyTalk: _"yes rewrite them. fix it"_.

Measured on `origin/develop` `7936bd16e66`: these 11 files and 47 tests
run on Android only (in `app/src/androidTest/java/com/shyden/shytalk`),
and nothing like them runs on the iPhone:

| File | Tests |
| --- | --- |
| `journey/RoomCreationTest.kt` | 3 |
| `journey/RoomBrowsingTest.kt` | 5 |
| `feature/room/MicToggleTest.kt` | 6 |
| `journey/GiftWallJourneyTest.kt` | 3 |
| `journey/WalletAndTransactionsTest.kt` | 4 |
| `journey/DailyRewardTest.kt` | 2 |
| `journey/FollowListJourneyTest.kt` | 7 |
| `journey/PrivateMessagingTest.kt` | 3 |
| `journey/GroupChatCreationTest.kt` | 3 |
| `journey/ProfileTest.kt` | 7 |
| `resources/StringResourceContentTest.kt` | 4 |

## Acceptance Criteria

### Happy path

- [ ] Each of the 47 tests becomes a step-for-step journey case run on
      both phones (SHY-0618) with real input, with the same assertions it
      makes today.
- [ ] Each Android-only file is deleted in the same PR that its journey
      cases land in, and comes off SHY-0617's burn-down list.
- [ ] `StringResourceContentTest`'s four checks of string content either
      become journey cases that read the shown text on both phones, or,
      if they need no phone, move to a unit test over the shared
      strings. The PR says which and why.

### Error paths

- [ ] A case one phone fails is a bug filed that day; it is never
      skipped or weakened on that phone.

### Edge cases

- [ ] Mic cases use the real microphone permission flow on both phones.
- [ ] No real money: wallet and gift cases use dev coins only.
- [ ] A case that cannot yet run on the iPhone stays as a marked
      stand-in with its harness story filed above it.

### Performance

- [ ] The run time of the moved cases is measured on both phones and
      recorded.

### Security

- [ ] Not applicable beyond the persona separation SHY-0618 gives.

### UX

- [ ] Not applicable: no app change unless a case finds a bug.

### i18n

- [ ] Not applicable: no user-facing text changes.

### Observability

- [ ] The two-phone report lists each moved case by its old test name.

## BDD Scenarios

**Scenario: a moved room test runs on both phones**

- **Given** the room journey case that replaced `RoomCreationTest`
- **When** the runner walks it
- **Then** it passes on the Android phone and on the iPhone with the same assertions

**Scenario: the Android-only file is gone**

- **Given** the PR that moves `RoomCreationTest.kt`
- **When** the guards suite runs
- **Then** the file no longer exists and the burn-down list is one entry shorter

## Test Plan

- One journey case per old test (never a loop over them).
- A real two-phone run, recorded on the story.

## Out of Scope

- Sign-in, identity and safety tests (SHY-0619).

## Dependencies

- SHY-0617 (guard) and SHY-0618 (two-phone runner) first.

## Risks & Mitigations

- Two parallel walks in one voice room can collide. Each phone uses its
  own room or seat, decided at design.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; a two-phone run recorded.

## Notes

- **2026-10-16**: Filed for the "every mobile test is one test" rule.
  Estimate 13: 47 tests across 11 files, plus room and wallet setup on
  both phones.
