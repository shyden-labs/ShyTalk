---
id: SHY-0702
status: Draft
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

- [ ] The cause is measured on the phone (a dump and screenshot just
      before and after the gear tap, with the time since the profile tab
      was tapped) and named in this story.
- [ ] The sign-out opens settings on its first tap in 10 of 10 runs after
      J08 on the Android phone, and on the iPhone.

### Error paths

- [ ] When settings does not open, the step fails naming what was on
      screen after the tap, never a silent retry.

### Edge cases

- [ ] A persona whose profile is still loading (gift wall, wallet) is
      covered.
- [ ] A journey that ended inside a chat or room (no tab bar on screen)
      is covered: the flow reaches a tab bar before tapping a tab.

### Performance

- [ ] "Reach SignIn" from a signed-in persona is measured before and after;
      the fallback restart is not needed in the 10 runs.

### Security

- [x] Not applicable: test harness only.

### UX

- [x] Not applicable: test harness only (unless the cause is in the app,
      then this AC is rewritten).

### i18n

- [x] Not applicable: no copy.

### Observability

- [x] Not applicable: the runner's report already names the step.

### Runtime proof

- [ ] The 10-run measurement on each phone, recorded.

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

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-23**: found during #2454's green runs on dev. Raised P2 -> P0 the
  same day: it blocks SHY-0645's (P0) J28R-GROUP green on the iPhone, and a
  blocker takes the top level of what waits on it. Scored 2:
  measure on the phone, one harness change, two 10-run proofs.
