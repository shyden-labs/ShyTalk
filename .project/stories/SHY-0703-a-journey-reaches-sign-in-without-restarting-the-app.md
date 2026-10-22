---
id: SHY-0703
status: Draft
owner: claude
created: 2026-10-23
priority: P3
effort: S
estimate: 3
type: chore
roadmap_ids: []
mvp: true
epic: EPIC-0011
blocked_by: [SHY-0702]
---

# SHY-0703: a journey reaches sign-in without restarting the app

## User Story

As the developer, I want the journey runner to leave a screen with no tab
bar by going back, so that reaching sign-in after such a journey costs
seconds, not a 20-second wait and an app restart.

## Why

Measured on dev, 2026-10-23, both phones: J08 ends on the New Message
screen (no tab bar; on the iPhone with the keyboard up). The next journey's
"Reach SignIn" waits 20 s for SignIn or Home, gives up, force-stops and
relaunches the app, and only then signs out (37-67 s in all). SHY-0702 made
that path reliable; this story removes it. The two platforms differ: Android
has a system Back key (the runner already sends KEYCODE_BACK to close the
keyboard); the iPhone has none, so each screen's own Back or Close control
must be found.

## Acceptance Criteria

### Happy path

- [ ] From a screen with no tab bar, the runner goes back (Android: Back
      key; iPhone: the screen's tagged Back or Close control) until the tab
      bar shows, before any restart; a stated limit on steps.
- [ ] After J08, "Reach SignIn" signs out without a restart in 10 of 10 runs
      on each phone, and takes under 25 s.

### Error paths

- [ ] When going back does not reach a tab bar within the limit, the
      restart path runs as today and the step names why.

### Edge cases

- [ ] A screen with the keyboard up: the keyboard is put away first.
- [ ] A room screen (leaving it must not count as a quit that closes the
      room in a later journey's set-up): measured first.

### Performance

- [ ] Before and after: "Reach SignIn" durations after J08, 10 runs a phone.

### Security

- [x] Not applicable: test harness only.

### UX

- [x] Not applicable: test harness only.

### i18n

- [x] Not applicable: no copy; controls are found by tag.

### Observability

- [ ] The step detail names the path ("went back N times to Home; signed
      out from Home").

### Runtime proof

- [ ] The 10-run measurement on each phone, recorded.

## Announce

None: test harness only.

## BDD Scenarios

**Scenario: leaving New Message without a restart**

- **Given** J08 has left the phone on the New Message screen
- **When** the next journey reaches SignIn
- **Then** the runner goes back to the tab bar and signs out, with no
  restart

## Test Plan

- Unit stand-ins on a fake phone: each platform's back path; the limit;
  the keyboard; the fallback.
- The phones, 10 runs each.

## Out of Scope

- What J08 itself leaves behind (journeys may end anywhere).

## Dependencies

- SHY-0702 (the sign-out that survives the reward sheet).

## Risks & Mitigations

- **Risk:** Back on Android leaves the app entirely from a root screen.
  **Mitigation:** only from a screen that is not a tab root, and the tab
  bar is checked after each step.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-23**: split from SHY-0702 when its trials showed the sign-out
  fixed but the restart still needed after J08. P3: costs time, not
  correctness. Scored 3: two platform paths, unit stand-ins, two 10-run
  proofs.
