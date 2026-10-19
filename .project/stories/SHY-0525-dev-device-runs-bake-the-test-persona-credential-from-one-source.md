---
id: SHY-0525
status: Draft
owner: claude
created: 2026-09-06
priority: P1
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0525 — Dev device runs bake the test-persona credential from one source and never reuse an unproven APK

## User Story

As **the operator proving a story on the dev environment**, I want the device
journey runner and the iOS Debug-Dev build to bake the current test-persona
credential into the app they put on the phone, so that a dev run either signs
in as a persona or refuses before touching a device, and never spends a phone
run on a build that cannot sign in.

## Why

On 2026-09-06 the first dev run for SHY-0500 (run `dev-2026-09-06T02-34-23-007Z`)
failed J02 and J08 at "Pick persona": the picker opened on "This build has no
test-persona credentials". The runner had built the dev APK itself with
`./gradlew :app:assembleDevDebug` and never passed `DEV_QA_PERSONAS_PASSWORD`
to Gradle, so `BuildConfig` carried an empty string and the app failed closed
exactly as designed. The runner already knows the credential — it refuses to
start without `PERSONAS_PASSWORD` — but keeps it for its own API sign-ins.

Three more holes in the same class surfaced while tracing it:

- A rerun without `--rebuild` reused the credential-less APK from the previous
  run, because the runner treats "an APK file exists" as "a usable build".
- `scripts/ios/build-debug-dev.sh` reads the password from
  `~/.shytalk/dev-personas.env`, whose value is the pre-rotation one (rotated
  2026-08-27; the provisioner writes `~/.shytalk/dev-personas-credentials`).
  It would have baked a password that signs nobody in, then installed the app
  before any check, with none of the Kotlin-freshness gates that
  `scripts/dev/ios-local-install.sh` gained from the 2026-08-22 stale-framework
  incident.
- Four docs and one script header still send the operator to
  `dev-personas.env` for the password.

The credential the phone needs and the credential the runner signs in with are
the same secret. It must come from one file, be baked by one code path per
platform, and be verified in the artefact before a device sees it.

## Acceptance Criteria

### Happy path

- [ ] `device-journey-runner.js --target dev --platform android` builds the
      APK with `DEV_QA_PERSONAS_PASSWORD` set in Gradle's environment to the
      same value the runner signs in with, and the picker signs a persona in
      on the first attempt.
- [ ] After a successful build the runner writes `<apk>.provenance.json`
      (`head`, `target`, `credentialDigest`, `builtAt`) next to the APK.
- [ ] A later run reuses the APK only when the provenance matches the current
      `HEAD` and credential digest; any mismatch or missing sidecar rebuilds
      and says which field differed. `--rebuild` still forces a build.
- [ ] `scripts/ios/build-debug-dev.sh` reads `PERSONAS_PASSWORD` from the
      provisioner's `~/.shytalk/dev-personas-credentials` (override:
      `SHYTALK_DEV_PERSONAS_CREDENTIALS`), verifies the built bundle's
      `DevQaPersonasPassword` is non-empty and the Kotlin dylib is fresh
      (≥1000 `kfun:` symbols, no `.kt` newer than it), and only then installs.

### Error paths

- [ ] A dev Android build with no resolvable persona password is refused
      before Gradle starts, naming the credentials file.
- [ ] The iOS script exits non-zero, before `xcodebuild`, when the credentials
      file is missing or has no `PERSONAS_PASSWORD` line; and after the build,
      before install, when the bundle's password is empty or the dylib is stale.
- [ ] A provenance sidecar that is unreadable or malformed counts as a
      mismatch (rebuild), never as a match.
- [ ] A password dev does not accept is refused before any build: the
      runner and the iOS script each sign one persona in on dev (one
      sign-in call, the password never printed) and stop, naming the
      credentials file, when dev answers `INVALID_LOGIN_CREDENTIALS`.

### Edge cases

- [ ] The `local` target gets the same provenance guard (fixed credential,
      `HEAD` check still applies) so a stale local APK is rebuilt too.
- [ ] The digest is a SHA-256 of the password truncated to 16 hex characters;
      the sidecar never contains the password itself.
- [ ] The Kotlin-freshness checks are one shared shell function file used by
      both iOS scripts, so the next lesson lands in one place.

### Performance

- [ ] Matching provenance costs one small JSON read; no Gradle invocation.
- [ ] A forced or mismatched rebuild is the same incremental Gradle build as
      today (about a minute on the dev flavour).

### Security

- [ ] The password never appears in any log, echoed command, sidecar, report
      or committed file; the existing redaction test for the iOS script keeps
      passing and gains the new file name.
- [ ] The sidecar is written with mode 0600.

### UX

- [ ] Every refusal names the file the operator must provision, in one line,
      before any device work starts.
