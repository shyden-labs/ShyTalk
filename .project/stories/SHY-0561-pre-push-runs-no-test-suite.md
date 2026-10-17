---
id: SHY-0561
status: Draft
owner: claude
created: 2026-10-12
priority: P0
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0561: The pre-push hook runs no test suite, only quick static checks

## User Story

As the operator pushing a branch, I want the pre-push hook to run only the
format, lint, type and static checks, so that a push never waits on a test
suite and never refuses the push that a CI floor recording needs.

## Why

Global rule (Shyden, 2026-10-12, every project): "Pre-push runs no test
suite, not even unit". The laptop runs unit tests, formatters, linters and
type checks by hand; every other suite is CI's (2026-10-09). Measured on
develop at `197a9bcb98e`, `.husky/pre-push` (263 lines) still runs:

- Playwright (chromium) on any web change when the local stack is up, and
  silently skips it when the stack is down;
- on a push of `main`: the Express Jest suite with coverage, the Kotlin
  `:shared:jvmTest` suite (stderr thrown away) and a SonarCloud scan with
  `-Dsonar.qualitygate.wait=true`.

Three tests pin the hook today: `actionlint-shellcheck-invocation.test.js`,
`check-node-version.test.js` and `prepush-sonar-main-only-gate.test.js`
(all under `express-api/tests/scripts/`).

## Acceptance Criteria

### Happy path

- [ ] The hook runs no test runner of any kind (Jest, Gradle test tasks,
      Playwright, XCTest), on any branch, `main` included.
- [ ] The hook keeps its fast guards: force-push, paid-runner, node version,
      stub ratchet, large file, actionlint and the action-shell check.
- [ ] A test pins the hook: it fails if any test-runner invocation is added
      back, read from the comment-stripped hook text.

### Error paths

- [ ] Whatever the main-push Sonar quality gate enforced still blocks
      somewhere before `main` changes, in CI, or Shyden has chosen in
      writing to drop it (see Notes: asked at the start of this story).

### Edge cases

- [ ] A push with the local stack down behaves exactly as one with it up.
- [ ] Every check the hook keeps that depends on what changed reads the
      pushed range (the remote's tip to the pushed commit), not
      `origin/main...HEAD`, and a branch delete runs none of them (from
      SHY-0517). The large-file check still compares with `main`.
- [ ] Each planted runner form (`npx playwright test`, `jest`,
      `./gradlew …Test`, `npm test`, `xcodebuild test`) turns the pin red.

### Performance

- [ ] A push of any change completes on the hook's static checks alone;
      the time is measured before and after and recorded in Notes.

### Security

- [ ] No guard that protects `main` is lost: each removed step is matched
      to the CI job that enforces it, named in the PR.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The hook prints no "skipping Playwright" or "skipping Sonar" line
      that reads as if a check happened.
- [ ] The hook writes nothing to stderr on a clean push. Today
      `echo "$CHANGED" | grep -qE ...` (`.husky/pre-push` lines 116, 154
      and 230) prints `echo: write error: Broken pipe` when the changed-file
      list is long, because `grep -q` exits on its first match. Line 116
      (the workflow-file check) survives this story, so it is fixed here
      too, e.g. with a here-string.

## BDD Scenarios

**Scenario: A web change is pushed**

- **Given** a branch that changes `public/`
- **When** it is pushed with the local stack running
- **Then** no browser starts, and the PR's CI runs the browser suite

## Test Plan

- Unit pin of the hook text with each planted runner form shown red; update
  `prepush-sonar-main-only-gate.test.js` to the new home of the gate.

## Out of Scope

- The CI floor recorder (SHY-0556) and the CI mutation workflow (SHY-0562).

## Dependencies

- Supersedes SHY-0276 (Playwright in pre-push) and most of SHY-0517 (the
  diff the hook tests): both assume the hook runs suites. They are closed or
  re-scoped once SHY-0518 lets an existing Draft story be edited.

## Risks & Mitigations

- **Losing the only blocking Sonar gate.** SonarCloud's free plan grades only
  `main`, so the main-push scan is today the one place the gate blocks. The
  choice of its new home is Shyden's and is asked before any change.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Filed while starting SHY-0556, from the 2026-10-12 global
  rule. Scored 5 from measurement: one 263-line hook, three pinning tests,
  one new pin, and a decision on the Sonar gate's home.
- **Question for Shyden at start**: where does the main-push Sonar quality
  gate go (a CI job on the develop→main PR or push, or dropped)?
- **2026-10-15**: SHY-0534's push printed `.husky/pre-push: line 154: echo:
  write error: Broken pipe` and the same at line 230; the push still passed.
  Added the stderr AC above.
- **2026-10-16**: SHY-0597's push ran the whole Playwright chromium suite
  inside `git push` because the local stack was up (lines 236-255 of
  `.husky/pre-push` run it when localhost:3000 and :8888 answer); the push
  was stopped and retried with the stack down. `echo: write error: Broken
  pipe` printed at lines 116, 154 and 230.
- **2026-10-18**: Backlog sweep. SHY-0276 is closed as superseded by this
  story, and SHY-0517 is folded into it: its remaining part is the
  pushed-range edge case above. Estimate unchanged.
