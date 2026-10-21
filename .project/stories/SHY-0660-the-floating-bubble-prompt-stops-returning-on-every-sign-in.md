---
id: SHY-0660
status: Draft
owner: claude
created: 2026-10-21
priority: P0
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0660: The floating-bubble prompt stops returning on every sign-in

## User Story

As an Android member who said "Not now" to the "Display over other apps"
prompt, I want the app to remember my answer, so that I am not asked the same
question every time I sign in.

## Why

Found on the SHY-0647 phone walk, 2026-10-20 (Android, OnePlus CPH2653,
0.99.0-b383): the floating-bubble prompt returned on every sign-in.

Cause, read on `develop` at 35526136fb9: `NavGraph.kt` runs its permission
block after sign-in and sets `showOverlayDialog = true` whenever
`Settings.canDrawOverlays` is false (about line 467); "Not now" only sets
`showOverlayDialog = false` (about line 496) and records nothing. This prompt
is the app's only way to the permission (`RoomService.kt` checks it, nothing
else asks), so remembering "Not now" for ever would leave no way to turn the
bubble on inside the app. Android only: iPhone has no such permission.

## Acceptance Criteria

### Happy path

- [ ] "Not now" is remembered on the device; signing in again does not show
      the prompt.
- [ ] After "Not now", the prompt is offered once more, the first time the
      member leaves a live room while the permission is off, and never
      again after that (Shyden, 2026-10-21: "Room exit + Settings").
- [ ] Settings has a "Floating bubble" switch showing whether the
      permission is on; tapping it opens Android's "Display over other
      apps" page for ShyTalk.

### Error paths

- [ ] A failed write of the remembered answer leaves the prompt behaving as
      today and is logged on the device; it never blocks sign-in.

### Edge cases

- [ ] Granting the permission from the system settings hides the prompt for
      good, as today.
- [ ] Signing in as another account on the same phone keeps the same answer
      (the permission belongs to the phone, not the account).

### Performance

- [x] Not applicable: one local read at sign-in.

### Security

- [x] Not applicable: a local preference, no account data.

### UX

- [ ] A member who said "Not now" can still turn the bubble on from inside
      the app.

### i18n

- [ ] The Settings switch's label and description exist in every shipped
      locale, each line read back by Google Cloud Translation before it is
      committed.

### Observability

- [ ] The device log records the prompt shown, granted and declined.

## Announce

Android no longer asks about the floating bubble every time you sign in.

## BDD Scenarios

**Scenario: "Not now" is remembered**

- **Given** Alice declined the floating-bubble prompt
- **When** she signs out and in again
- **Then** the prompt does not appear

## Test Plan

- Unit tests for the remembered answer (a fake store): declined, granted,
  failed write.
- A phone check on Android.

## Out of Scope

- The bubble itself (`RoomService`).

## Dependencies

- None.

## Risks & Mitigations

- Hiding the only way in: the UX AC keeps one.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; checked on the Android phone on dev.

## Notes

- **2026-10-21**: Filed from the SHY-0647 phone walk (finding 8, Minor,
  Android). P0: a defect (every defect is P0). MVP: every Android member
  meets it at sign-in. Scored 2: one stored preference, the prompt's
  condition, unit tests, a phone check; rises if the chosen re-offer needs a
  new screen.
- **2026-10-21**: Shyden chose "Room exit + Settings" over a Settings
  switch alone or the room-exit offer alone: ask once on leaving a live
  room, and add a Settings switch. Rescored 3 for the new Settings row and
  its copy in every locale.
