---
id: SHY-0617
status: Draft
owner: claude
created: 2026-10-16
priority: P1
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
---

# SHY-0617: A guard keeps Android and iPhone on exactly the same phone tests

## User Story

As the operator, I want a guard that fails whenever a phone test exists
for one phone only, so that Android and iPhone can never drift apart
again.

## Why

Shyden's global rule (2026-10-16, relayed by shyden-co-uk-96, read in
`~/.claude/CLAUDE.md` and `reference-branching-and-deploy.md`): _"Treat it
as every mobile test is mobile. this means if it's mobile, it's Android AND
iOS. not separate tests for each. Global rule. ... make sure this can never
happen again."_ For ShyTalk, Shyden's answer the same day: _"yes rewrite
them. fix it"_.

Measured on `origin/develop` `7936bd16e66` (2026-10-16):

- **Android on-device suite**: 22 files and 103 `@Test` methods under
  `app/src/androidTest/java` (run in `e2e-tests.yml` by
  `connectedLocalDebugAndroidTest`). The iPhone has no on-device
  counterpart: `iosApp/iosAppUITests` holds only
  `ManualQARemoteControl.swift`.
- **Journey runner** (`express-api/scripts/device-journey-runner.js`): 12
  automated journeys, one definition and two device backends (SHY-0396),
  but one phone per run.
- **Journey specs** (`journey-tests/*.feature`, 39 files, 571 scenarios):
  218 scenarios are tagged for Android only, 47 for iPhone only, 15 for
  both and 291 carry no phone tag; 374 steps name "Android" and 87 name
  "iOS Sim" or "iOS Device".
- **Dead Android specs**: `app/src/androidTest/assets/features` (46 files,
  233 scenarios) and 8 Cucumber step files never run, because
  `ShyTalkTestRunner` is a plain `AndroidJUnitRunner`.
  `ios_parity_navigation.feature` is named for one platform.

## Acceptance Criteria

### Happy path

- [ ] A guard in the `guards` suite reads, from the filesystem, every
      phone test each phone runs, and fails unless the two sets are equal
      in both directions (Android minus iPhone empty, iPhone minus Android
      empty).
- [ ] It fails on any phone test file, journey or scenario whose name or
      tag names one platform (`android`, `ios`, `iphone` in any case),
      and on any journey step gated to one phone (for example an
      `opts.platform === 'ios'` branch that skips a step).
- [ ] Today's one-phone tests sit in a burn-down list that can only
      shrink; a new one-phone test is RED at once.

### Error paths

- [ ] A file it cannot parse fails the guard (fail closed) and names
      the file.

### Edge cases

- [ ] The population is inside the verdict (`searched(...)`), with a
      recorded floor checked in its own test and an independent
      per-file cross-check, per `reference-guard-forms-and-floors.md`.
- [ ] Mutation-verified: a planted Android-only test, a planted
      iPhone-only test, a platform-named file and a gated step are each
      seen RED, and so are the floor's loss and growth.
- [ ] Unit tests of code that exists on one phone only (Kotlin in
      `app/src/test`, Swift bridges in `iosApp/iosAppTests`) are unit
      tests, not phone tests. The guard says so in its scope, and Shyden
      confirms that line when the PR is reviewed.

### Performance

- [ ] The guard's measured time is its CI step's limit; it is not a unit
      test.

### Security

- [ ] Not applicable: the guard reads only tracked source.

### UX

- [ ] Not applicable: no app change.

### i18n

- [ ] Not applicable: no user-facing text.

### Observability

- [ ] The guard prints each phone's count and the burn-down remainder on
      every run.

## BDD Scenarios

**Scenario: a test only Android runs is refused**

- **Given** a phone test that the iPhone does not run and that is not on the burn-down list
- **When** the guards suite runs
- **Then** it fails and names the test and the phone that lacks it

**Scenario: the burn-down list shrinks**

- **Given** a test on the burn-down list that now runs on both phones
- **When** the guards suite runs
- **Then** it fails until that test is removed from the list

## Test Plan

- The guard's own tests, one per planted case, each seen RED.
- Its floor in its own test.

## Out of Scope

- Moving the tests themselves (SHY-0619, SHY-0620, SHY-0621).

## Dependencies

- Lands first, so the burn-down list measures SHY-0618 to SHY-0621.
- repo-template carries the same guard (filed there by shyden-co-uk-96).

## Risks & Mitigations

- The burn-down list starts long (103 tests, 12 journeys, 265 one-phone
  scenarios). It is a ratchet, so it can only shrink.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-16**: Filed for Shyden's global "every mobile test is one
  test" rule. Estimate 5: one guard over three populations, its floor,
  burn-down list and mutations. P1 because Shyden asked for it directly.
