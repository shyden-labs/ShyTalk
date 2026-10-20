---
id: SHY-0662
status: Draft
owner: claude
created: 2026-10-21
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0662: No shared or distributed build carries the dev persona password

## User Story

As the operator, I want the shared password of the seeded dev accounts to
stay off every build anyone else can download, so that nobody can sign in to
the dev admin and test accounts from a copy of the app.

## Why

Shyden ruled on 2026-10-20 that NO distributed tester build (TestFlight or App
Distribution) carries the dev persona password; phone tests use local builds
of the exact commit (`project-no-tester-build-carries-persona-password`).

Measured 2026-10-20/21 on `develop` at 35526136fb9:

- `app/build.gradle.kts` bakes `DEV_QA_PERSONAS_PASSWORD` into the `dev`
  flavour's `BuildConfig` from the env or a Gradle property.
- `pr-checks.yml`, step "Run unit tests, compile androidTest, detekt, and
  build devRelease APK", passes the secret, and step "Upload devRelease APK"
  uploads it as the `dev-release-apk` artifact with the default retention.
  **This repository is public**, so any signed-in GitHub user can download
  that APK and read the password out of it. 353 such artifacts existed on
  2026-10-21; the newest (2026-10-20 06:12Z) predates the rotation (seed run
  39446597762, 15:14Z), so each holds a retired password that dev now
  refuses. The NEXT code PR that runs this step publishes the current one.
- `deploy-dev.yml` passes the secret to "Build devRelease APK" (the App
  Distribution build, or reuses the PR's artifact) and to the iOS build step,
  which never hands it to `xcodebuild` (dead config; the TestFlight IPA has
  none by design).

The seeded personas include P-12, the dev admin.

## Acceptance Criteria

### Happy path

- [ ] No workflow passes `DEV_QA_PERSONAS_PASSWORD` to a step that builds
      an app (Android or iOS); the seeding and runner steps that sign in over
      the API keep it.
- [ ] Local builds keep the persona picker (`:app:installDevDebug`,
      `scripts/ios/build-debug-dev.sh`, the password from
      `~/.shytalk/dev-personas.env`).

### Error paths

- [ ] A CI step after each Android build proves the built APK does not hold
      the secret's value (it reads the secret in its own step, prints only
      found or not found), and goes RED on a planted APK that holds it.

### Edge cases

- [ ] The `dev-release-apk` artifact gets an explicit short retention.
- [ ] The persona picker in a CI-built or distributed dev build shows its
      existing "no test-persona credential" state, on both phones.

### Performance

- [x] Not applicable.

### Security

- [ ] A workflow test fails if any app-building step's env names the
      secret (one test per workflow file), each seen RED on today's files
      first.

### UX

- [x] Not applicable: testers already sign in through local builds.

### i18n

- [x] Not applicable: no new copy.

### Observability

- [ ] The APK check's step summary names the APK it read and its size, so
      an empty read cannot pass.

## Announce

Not announced: an internal safety fix.

## BDD Scenarios

**Scenario: a PR's APK carries no credential**

- **Given** a pull request that changes the Android app
- **When** CI builds and uploads the devRelease APK
- **Then** the APK does not contain the persona password and the check says
  which APK it read

## Test Plan

- Workflow tests in the repo's workflow test suite, one per workflow file.
- The APK check in CI, mutation-verified with a planted APK.

## Out of Scope

- Rotating the password again: today's value is in no published artifact.

## Dependencies

- None. It must merge BEFORE any other code PR runs PR Checks, or that PR
  publishes the current password.

## Risks & Mitigations

- A journey or e2e job relied on the picker in the CI-built APK: each job is
  read before the env goes; any that did signs in another way or uses the
  local build.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-21**: Filed from Shyden's 2026-10-20 ruling and the phone walk
  (finding 7). Measuring it found the public PR artifact, which widens the
  ruling from "tester builds" to "any build anyone else can download". P0: a
  vulnerability. MVP: launch needs it. Scored 5: env removed in three steps,
  one workflow test per file, a new APK check with a planted mutant,
  retention, a phone check of the picker's empty state; the memory's earlier
  3 did not include the PR artifact or the APK check.
