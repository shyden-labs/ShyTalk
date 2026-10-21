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

- [x] No workflow passes `DEV_QA_PERSONAS_PASSWORD` to a step that builds
      an app (Android or iOS); the seeding and runner steps that sign in over
      the API keep it. Proof: the env left pr-checks' devRelease build,
      deploy-dev's devRelease build and its iOS archive step;
      `express-api/tests/scripts/no-build-carries-persona-password.test.js`
      rule 1 allows the name only at four literal sites (seed declaration,
      seed preflight, seed action, journey runner) or the APK check's
      `password` input, and rule 2 refuses any of them that builds.
- [x] Local builds keep the persona picker (`:app:installDevDebug`,
      `scripts/ios/build-debug-dev.sh`, the password from
      `~/.shytalk/dev-personas.env`). Proof: `app/build.gradle.kts` and
      `scripts/ios/build-debug-dev.sh` unchanged on this branch;
      `build-debug-dev-secret-leak.unit.test.js` (password still reaches
      `xcodebuild`) 4/4 green.

### Error paths

- [x] A CI step after each Android build proves the built APK does not hold
      the secret's value (it reads the secret in its own step, prints only
      found or not found), and goes RED on a planted APK that holds it.
      Proof: PR Checks run 39524183782 (Build & Test, 4524619c2e3) ran it
      after the devRelease and localDebug builds; Deploy To Dev run
      39529836842 (f52d9e21bd1) ran it after "Build devRelease APK" and on
      the APK it distributes; each printed "planted APK: the search finds the
      secret, so it can see it" and then "the secret is not in any entry".
      RED on a planted APK: the checker's unit tests and 9 checker mutants
      (Notes). Not yet run in CI: deploy-prod's two copies (first run at the
      release cut) and CodeQL's (only while `vars.ENABLE_CODEQL_KOTLIN` is
      `'true'`; off today); the guard's rule 3 refuses any of them dropped.

### Edge cases

- [x] The `dev-release-apk` artifact gets an explicit short retention.
      Proof: `retention-days: 7` (as `local-debug-apk`) and
      `if-no-files-found: error`; the guard's rule 4 holds every APK/AAB
      upload to 1-7 days and fail-on-empty (prod's two uploads gained it).
- [ ] The persona picker in a CI-built or distributed dev build shows its
      existing "no test-persona credential" state, on both phones.

### Performance

- [x] Not applicable.

### Security

- [x] A workflow test fails if any app-building step's env names the
      secret (one test per workflow file), each seen RED on today's files
      first. Proof: one test per workflow and action file (43); on develop
      43e9ced4c73 it was RED for pr-checks, deploy-dev, deploy-prod and codeql
      (and the whole-tree verdict), green on the other 38; 32 of 32 mutants
      caught (see Notes).

### UX

- [x] Not applicable: testers already sign in through local builds.

### i18n

- [x] Not applicable: no new copy.

### Observability

- [x] The APK check's step summary names the APK it read and its size, so
      an empty read cannot pass. Proof: the checker writes every line to the
      log and to `$GITHUB_STEP_SUMMARY`. PR Checks run 39524183782:
      "app-dev-release.apk: 41777902 bytes, 572 entries" and
      "app-local-debug.apk: 200260677 bytes, 726 entries", each with "proofs
      run: BuildConfig field, value search". Deploy To Dev run 39529836842:
      the built "app-dev-release.apk: 41777886 bytes, 572 entries" (proofs:
      BuildConfig field, value search) and the distributed
      "dev-release-apk/app-dev-release.apk: 41777886 bytes, 572 entries"
      (proofs: value search; a downloaded APK has no build tree, so its
      `BUILD_CONFIG` input is empty by design).

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
- **2026-10-21 (Shyden)**: Dependabot runs get no secrets (measured: run
  39208453897's build env shows the password empty), so the value search
  cannot run there. Ruled: every check also proves the build's generated
  `BuildConfig.java` field is the flavour's own value ('' dev and prod,
  'localdev123' local; AGP 9.4.1 writes it as Java source, measured), which
  needs no secret; on runs without the secret only that proof runs and the
  step says so. The password is not added to the Dependabot secret store.
- **2026-10-21**: built as composite action
  `.github/actions/apk-holds-no-persona-password` over
  `scripts/ci/apk-persona-check.js` (its own zip reader: stored and deflate,
  refuses zip64 and other methods; UTF-8 and UTF-16LE search; a planted APK
  holding the secret must be found first; refuses an empty folder, an empty
  read, and a run where neither proof can run; prints sizes and entry
  counts, never the secret or the field's value). It runs after every
  Android build (pr-checks x2, deploy-dev, deploy-prod x2, codeql) and on the
  APK deploy-dev distributes. Unit tests 39, RED 39/39 on throwing stubs.
  Mutants (harness in `.superpowers/sdd/SHY-0662/`): 23 on the guard, 9 on
  the checker, each turning its named plant red. Removing SHY-0416's
  `dev-builds-share-persona-credential.test.js`, whose claim this reverses.
  No CI job used the CI-built picker: android-e2e uses `local-debug-apk`
  (hard-coded emulator value), the journey matrix signs in over the API, and
  dev device runs build their own APK (SHY-0525).
- **2026-10-21**: PR Checks on e243a5571ad was green but skipped Build &
  Test: Detect Changes set no Android flag for `.github/*` or `scripts/*`,
  so the check had never run in CI. Detect Changes now routes the composite
  action and `scripts/ci/apk-persona-check.js` to `android_app_changed`
  (pinned in `pr-checks-app-changed-split.test.js`, RED 2/26 first). The
  CodeQL copy runs only while `vars.ENABLE_CODEQL_KOTLIN` is `'true'`;
  Analyze Kotlin was skipped on this PR, so it is off and builds nothing.
