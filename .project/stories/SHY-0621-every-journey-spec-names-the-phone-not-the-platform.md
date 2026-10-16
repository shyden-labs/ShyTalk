---
id: SHY-0621
status: Draft
owner: claude
created: 2026-10-16
priority: P1
effort: L
estimate: 8
type: infra
roadmap_ids: []
mvp: false
---

# SHY-0621: Every journey spec is written once for both phones, and the dead Android specs go

## User Story

As the operator, I want every journey scenario written once for "the
phone", never for Android or iOS by name, so that every scenario is
walked on both phones and no spec silently covers one.

## Why

Shyden's global rule (2026-10-16): every mobile test is one test, run on
Android and iOS, never a separate test for each. Shyden, for ShyTalk:
_"yes rewrite them. fix it"_.

Measured on `origin/develop` `7936bd16e66`:

- `journey-tests/*.feature` (39 files, 571 scenarios): 218 scenarios are
  tagged for Android only (`@android-physical`, `@android-emulator`), 47
  for iPhone only (`@ios-sim`, `@ios-device`, `@ios-physical`), 15 for
  both, and 291 carry no phone tag. 374 steps say "on Android" or
  "Android's", and 87 say "iOS Sim" or "iOS Device".
- `journey-tests/_platform-handoffs.md` makes every step name its
  platform, and names `iOS Sim` as a driver, against the real-iPhone rule
  `ios-journey-device.js` follows.
- `app/src/androidTest/assets/features` (46 files, 233 scenarios) and its
  8 Cucumber step files never run: `ShyTalkTestRunner` is a plain
  `AndroidJUnitRunner`. One is `ios_parity_navigation.feature`.

## Acceptance Criteria

### Happy path

- [ ] The vocabulary in `_platform-handoffs.md` uses `the phone` (both
      phones, walked in parallel) for app steps; `Web` and `Web Admin`
      stay as they are.
- [ ] Every scenario's phone steps are rewritten to that vocabulary, and
      the one-phone tags are replaced by one `@phone` tag.
- [ ] Each scenario that two people play on two phones (for example j09,
      j11 and j17) is walked twice, with the phones swapped, so each
      phone plays each role.
- [ ] The 46 dead Android feature files and 8 step files are deleted.
      Any scenario in them that no journey spec covers is first moved
      into the matching `journey-tests` file.

### Error paths

- [ ] A scenario that truly needs one phone's own feature (for example
      the system share sheet) still runs on both phones, using each
      phone's equivalent. If one phone has no equivalent, Shyden decides,
      and the decision is written in the scenario.

### Edge cases

- [ ] `@manual` scenarios (10) follow the same rule, and their ledger
      entries record both phones.
- [ ] SHY-0030 (the `ios_parity_navigation.feature` freshness check) is
      closed as covered by this story, with a link.

### Performance

- [ ] Not applicable: specs only.

### Security

- [ ] Not applicable.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable: test specs are English-only.

### Observability

- [ ] `INDEX.md` shows, per journey, that both phones walk it.

## BDD Scenarios

**Scenario: a spec names the phone, not the platform**

- **Given** a journey scenario with an app step
- **When** the guards suite reads it
- **Then** the step says "the phone" and the scenario is tagged `@phone`

**Scenario: a two-person scenario is walked both ways**

- **Given** a scenario where a host and a guest are on two phones
- **When** the runner walks it
- **Then** it runs once with the host on Android and once with the host on the iPhone

## Test Plan

- SHY-0617's guard reads the specs and goes RED on any platform-named step.
- Each moved dead scenario is checked against its journey spec.

## Out of Scope

- Automating every spec in the runner (each journey's own story).

## Dependencies

- SHY-0617 (the guard) first.

## Risks & Mitigations

- The rewrite touches 571 scenarios, so the burn-down list carries the
  rest of the specs while each file is converted in its own commit.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-16**: Filed for the "every mobile test is one test" rule.
  Estimate 8: a mechanical vocabulary rewrite over 39 files, a design
  pass for the two-person scenarios, and the deletion of the dead specs.
