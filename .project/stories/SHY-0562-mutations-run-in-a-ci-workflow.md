---
id: SHY-0562
status: Draft
owner: claude
created: 2026-10-12
priority: P0
effort: L
estimate: 8
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0562: Every pull request runs its mutations in a required check

## User Story

As the operator proving a new guard or test catches what it claims, I want
a required `mutations` check on every pull request that runs each mutation
the pull request brings and refuses a changed non-unit test with none, so
that no integration, browser or guard test lands unproven and no mutation
runs on the laptop.

## Why

Global rule (Shyden, 2026-10-09, every project): "Mutations run in CI".
Amended 2026-10-16 (steadyhand #288, every project and `repo-template`;
full text: "### Non-unit mutations run in a required PR check" in
`~/.claude/global-rules/reference/reference-engineering-standards.md`).
His words: _"mutation testing is vital. we need it"_, then _"it must be
run"_; by AskUserQuestion: _"Changed tests (Recommended)"_ and _"Every
project (Recommended)"_.

This replaces the 2026-10-12 version of this story, which ran only on a
label and was "never a required check". Both are now wrong.

Measured on develop at `1c6c41c2acd`: no workflow applies mutations. The
test configs are `express-api/jest.config.js`, `playwright.config.ts`,
`playwright.integration.config.ts` and Gradle (`app/src/test`,
`app/src/androidTest`, `shared/src/commonTest`, `jvmTest`,
`androidHostTest`). SHY-0216 (Stryker and Pitest) scores mutation coverage
and is a different tool.

## Acceptance Criteria

### Happy path

- [ ] A mutation file in the repo lists rows: target test file, file to
      change, exact text to find, replacement, and a written prediction (RED
      naming the tests that must fail, or GREEN).
- [ ] A `mutations` workflow runs on every pull request into `develop`,
      with no label and no manual start.
- [ ] It runs every mutation file the pull request adds or changes: each
      target runs clean first, then each row is planted on its own, run,
      judged against its prediction, and put back.
- [ ] The job summary shows one row per mutation: id, target, predicted,
      actual, the failing line for a RED, and run time.
- [ ] Jest (Express), Playwright and Gradle targets are each supported.
- [ ] `mutations` is added to `required_status_checks.contexts` on
      `develop` after the first merge, and read back.

### Error paths

- [ ] The check fails when the pull request adds or changes a non-unit
      test file (integration, browser, journey, instrumented, guards,
      properties, every language) and no mutation file the pull request
      adds or changes targets it. The failure names each such file.
- [ ] A row not as predicted fails the check, naming the row. It is a
      finding to read and record, never a re-run.
- [ ] A find-text matching zero or more than one place fails the check,
      naming the row; nothing runs against an unplanted mutation.
- [ ] A red baseline fails the check before any row runs.
- [ ] A target that errors before running any test is an error, never a
      RED.

### Edge cases

- [ ] A test file is "non-unit" when no unit config selects it. The
      classification is read from the configs and source sets, never a
      hand list, so it follows SHY-0546 and SHY-0563 as they move files.
- [ ] A pull request touching no non-unit test and no mutation file passes
      at once, saying how many changed paths it judged.
- [ ] A docs-only pull request still reports the check (the fast path) and
      it passes.
- [ ] Every planted change is put back, and the tree is checked clean
      after each row.

### Performance

- [ ] The check's time on a pull request with no mutation file is measured
      and kept to the fast path; pull-request CI time is reported before
      and after.

### Security

- [ ] The workflow holds no write token and no secret; mutation text is
      read as data, never run as a shell command.

### UX

- [ ] Not applicable: operator tooling.

### i18n

- [ ] Not applicable: no user-facing text.

### Observability

- [ ] The table counts rows planned, planted and judged, and the three are
      equal or the check fails.
- [ ] The judged population (changed paths, non-unit test files found) is
      printed with a recorded floor, as every guard does.

## BDD Scenarios

**Scenario: a changed browser test without a mutation is refused**

- **Given** a pull request that changes `tests/web/logger-idempotency.spec.ts`
- **And** no mutation file in it targets that spec
- **When** the `mutations` check runs
- **Then** it fails, naming the spec

**Scenario: a guard is proved against a planted defect**

- **Given** a pull request whose mutation file has one row predicted RED
- **When** the `mutations` check runs
- **Then** the baseline is GREEN, the row is RED as predicted, the file is
  put back, and the check passes

## Test Plan

- Unit tests of the file parser, the classifier and the planter against
  fixtures (exact-match counts, unplanted refusal, put-back).
- One pull request proving each runner kind (Jest, Playwright, Gradle),
  and one planted misprediction seen failing the check.

## Out of Scope

- Mutation scoring tools (SHY-0216) and the floor recorder (SHY-0556).
- Unit-test mutations, which may still run on the laptop.

## Dependencies

- None blocking. SHY-0546 (unit split) and SHY-0563 (guards suite) move
  files between unit and non-unit; the classifier follows them.
- Worked example: steadyhand's `mutations` workflow (#288). Its shape is in
  the global rule; this repo's session does not read steadyhand.

## Risks & Mitigations

- **A workflow that exists only on the default branch cannot run from a
  PR.** It runs on `pull_request`, so the pull request that adds it runs
  it.
- **A required check that is slow on every PR.** The no-mutation path
  exits at once; only pull requests carrying mutations pay for runs.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; `mutations` read back in branch protection.

## Notes

- **2026-10-12**: Filed while starting SHY-0556, from the 2026-10-09 global
  rule. Scored 5: one workflow, one applier with its tests, three runner
  kinds proved on a PR.
- **2026-10-16**: Rewritten for the amended rule (relayed by steadyhand-b5
  and checked in the reference file before acting). Rescored 8: the
  original work, plus the changed-test refusal with its config-read
  classifier, written predictions and the required-check wiring.
