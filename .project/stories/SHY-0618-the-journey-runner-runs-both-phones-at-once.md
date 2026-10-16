---
id: SHY-0618
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

# SHY-0618: The journey runner runs every journey on Android and iPhone at once

## User Story

As the operator, I want one run of the journey runner to walk every
journey on an Android phone and an iPhone in parallel, through the same
steps and the same assertions, so that a difference between the phones
shows up as a failing step.

## Why

Shyden's global rule (2026-10-16): every mobile test is one test, run on
Android and iOS, in parallel. Shyden, for ShyTalk: _"yes rewrite them. fix
it"_.

Measured on `origin/develop` `7936bd16e66`:
`express-api/scripts/device-journey-runner.js` already has one journey
definition and two device backends (SHY-0396): `adb` on Android, and
Appium XCUITest real taps on a real iPhone
(`drivers/ios-journey-device.js`). It has 12 journeys (J02, J04, J05, J06,
J07, J08, J09, J11, J12, J38, J39, J40), but `--platform` picks ONE phone
per run, and five `opts.platform` branches change behaviour per phone.

## Acceptance Criteria

### Happy path

- [ ] With no `--platform`, one run drives both phones in parallel, and
      each journey's result is reported per phone.
- [ ] `--platform` is removed (or only narrows a local debugging run, and
      such a run cannot be recorded as a pass).
- [ ] Every one of the 12 journeys passes on both phones, or its failing
      step is filed as a bug that day.
- [ ] Real input on both phones: `adb` input on Android, XCUITest taps on
      the iPhone; nothing is dispatched inside the app.

### Error paths

- [ ] A step one phone cannot take fails loudly with the phone and step
      named. It is never skipped.
- [ ] One phone failing does not stop the other phone's walk.

### Edge cases

- [ ] Each `opts.platform` branch is either removed or limited to device
      plumbing (install, port forwarding), with a comment saying why. No
      branch changes what is asserted.
- [ ] Personas cannot clash between the two parallel walks: each phone
      signs in as its own persona copy.

### Performance

- [ ] The wall time of one two-phone run is measured and recorded, next
      to the two single-phone runs it replaces.

### Security

- [ ] Not applicable: dev and local targets only, as today.

### UX

- [ ] Not applicable.

### i18n

- [ ] `JOURNEY-RUNNER.md` and its 19 translations describe the two-phone
      run, each read back by Google Cloud Translation.

### Observability

- [ ] The report shows both phones side by side per journey, with the
      screen recordings.

## BDD Scenarios

**Scenario: one run walks both phones**

- **Given** an Android phone and an iPhone connected
- **When** the runner starts with no platform flag
- **Then** every journey runs on both phones at once and the report shows each phone's result

**Scenario: a step one phone cannot take fails**

- **Given** a journey step the iPhone cannot take
- **When** the runner reaches it on the iPhone
- **Then** the iPhone's walk fails naming the step, and the Android walk carries on

## Test Plan

- Unit tests of the scheduling and reporting (no device, no process).
- One real two-phone run, recorded on the story.

## Out of Scope

- Moving the Android on-device tests in (SHY-0619, SHY-0620).

## Dependencies

- SHY-0617 lands first (guard and burn-down list).

## Risks & Mitigations

- One machine drives two phones at once. Run time and CPU are measured
  before the parallel mode becomes the default.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; one real two-phone run recorded.

## Notes

- **2026-10-16**: Filed for the "every mobile test is one test" rule.
  Estimate 8: parallel scheduling, per-phone reporting, removing the five
  platform branches, persona separation, and one real run.
