---
id: SHY-0615
status: Draft
owner: claude
created: 2026-10-16
priority: P3
effort: L
estimate: 13
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0615: The Android and iOS apps keep a log, the same way every project does

## User Story

As the operator, I want the Android and iOS apps to keep a log of what they
did and what went wrong, kept where the shared `repo-template` design says,
so that a user's problem can be found after it happens, the same way in
every project.

## Why

Shyden's global rule (2026-10-16): every application we build keeps a log,
and its logging is tested. Amended the same day: the log comes AFTER each
project's release, never blocks it, and is designed once in `repo-template`
so every project does it the same way.

Measured on `origin/develop` `158d84d7812` (2026-10-16):

- Both apps log through `shared/.../core/util/Logger.kt` (`logD`..`logF`).
  On Android that is `android.util.Log` (logcat); on iOS it is the unified
  log (`IosLogSink`, `os_log` from Swift, `NSLog` fallback).
- Those device logs are a ring buffer, wiped within hours, and read only
  with the phone attached to a Mac. Neither Shyden nor the user can see a
  log after a problem.
- `shared/.../data/remote/LogService.kt` (`shipLogs`, `sendDeviceInfo`,
  `fetchLogConfig`) was added in 2025 and has no implementation and no
  caller in shipped code. Only `LogServiceTest.kt` names it.
- The website and admin panel already send logs to ShyTalk's own server
  (`public/js/logger.js` to `POST /api/logs`).

Where the phones' log is kept is Shyden's call. He parked it on 2026-10-16
(_"park this for now. we are going to have a big research piece and decide
for every project and the template"_), so this story adopts that decision
once it is made and does not choose a store itself.

## Acceptance Criteria

### Happy path

- [ ] The apps adopt the `repo-template` logging design as it lands: the
      same module shape, levels, fields and store.
- [ ] Every line `Logger.kt` writes today reaches the chosen log, on Android
      and iOS alike.
- [ ] An uncaught crash is in the log with its stack trace.

### Error paths

- [ ] When the log store cannot be reached or is full, the app keeps
      working and the loss is counted, never silent.

### Edge cases

- [ ] `LogService.kt` is either implemented by the design or deleted; no
      empty interface is left behind.
- [ ] A log written while offline is not lost when the app restarts.

### Performance

- [ ] Logging adds no visible delay: measured cold start and scroll frame
      times before and after, no regression.

### Security

- [ ] No password, token, message text or other personal content reaches
      the log; a test plants each one and watches it stripped.
- [ ] Nothing leaves the phone unless Shyden has approved that store.

### UX

- [ ] Any screen the design adds (for example viewing or copying the log)
      matches the app's design system on both platforms.

### i18n

- [ ] Any new user-facing text is translated in every app locale and read
      back by Google Cloud Translation before it is shown.

### Observability

- [ ] The log's checks run in the `logs` suite (SHY-0613); unit keeps fast
      stand-ins.
- [ ] Android and iOS run the same tests: same steps, same strictness.

## BDD Scenarios

**Scenario: an error is kept after the app closes**

- **Given** the app logs an error
- **When** the user closes and reopens the app
- **Then** the error is still in the log

**Scenario: a secret never reaches the log**

- **Given** a log line carrying a token
- **When** it is written
- **Then** the kept line has no token

## Test Plan

- Unit stand-ins in `shared` (commonTest) and `iosAppTests` for the module.
- `logs` suite checks for the store, on both platforms.
- Journey: cause an error on a real phone, then find it in the log.

## Out of Scope

- Choosing the log store (Shyden's call, through the `repo-template`
  research).
- The server and website logs, which already exist.

## Dependencies

- The `repo-template` logging design (held by the Yawelo Idle session,
  2026-10-16). Not a ShyTalk ticket, so it is not in `blocked_by`.
- SHY-0613 (the `logs` suite) is where its checks run.
- Comes after the release; it blocks no release story.

## Risks & Mitigations

- Logs about a minor's use could leave the phone. Mitigation: nothing is
  sent anywhere Shyden has not approved, and the security ACs strip
  content.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; journey green on dev on both platforms.

## Notes

- **2026-10-16**: Filed for the global "every app logs" rule. Estimate 13
  is a guess until the template design exists: two platforms, a store and
  their tests. P3 because it follows the release.
