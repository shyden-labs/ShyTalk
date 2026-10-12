---
id: SHY-0549
status: Draft
owner: claude
created: 2026-10-08
priority: P0
effort: L
estimate: 8
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0549: Every Kotlin and Swift unit test runs in under one second, with its dependencies mocked

## User Story

As a developer, I want the Android, shared-Kotlin and iOS unit tests to run
under a 1 s per-test limit that nothing can raise, with no real service behind
them, so that the app's unit suites are as fast and honest as the backend's.

## Why

The same global rules as SHY-0546 and SHY-0548 (operator 2026-10-07 and
2026-10-08): every unit test runs in under 1 s, a new test over 1 s is a
defect the day it is written, a test cut to fit lands at or under 0.3 s of its
own CPU (decision B), the limit is judged with coverage off (decision A), and
a unit test never reaches a real service.

Measured 2026-10-08 on develop `4b94b70`. The run was `./gradlew
testDevDebugUnitTest :shared:jvmTest :shared:testAndroidHostTest --continue
--no-build-cache`, without the jacoco report task: BUILD SUCCESSFUL, 0
failures, per-test times read from the JUnit XML.

- **4,836 tests:** `app:testDevDebugUnitTest` 2,277, `shared:jvmTest` 1,818,
  `shared:testAndroidHostTest` 741. Their summed time is 66.1 s.
- **7 over 1 s, in 6 classes:**
  - `RoomViewModelTest`: `room expiry - does not send system message` 10.011 s
    and `room expiry - shows countdown when under 5 minutes` 10.007 s. A
    near-exact 10 s points to a real-time wait.
  - `AndroidPushPermissionTest`: `notifyPushPermissionPromptedInternal API 33
    authorises when granted`, 3.054 s.
  - `CropContractTest`: `parseResult returns null when intent has no uri
    extra`, 2.364 s.
  - `AuthViewModelTest`: `init - not authenticated stays default`, 2.071 s.
  - `DeviceSecurityCheckerTest`: `isUnsafe returns true when rooted`,
    1.354 s.
  - `StickerStorageTest`: `updateStickerUrl stores URL and getStickers returns
    it`, 1.173 s.
  - Several are the first test in a Robolectric class, so class start-up may
    be part of the time; the first AC measures this.
- **18 tests are over 0.3 s** of wall time.
- **The limit today: none.** JUnit 4.13.2 (135 files) and `kotlin.test` (126
  files) set no per-test limit. No test raises one either: 0 of 1,510
  `runTest` calls pass a timeout, and there is no `@Test(timeout=…)`,
  `Timeout` rule or `@Timeout`.
- **Swift:** `iosApp/iosAppTests` holds 9 XCTest files. CI runs them only
  inside the simulator "iOS E2E" job, so whether each is a unit test is not
  yet measured.

**Not measured:** per-test CPU for Kotlin and Swift, and whether any Kotlin or
Swift unit test opens a network connection. The first ACs measure both.

## Acceptance Criteria

### Happy path

- [ ] Per-test CPU is measured for all 4,836 Kotlin tests (for example, a
      JUnit `RunListener` reading the thread's CPU time), and every outgoing
      connection is recorded. The figures in Why are updated, including how
      much of each slow first-in-class time is Robolectric start-up.
- [ ] Each Kotlin unit test task runs under a 1 s per-test limit, judged with
      coverage off, applied to every test without a per-test opt-in (for
      example, a JUnit 4 `RunListener` or global rule added through the Gradle
      test configuration). It is proved by a planted 1.2 s test failing.
- [ ] Each of the 7 tests over 1 s, and any over 0.3 s of CPU, has its WORK
      cut to at or under 0.3 s of CPU (for example, virtual time in place of
      the real 10 s expiry wait, or a shared Robolectric fixture). Before and
      after are recorded in Notes.
- [ ] The 9 Swift test files are classified: those that need no simulator UI
      or service run as XCTest unit tests under a 1 s limit
      (`-test-timeouts-enabled YES` with a 1 s default), and the rest are
      named as E2E in Notes.

### Error paths

- [ ] A guard refuses any raised limit in Kotlin tests, read from the parse
      tree with planted forms: `@Test(timeout = …)`, a `Timeout` rule,
      `runTest(timeout = …)`, `withTimeout` above 1 s wrapping a test body, a
      Gradle `timeout`, and the `kotlinx.coroutines.test.default_timeout`
      property. Each form is planted and seen RED.
- [ ] A unit-test setup refuses any connection outside the test process
      (Robolectric and JVM), failing the test by name, proved RED by a planted
      connection.

### Edge cases

- [ ] `runTest`'s own virtual-time timeout is not mistaken for a real-time
      limit. A test using `advanceTimeBy` for a long virtual delay stays
      allowed and fast.

### Performance

- [ ] Each Gradle unit task's time and the summed per-test time (66.1 s
      before) are recorded before and after.

### Security

- [ ] `DeviceSecurityCheckerTest` (root detection) keeps every assertion
      after its cut.

### UX

- [ ] Not applicable: no user-facing surface changes.

### i18n

- [ ] Not applicable: no copy changes.

### Observability

- [ ] Each unit task prints its 10 slowest tests with wall and CPU.

## BDD Scenarios

**Scenario: A new slow Kotlin unit test fails the day it is written**

- **Given** a new JVM unit test that waits 1.2 s in real time
- **When** the unit task runs
- **Then** it fails on the 1 s limit, naming the test

**Scenario: A raised Kotlin limit cannot come back**

- **Given** a pull request adding `@Test(timeout = 5000)`
- **When** the guard runs
- **Then** it fails naming the file and line

**Scenario: The room-expiry test runs on virtual time**

- **Given** the room-expiry countdown tests
- **When** they run
- **Then** each finishes under 0.3 s of CPU with every assertion kept

## Test Plan

- The three Gradle unit tasks with the CPU listener, three times, plus CI.
- Each planted form RED against the guard and the limit, then removed.
- An XCTest run of the classified Swift unit tests under the 1 s default.

## Out of Scope

- The backend Jest suite (SHY-0546, SHY-0547, SHY-0548).
- Android instrumented and iOS UI tests: they are device suites with one
  measured limit at their CI step.

## Dependencies

- SHY-0544 (the PR gate includes the backend step, so no PR can be green
  until it lands). Operator order 2026-10-08: SHY-0544 first.

## Risks & Mitigations

- **JUnit 4 has no built-in global timeout.** Mitigation: a `RunListener`
  or a Gradle-level wrapper, proved by a planted slow test before any cut.
- **The Swift tests are tied to the simulator build.** Mitigation: classify
  first; any that cannot run without the simulator are named as E2E, not
  bent to fit.

## Definition of Done

- [ ] Every AC ticked with its proof; every Kotlin unit test under 1 s with
      its CPU at or under 0.3 s where cut; guards mutation-verified; merged to
      `develop`.

## Notes

- **2026-10-08**: Filed with SHY-0546, SHY-0547 and SHY-0548 from the global
  1 s rule. Until this lands, every agent brief in ShyTalk says a new unit
  test over 1 s is a defect the day it is written.
- Scored 8: 7 slow tests (two share one fix), a new limit mechanism with no
  built-in support in JUnit 4, CPU and connection recorders, one guard, and
  the Swift classification.
