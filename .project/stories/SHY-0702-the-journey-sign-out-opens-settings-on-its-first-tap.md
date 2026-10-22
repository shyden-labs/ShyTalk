---
id: SHY-0702
status: Done
owner: claude
created: 2026-10-23
priority: P0
effort: S
estimate: 2
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0011
blocked_by: []
---

# SHY-0702: the journey sign-out opens settings on its first tap

## User Story

As the developer, I want the journey runner's sign-out to open settings on
its first tap, so that a journey never fails, or spends a minute on a
restart, before it reaches the feature it tests.

## Why

Measured on 2026-10-23, dev, Android OnePlus CPH2653, app at 0397353760d
(#2454): after J08 left Vexa signed in, the next journey's "Reach SignIn"
tapped `main_settingsButton` and `settings_signOutButton` never appeared
within 6 s. In the first run the runner's force-stop fallback failed the same
way and J28R-GROUP failed ("timed out (6000ms) waiting for
#settings_signOutButton"; the screenshot shows Vexa's profile, the gear on
screen). In the second run the first attempt failed again (the step made 6
UI operations, 2 more than one clean sign-out) and the fallback worked
(65.5 s). Tapping the same gear by hand afterwards, with Alice signed in,
opened settings at once. Ruled out: the preview badge over the gear is
`clickable=false` in the dump and passes taps through by design.

The same step fails on the iPhone Air (dev, Theo, the same commit,
2026-10-23 18:05Z run) one tap earlier: J28R-GROUP after J08: "POST
/element/.../click -> 404: The previously found element "main_profileTab"
Button is not present in the current view anymore"; J28R-DM after
J28R-UNDO (which ends inside a chat, with no tab bar): "tap target
#main_profileTab not found on screen". So the sign-out flow taps a tab
the screen no longer shows, on both platforms.

**Cause measured on the iPhone (re-run with --debug, 2026-10-23):** J08
ends on the "New Message" screen (no tab bar), so Reach SignIn takes the
force-stop-and-relaunch path; after the relaunch the daily-reward sheet
(`dailyReward_dialog`, Vexa's first open of the day) covers Home and the
tab tap finds nothing. The runner's `clearOverlays` dismisses that sheet
in the cold-start walk and in reads, but `signOutFlow` taps straight
through without it. Reproduced 2 of 2 on the iPhone after J08; on Android
the first attempt failed after J08 in 2 of 2 runs.

## Acceptance Criteria

### Happy path

- [x] The cause is measured on the phone and named in this story (the
      first plan, a dump around the gear tap, fitted the first guess; the
      cause was found from other recorded screens).
      Proof: the iPhone --debug run's screens (J08 ends on New Message; the
      failing step shows dailyReward_dialog) and the diagnostic trials'
      named paths on 9f9d01944ef ("tap target #main_profileTab not found"
      after the wait had seen it); both written up in Why and Notes.
- [x] The sign-out completes after J08 in 10 of 10 runs on the Android
      phone and on the iPhone: a reward sheet arriving mid-flow is dismissed
      and a tap it swallowed is made again.
      Proof: Android 10 of 10 real runs (2 more starts void before any
      journey: the recorder, SHY-0445), iPhone 10 of 10; J28R-GROUP green
      in all 20 (#2549 comment 6350793934).

### Error paths

- [x] When the next screen does not come, the step fails at its deadline
      naming the target, the taps, the screen, what was dismissed and the
      last tap error. A tap is made again only while the target is still
      on screen and never within 3 s of the last, so a slow screen is not
      tapped twice; never a silent retry.
      Proof: device-journey-signout-overlays.unit.test.js (never arriving,
      the 3 s rule, a tap that keeps throwing, an empty screen); mutants
      9/9 killed (#2549).

### Edge cases

- [x] A persona whose profile is still loading (gift wall, wallet) is
      covered.
      Proof: the 20 trials sign Vexa out and Alice or Theo in over loading
      profiles; the sheet-arrives-mid-flow unit tests.
- [x] A journey that ended inside a chat or room (no tab bar on screen)
      is covered: the flow reaches a tab bar before tapping a tab (today by
      restarting the app; without a restart is SHY-0703).
      Proof: all 20 trials took "no SignIn or Home on screen (...
      newMessage_searchField ...); restarted the app; signed out from Home";
      unit test "left on a screen with no tab bar".

### Performance

- [x] "Reach SignIn" after J08 is measured before and after on each
      phone. Removing the restart that J08's ending screen forces moved to
      SHY-0703 (2026-10-23).
      Proof: before, the iPhone failed 2 of 2 and Android's first attempt
      failed 2 of 2 (one journey red); after, Android 59.4-64.8 s and the
      iPhone 35.3-38.7 s, all completed (#2549 comment 6350793934).

### Security

- [x] Not applicable: test harness only.

### UX

- [x] Not applicable: test harness only (unless the cause is in the app,
      then this AC is rewritten).

### i18n

- [x] Not applicable: no copy.

### Observability

- [x] The Reach SignIn step now names the path it took, including any
      failure a restart rescued (9f9d01944ef); unit-tested.

### Runtime proof

- [x] The 10-run measurement on each phone, recorded.
      Proof: #2549 comment 6350793934.

## Announce

None: test harness only.

## BDD Scenarios

**Scenario: signing out after J08**

- **Given** J08 has left Vexa signed in on the phone
- **When** the next journey reaches SignIn
- **Then** one tap on the gear opens settings and the sign-out completes
  without a restart

## Test Plan

- Measure first on the phone (the cause is not known).
- A unit stand-in of whatever wait or check the fix adds.

## Out of Scope

- The persona picker's own timing (SHY-0491).

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** the cause is in the app (the gear not interactive while the
  profile loads). **Mitigation:** then it is a product bug: raise it with
  Shyden and move the fix to the app.

## Definition of Done

- [x] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.
      Proof: #2549 merged (3aa92471dd2); PR Checks run 39845960577 green by
      step name on head 1dd91dce14c.

## Notes

- **2026-10-23**: found during #2454's green runs on dev. Raised P2 -> P0 the
  same day: it blocks SHY-0645's (P0) J28R-GROUP green on the iPhone, and a
  blocker takes the top level of what waits on it.
- **2026-10-23, later**: the trials showed two causes, not one. The
  reward sheet arriving mid-flow (fixed here: each tap is driven until the
  next screen is there) and J08 ending on New Message with no tab bar,
  which forces a 20 s wait and an app restart. The restart path now
  completes; making it unnecessary is SHY-0703. ACs reworded to what was
  measured (the title's "first tap" was the first guess). Scored 2:
  measure on the phone, one harness change, two 10-run proofs.
