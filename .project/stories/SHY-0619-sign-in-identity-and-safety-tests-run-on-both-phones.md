---
id: SHY-0619
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

# SHY-0619: The sign-in, identity and safety phone tests run on Android and iPhone

## User Story

As the operator, I want the Android-only on-device tests of signing in,
identity, legal acceptance, age checks, warnings and navigation rewritten
as journeys that both phones run, so that the iPhone is held to exactly
what Android is.

## Why

Shyden's global rule (2026-10-16): every mobile test is one test, run on
Android and iOS. Shyden, for ShyTalk: _"yes rewrite them. fix it"_.

Measured on `origin/develop` `7936bd16e66`: these 11 files and 56 tests
run on Android only (Compose test rule with Koin fakes, in
`app/src/androidTest/java/com/shyden/shytalk`), and nothing like them
runs on the iPhone:

| File | Tests |
| --- | --- |
| `journey/AuthFlowTest.kt` | 8 |
| `journey/IdentityFlowTest.kt` | 5 |
| `journey/LegalAcceptanceTest.kt` | 3 |
| `journey/LinkedAccountsTest.kt` | 7 |
| `journey/AgeVerificationNavigationTest.kt` | 2 |
| `feature/ageverification/AgeVerificationSubmitScreenTest.kt` | 9 |
| `journey/CohortSurfaceTest.kt` | 5 |
| `journey/WarningAcknowledgmentTest.kt` | 3 |
| `feature/warning/WarningScreenStateTest.kt` | 3 |
| `journey/NavigationSmokeTest.kt` | 5 |
| `journey/SettingsNavigationTest.kt` | 6 |

## Acceptance Criteria

### Happy path

- [ ] Each of the 56 tests becomes a step-for-step journey case in the
      journey runner, run on both phones (SHY-0618) with real input, with
      the same assertions it makes today.
- [ ] Each Android-only file is deleted in the same PR that its journey
      cases land in, and comes off SHY-0617's burn-down list.

### Error paths

- [ ] A case one phone fails is a bug filed that day; it is never
      skipped or weakened on that phone.

### Edge cases

- [ ] What the Koin fakes stood in for (a banned user, an under-age
      date of birth, a pending warning) is set up through the dev or
      local backend with seeded personas, never inside the app.
- [ ] A case that cannot yet run on the iPhone stays as a marked
      stand-in with its harness story filed above it. It is never
      deleted.

### Performance

- [ ] The run time of the moved cases is measured on both phones and
      recorded.

### Security

- [ ] Age-segregation cases keep their adult and minor personas
      separate on both phones.

### UX

- [ ] Not applicable: no app change unless a case finds a bug.

### i18n

- [ ] Not applicable: no user-facing text changes.

### Observability

- [ ] The two-phone report lists each moved case by its old test name.

## BDD Scenarios

**Scenario: a moved sign-in test runs on both phones**

- **Given** the sign-in journey case that replaced `AuthFlowTest`
- **When** the runner walks it
- **Then** it passes on the Android phone and on the iPhone with the same assertions

**Scenario: the Android-only file is gone**

- **Given** the PR that moves `AuthFlowTest.kt`
- **When** the guards suite runs
- **Then** the file no longer exists and the burn-down list is one entry shorter

## Test Plan

- One journey case per old test (never a loop over them).
- A real two-phone run, recorded on the story.

## Out of Scope

- Rooms, chat, money and profile tests (SHY-0620).

## Dependencies

- SHY-0617 (guard) and SHY-0618 (two-phone runner) first.

## Risks & Mitigations

- 56 tests may be more than 13 points. The first three files are
  measured, and the rest is split if the pace says so.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; a two-phone run recorded.

## Notes

- **2026-10-16**: Filed for the "every mobile test is one test" rule.
  Estimate 13: 56 tests across 11 files, plus persona seeding for the
  states the fakes gave.
