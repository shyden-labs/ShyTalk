---
id: SHY-0661
status: Draft
owner: claude
created: 2026-10-21
priority: P0
effort: S
estimate: 2
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0661: The preview badge never hides a screen's top-right icons

## User Story

As a tester on a dev build, I want to see every icon a member would see, so
that what I test and screenshot matches the real screen.

## Why

Found on the SHY-0647 phone walk, 2026-10-20, on both phones: the red "ShyTalk
Preview" badge sits over the group chat's top-right search and menu icons
(`.superpowers/sdd/SHY-0647/walk-2026-10-20/ios-case3-small.png`).

Read on `develop` at 35526136fb9: `PreviewWatermark.kt` (shared, both phones)
aligns the badge `TopEnd` over every screen with a 4 dp inset. It has no click
handler, so taps reach the icons beneath, but the icons cannot be seen, and
every evidence screenshot loses them. Production builds draw no badge.

## Acceptance Criteria

### Happy path

- [ ] On every screen with top-bar actions, the badge leaves those icons
      visible on both phones, and still shows environment, build and the
      signed-in user's uniqueId.

### Error paths

- [x] Not applicable: no failure path.

### Edge cases

- [ ] The smallest supported phone width and the largest font scale still
      leave the icons visible.

### Performance

- [x] Not applicable.

### Security

- [ ] Production builds still draw no badge (the existing contract test).

### UX

- [ ] A check on each phone's group chat, room and profile screens shows the
      top-right icons and the badge together.

### i18n

- [x] Not applicable: no new copy.

### Observability

- [x] Not applicable.

## Announce

Dev builds only: the preview badge no longer covers the screen's icons.

## BDD Scenarios

**Scenario: icons stay visible on a dev build**

- **Given** Theo on a dev build opens a group chat
- **When** the screen draws
- **Then** the search and menu icons are visible beside the preview badge

## Test Plan

- The badge's existing UI contract tests, extended with placement.
- A phone check on both phones.

## Out of Scope

- What the badge says.

## Dependencies

- None.

## Risks & Mitigations

- A badge moved elsewhere hides something else: the UX AC checks three
  screens on both phones.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-21**: Filed from the SHY-0647 phone walk (finding 3, Polish, dev
  builds only). P0: a defect (every defect is P0). Not MVP: no launch user
  sees a preview build. Scored 2: one shared composable's placement, its
  contract test, a phone check.
