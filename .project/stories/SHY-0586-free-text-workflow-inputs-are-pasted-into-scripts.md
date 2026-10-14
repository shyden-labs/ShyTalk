---
id: SHY-0586
status: Draft
owner: unassigned
created: 2026-10-14
priority: P2
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0586: Free-text workflow inputs are pasted straight into scripts

## User Story

As **Shyden, the operator**, I want every value typed into a workflow form to
reach its script as data, never as code, so that a stray quote in a branch name
cannot change what a deploy or test run executes.

## Why

Found 2026-10-14 while landing SHY-0361. GitHub substitutes `${{ ... }}` into a
`run:` or `script:` body **before** the shell or JavaScript sees it, so a quote
in the value ends the string and the rest runs as code. `deploy-dev.yml`'s own
comments already set the rule (*"Via env:, never inline in run: — inputs.ref is
operator-typed text"*), and two of its steps break it.

Measured on `origin/develop` 56651692a79: **28** lines across **6** workflows
put `${{ inputs.* }}` inside a script body rather than in an `env:` or `with:`
value:

| Workflow | Lines | Inputs | Free text? |
| --- | --- | --- | --- |
| `deploy-dev.yml` | 6 | `ref` (×2), `backend`, `android-testers`, `ios-testers`, `web` | `ref` yes; the rest are booleans |
| `e2e-tests.yml` | 3 | `android`, `parallel`, `ref` | `android`, `ref` |
| `ios-tests.yml` | 3 | `ios`, `parallel`, `ref` | `ios`, `ref` |
| `playwright-tests.yml` | 3 | `web`, `parallel`, `ref` | `web`, `ref` |
| `allure-report.yml` | 12 | `suite_name`, `report_env`, `max_history_runs` | strings, but `workflow_call` only |
| `release.yml` | 1 | `bump` | no: a `choice` |

**Severity, and why P2 rather than P0.** Only someone with write access can
start these workflows, and write access already lets them edit any workflow, so
this grants no new power. It is still a defect: a branch name containing a quote
breaks the run. The global rule that a vulnerability is P0 is Shyden's to apply
here, flagged to him on filing.

## Acceptance Criteria

### Happy path

- [ ] Every `${{ inputs.* }}`, `${{ github.event.* }}` and step-output value of
      free text reaches a `run:` body through `env:`, and a `github-script`
      body through `process.env` or `core.getInput`, never by substitution.
- [ ] Booleans, numbers and `choice` inputs move the same way, so the rule has
      no exceptions to remember.

### Error paths

- [ ] A guard fails CI when any workflow puts `${{` inside a `run:` or
      `script:` body (outside `env:`/`with:`/`if:`), naming file and line.

### Edge cases

- [ ] The guard reads every file under `.github/workflows/` and
      `.github/actions/`, from the filesystem, and reports the count it read
      (with a recorded floor).
- [ ] `allure-report.yml`'s callers are traced: a caller passing its own
      free-text input through `with:` is covered too.

### Performance

- [ ] N/A: no measurable runtime change.

### Security

- [ ] Planted: a dispatch with `ref` = `x'; echo INJECTED; '` on a branch in a
      fork-free test, run before and after; after, `INJECTED` never prints.

### UX

- [ ] N/A.

### i18n

- [ ] N/A.

### Observability

- [ ] The guard prints the count of script bodies it checked.

## BDD Scenarios

**Scenario: A quote in a typed value stays data**

- **Given** an operator dispatches a workflow with a ref containing a quote
- **When** the workflow runs
- **Then** the value is used as text and nothing in it executes

## Test Plan

1. RED first: the guard against `origin/develop` reports the 28 lines above.
2. Mutations: re-inline one `inputs.ref` in `run:` and one in a
   `github-script` body; the guard goes red on each.
3. One real dispatch per changed workflow, read by job name.

## Out of Scope

- `pull_request_target` workflows (none exist today).

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Moving a value to `env:` changes quoting in a way a step relied on | One real dispatch per workflow (Test Plan 3). |
| The guard has false positives on `${{` in comments | It reads the parsed YAML's script bodies, not raw lines. |

## Definition of Done

- [ ] Guard required in CI, mutation-verified.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-14**: Filed while landing SHY-0361, whose Android job contains one
  of the two `deploy-dev.yml` `ref` lines (`Resolve deployed SHA`). Left for
  this story so all 28 move under one guard.
