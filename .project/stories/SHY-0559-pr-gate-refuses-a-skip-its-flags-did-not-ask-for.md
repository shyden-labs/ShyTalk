---
id: SHY-0559
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

# SHY-0559: The PR Gate refuses a skip that its change flags did not ask for

## User Story

As the operator merging on a green PR Gate, I want the gate to fail when a
job that the change detection said must run was skipped, so that a green
gate always means every suite this change touches actually ran and passed.

## Why

Measured 2026-10-12 on PR #2250 (SHY-0544), run 38189623900:
`Detect Changes` set every flag true (`backend=true android_app=true …`),
yet `test-backend` and `Build & Test` both ended `skipped`. Here the cause
was harmless to the verdict: both jobs carry `needs: lint`
(`pr-checks.yml:275,475`), lint failed, and the gate failed on lint.

The gate step itself (`pr-checks.yml`, job `gate`, step `Evaluate results`)
only fails on `failure` or `cancelled`, then prints "All checks passed or
were correctly skipped" without checking any skip. So a job whose `if:`
evaluates false by mistake (a renamed flag, a typo'd output, a dropped
`||` arm), with nothing upstream failing, is skipped and the gate goes
green. This is the blind form named in the global guard rules: a job skipped
with no upstream failure and the run still says `success`. Today each job's
"should I run" condition lives only in its own `if:`, so nothing can compare
the outcome with the intent.

## Acceptance Criteria

### Happy path

- [ ] Each conditional gated job's run condition (`build-and-test`,
      `sonarcloud`, `test-backend`, `playwright-web`, `integration-tests`,
      `qa-runner-driver-checks`) is computed ONCE, as a `run_<job>` output
      of `detect-changes`, and that job's `if:` reads it, so the condition
      has one home.
- [ ] The two always-run jobs with no `if:` (`lint`, `pre-merge-gate`) are
      required to end `success`; a skip of either fails the gate.
- [ ] The gate requires `success` for every job whose `run_<job>` is
      `true`, and `skipped` for every job whose `run_<job>` is `false`;
      anything else fails, naming the job, its flag and its result.
- [ ] The gate's job list is derived from its `needs:` and checked against
      the set of `run_<job>` outputs, so a job added to one and not the
      other fails CI.

### Error paths

- [ ] A required job skipped while its flag is `true` fails the gate with
      `<job>: expected success (run_<job>=true), got skipped`.
- [ ] Unchanged: `detect-changes` not `success` fails the gate first.

### Edge cases

- [ ] A docs-only or workflow-only change (all `run_<job>` false; `lint`
      and `pre-merge-gate` still run) still passes with every skipped job accounted
      for, so the docs fast path keeps working.
- [ ] `android-e2e` and `ios-e2e` stay off the per-PR gate (SHY-0163); the
      test asserts they are absent, not forgotten.

### Performance

- [ ] The gate step stays inside its 2-minute timeout; `detect-changes`
      time is compared with a run before the change and recorded in the PR.

### Security

- [ ] No `${{ }}` of a flag is interpolated into `run:` unquoted; flags go
      through `env:`.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The gate prints one line per job: name, `run_<job>`, result, verdict.

## BDD Scenarios

**Scenario: A backend change whose test job is skipped by a broken condition**

- **Given** a PR that changes `express-api/src`, so `run_test_backend=true`
- **And** every upstream job succeeds
- **When** `test-backend` ends `skipped`
- **Then** the PR Gate fails naming `test-backend`, its flag and its result

**Scenario: A docs-only change**

- **Given** a PR that changes only `.project/stories/`
- **When** CI runs
- **Then** every skipped job has `run_<job>=false` and the PR Gate passes

## Test Plan

- A new `express-api/tests/scripts/pr-checks-gate-checks-skips.test.js`
  beside the existing `pr-checks-*.test.js` pins: every gated job's `if:`
  reads its `run_<job>` output; the gate's job set equals the output set;
  the evaluate step fails on `true`+`skipped`. One test per job, generated.
- Mutations, each watched RED then restored: hard-code one job's `if:` to
  `false`; drop a job from `needs:`; drop one `run_<job>` output; make the
  gate accept `skipped` again.
- On the PR itself, the gate log shows the per-job lines, read by step name.

## Out of Scope

- Deciding what `.github/**`-only changes should run (SHY-0325).
- The device e2e jobs (SHY-0163).

## Dependencies

- None. Lands after SHY-0544 so its PR is not disturbed.

## Risks & Mitigations

- **Moving conditions breaks a docs or Dependabot fast path.** The edge-case
  AC and a docs-only test case pin it before merge.
- **A condition is mis-copied into `detect-changes`.** Each job's old `if:`
  and new `run_<job>` expression are compared case by case in the PR body.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Found reading PR #2250's failed run, after a side note
  pointed out that the gate counts `skipped` as passing. Scored 5 from
  measurement: 8 gated jobs (`gate.needs` minus `detect-changes`; 6
  conditional, 2 always-run, read off `pr-checks.yml` on develop), one
  workflow file (681 lines), one generated test file following the existing
  `pr-checks-*.test.js` pattern, four planned mutations. Same shape as
  SHY-0556 (5).
