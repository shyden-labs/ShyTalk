---
id: SHY-0546
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

# SHY-0546: The unit suite starts no service; tests that need one run as integration tests

## User Story

As a developer, I want the unit suite to test logic with its dependencies
mocked, and every test that needs a real emulator, store, mail server or the
internet to run in the integration suite, so that unit tests are fast and
honest about what they test, and real-service coverage still runs in CI.

## Why

Operator rule, 2026-10-08, global: *"unit tests shouldn't do this. this is
what mocks are for. we should use this only for other kinds of tests. I.E.
integration, e2e, journeys etc. but not for unit tests."* It agrees with
EPIC-0003's policy (operator 2026-06-17: *"the only thing I will allow fakes or
mocks is the unit tests"*). What EPIC-0003 never did is move the real-service
tests out of the one Jest run that `local/test-unit.sh` and `test-backend.yml`
treat as the unit suite.

Measured 2026-10-08 on develop `4b94b70`: the whole express-api Jest suite (543
files, 15,481 tests) was run with a setup file wrapping
`net.Socket.prototype.connect`. That wrapper records each outgoing connection
and the file it came from, and a known positive was checked first:
`tests/cron/backups.test.js` reached `localhost:8080` and `localhost:9002`.

- **63 files (1,016 tests) reach a real service.** Firestore emulator 63, Auth
  emulator 18, RTDB emulator 14, MinIO 6, Mailpit 1. By folder: `routes` 30,
  `cron` 14, `firestore-rules` 5, `safety` 5, `middleware` 5, `scripts` 2,
  `helpers` 1, `unit` 1.
- **3 files call the public internet** (`ip-api.com:80`) during the test:
  `tests/middleware/auth-ban-gate.test.js`, `tests/routes/device-info.test.js`
  and `tests/routes/ban-status.test.js`.
- **5 files named as unit tests reach the emulators**:
  `tests/routes/room-lifecycle-errors.unit.test.js`,
  `room-presence-errors.unit.test.js`, `room-seats-errors.unit.test.js`,
  `rooms-fcm.unit.test.js` and `tests/unit/ban-status.unit.test.js`.
- **480 files (14,465 tests) reach none.** Loopback connections to random
  ports are supertest's in-process server, so they are not counted.
- The cause is `express-api/src/utils/firebase.js:28-30`: under test it points
  Firestore, Auth and RTDB at the emulator ports, so any file that loads a route
  without mocking Firebase becomes an integration test.
- Only 43 of the 543 files carry the SHY-0112 unit naming
  (`*.unit.test.js` or `tests/unit/**`), so the file name cannot tell the two
  tiers apart today.

**Not measured:** connections opened by child processes (the `tests/scripts`
files that spawn shell scripts). The first AC measures them.

## Acceptance Criteria

### Happy path

- [ ] Connections from child processes that tests spawn are measured too (for
      example, by running the suite with no network and the emulators stopped,
      then reading every failure). The population in Why is updated with them.
- [ ] Each of the 63 files (plus any the AC above adds) is either rewritten as
      a unit test with its dependencies mocked, or moved to the integration
      tier. The choice for each file, and why, is recorded in Notes. The test
      count in the two tiers together is never less than 15,481 minus the
      tests a move deliberately merges, each one named.
- [ ] The integration tier is its own Jest project (or config) with its own
      CI step, which starts the emulators, the S3 stand-in and Mailpit.
      `test-backend.yml` and every workflow that runs the suite run both
      tiers, and the required checks include both.
- [ ] The unit tier's CI step and `local/test-unit.sh` start no emulator and
      no container. `local/test-unit.sh` runs only the unit tier, and a new
      `local/test-integration.sh` (and `.ps1`) runs the other.
- [ ] The three `ip-api.com` files stop calling the internet. The call is
      mocked in a unit test; if real lookup coverage is still needed, it
      becomes an integration test against a local stand-in, never the public
      service.

### Error paths

- [ ] A unit-tier setup file refuses any connection to a host outside the
      test process (every emulator, MinIO and Mailpit port, and any
      non-loopback host). The test that tried it fails by name, giving the
      target. No retry and no warning-only mode.

### Edge cases

- [ ] supertest's in-process server (loopback, a port the test process itself
      opened) is still allowed. A connection to a loopback port the test
      process did not open is refused.
- [ ] Every form the guard refuses is planted and seen RED, run against the
      setup file itself: `net.connect`, `new net.Socket().connect`,
      `http.request`, `https.request`, `fetch`, `tls.connect`, the
      firebase-admin client (gRPC over HTTP/2) and the S3 client.

### Performance

- [ ] The unit tier's wall time and the integration tier's are recorded
      before and after. Measured before (summed per-test wall, with coverage):
      unit 804.9 s, integration 140.6 s.

### Security

- [ ] No test sends a request to a third party (ip-api.com today). The guard
      makes this structural for the unit tier, and an integration-tier check
      refuses any non-loopback host too.

### UX

- [ ] Not applicable: no user-facing surface changes.

### i18n

- [ ] Not applicable: no copy changes.

### Observability

- [ ] Each tier's report (the `express-report-pages` artifact) says which tier
      it is, with its own test count.

## BDD Scenarios

**Scenario: A unit test that reaches the emulator fails by name**

- **Given** a unit-tier test that loads a route without mocking Firebase
- **When** the unit tier runs with the emulators stopped
- **Then** that test fails, naming `localhost:8080` as the refused target

**Scenario: Real-service coverage still runs**

- **Given** a test moved to the integration tier
- **When** CI runs on a pull request
- **Then** the integration step starts the services and the test passes there

**Scenario: The in-process server is still allowed**

- **Given** a unit test using supertest against an in-process app
- **When** the unit tier runs
- **Then** the test passes with no refusal

**Scenario: No test calls the internet**

- **Given** the device-info and ban-status tests
- **When** either tier runs
- **Then** no connection to `ip-api.com` or any other public host is made

## Test Plan

- Re-run the connection measurement (the recorder described in Why) on the
  branch: the unit tier shows zero service connections and the integration
  tier shows the moved files.
- Plant each form listed in Edge cases in a scratch unit test and watch each
  one go RED, then remove it.
- Both tiers green on the PR, every step read by name.

## Out of Scope

- The 1 s limit and cutting slow tests (SHY-0548), the retry (SHY-0547) and
  the Kotlin and Swift suites (SHY-0549).
- Changing what the integration tests check. They move; their assertions stay.

## Dependencies

- SHY-0544 (backend CI cannot start until the S3 stand-in is replaced).
  Operator order 2026-10-08: SHY-0544, then this story.

## Risks & Mitigations

- **A mocked rewrite tests less than the real one did.** Mitigation: default
  to moving a file to integration. Rewrite as a unit test only where the
  file's purpose is logic, and keep a real-service test of the same behaviour
  in the integration tier.
- **The child-process connections are many.** Mitigation: measured first (the
  first AC); if they push the work past 8 points, the story is split before
  work starts.

## Definition of Done

- [ ] Every AC ticked with its proof; both tiers green in CI by step name;
      merged to `develop`; Notes hold the per-file decisions.

## Notes

- **2026-10-08**: Filed from the global 1 s unit-test rule (relayed from the
  shyden.co.uk session) and the operator's ruling the same day that unit tests
  never reach real services. Part of a set: SHY-0546 (this), SHY-0547 (no
  retry), SHY-0548 (Jest 1 s limit), SHY-0549 (Kotlin and Swift 1 s limit).
  Operator order: SHY-0544 first, then these.
- Scored 8: 63 files to classify and move or rewrite, a new Jest project and
  CI step, two local scripts, one guard with eight planted forms.