- [ ] The rebuild reason is printed in the run log (`head changed`,
      `credential changed`, `no provenance`, `--rebuild`).

### i18n

- [ ] Unchanged — operator tooling, English-only output.

### Observability

- [ ] The run report records `apk.provenance` (`reused` or `built`, plus the
      reason) so an evidence page can show which build the phone ran.
- [ ] Docs (`QA_FRAMEWORK_TROUBLESHOOTING.md`, `QA_FRAMEWORK_CELL_RUNBOOK_WEB.md`,
      `personas-csv-export.js` header, `Dev.xcconfig` comment,
      `journey-tests/steps/shared-steps.md`) point at the credentials file for
      the password; a source-scanning test refuses any new
      `dev-personas.env` password reference while asserting the credentials
      file is referenced.

## BDD Scenarios

**Scenario: The runner bakes the credential it signs in with**

- **Given** the dev persona credential is provisioned on this machine
- **When** the operator starts a dev Android journey run
- **Then** the phone's picker signs the first persona in without a retry

**Scenario: A stale APK is not trusted**

- **Given** an APK built from an older commit is still on disk
- **When** the operator starts a dev run at the current commit
- **Then** the runner rebuilds first and says the commit changed

**Scenario: The iPhone never receives an unverified build**

- **Given** the credentials file has no password line
- **When** the operator runs the iOS Debug-Dev build script
- **Then** it stops before building and names the file to provision

## Test Plan

- Unit (`express-api/tests/scripts/device-journey-apk-provenance.test.js`):
  `ensureApk` with an injected command runner — asserts the environment passed
  to Gradle carries the resolved password, the refusal without one, sidecar
  write/reuse/mismatch rules, malformed sidecar, `--rebuild`, local target.
- Script (`express-api/tests/scripts/build-debug-dev-secret-leak.unit.test.js`,
  extended): fake `xcodebuild`/`devicectl`/`nm` on `PATH`; asserts the new
  credentials-file default and override, the pre-build refusal, the
  post-build refusals, that install happens only after the gates, and that
  the password never reaches stdout/stderr.
- Source scan (`express-api/tests/scripts/persona-credential-source.test.js`):
  counts password references to `dev-personas.env` (must be 0) and to
  `dev-personas-credentials` (must be ≥ the listed files).
- Device: J-SMOKE, J02, J08 on both phones against dev from `develop` after
  the merge; run dirs linked in Notes.

## Out of Scope

- Making J07, J09 and J40 assertable on dev (they read Firestore directly and
  are skipped by design, SHY-0488).
- Rotating or re-provisioning the dev persona password.
- Removing the stale `PERSONAS_PASSWORD` line from the operator's
  `~/.shytalk/dev-personas.env` (operator's file; noted in the handover).

## Dependencies

- None. Touches `express-api/scripts/device-journey-runner.js`,
  `scripts/ios/build-debug-dev.sh`, `scripts/dev/ios-local-install.sh`, docs.

## Risks & Mitigations

- **Risk:** the provenance guard rebuilds more often than expected (every
  commit). **Mitigation:** that is the point; a run on a stale build proves
  nothing, and the build is incremental.
- **Risk:** the shared shell function file drifts from one caller.
  **Mitigation:** both scripts are exercised by the same script test with fake
  tools.
- **Risk:** the credentials file has a different line shape on another
  machine. **Mitigation:** the provisioner is the only writer; the reader
  accepts `KEY=VALUE` with optional `export`.

## Definition of Done

- [ ] Merged to `develop`, all checks green, deployed to dev.
- [ ] Both phones sign a persona in on the first attempt against dev, from a
      build the runner or the iOS script verified; evidence linked in Notes.
- [ ] No password reference to `dev-personas.env` remains in the repo.

## Notes

- 2026-09-06 09:58 WIB — **Filed** from the SHY-0500 dev proof: run
  `dev-2026-09-06T02-34-23-007Z` failed J02/J08 at "Pick persona" on a
  credential-less APK; rerun `dev-2026-09-06T02-52-39-583Z` with
  `DEV_QA_PERSONAS_PASSWORD` exported by hand passed J-SMOKE and J02.
- **2026-10-20**: A second way to bake a dead credential, found on the
  SHY-0648 phone walk. `~/.shytalk/dev-personas.env` (last changed 12 Jul)
  had drifted from the `DEV_QA_PERSONAS_PASSWORD` secret that re-seeds dev
  on every deploy: all 17 personas answered `INVALID_LOGIN_CREDENTIALS`
  (Firebase sign-in from the Mac). `scripts/ios/build-debug-dev.sh` and
  `:app:installDevDebug` both built and installed with it without a word,
  and the persona sign-in failed on the phone. New error-path AC added: prove
  the password signs in on dev before building. Shyden chose to rotate the
  password (secret, local files, re-seed) the same day.
