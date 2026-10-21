---
id: SHY-0687
status: Draft
owner: claude
created: 2026-10-22
priority: P0
effort: L
estimate: 8
type: chore
roadmap_ids: []
mvp: true
epic: EPIC-0016
blocked_by: [SHY-0674]
---

# SHY-0687: every workflow line is measured from a run on the same commit

## User Story

As the operator, I want every line of every GitHub workflow and composite
action measured from a run on the pull request's own commit, so that SHY-0674's
gate can judge a changed workflow line like any other code.

## Why

Shyden, 2026-10-22, global ruling "What counts as code, skipped lines, and
workflow code" (asked in steadyhand #381, then "Global"):

- Workflow files are code: *"all. so 1 and 2"*.
- For how they are measured, he chose "Own story, before #381". A changed
  workflow line counts as run only if a run on that same commit took it.
  Shell inside `run:` is traced line by line (bash trace output), and other
  YAML lines count as run when their step or job ran.

Measured 2026-10-22: 29 workflows and 14 composite actions, with 228 `run:`
steps. No workflow line is measured today. Until this lands, any PR that
changes a workflow fails SHY-0674's gate.

## Acceptance Criteria

### Happy path

- [ ] Every `run:` step in every workflow and composite action runs its shell
      with line tracing (`set -x` with a `PS4` naming file and line, or
      `BASH_XTRACEFD` to a trace file), and the trace is uploaded per job.
- [ ] A converter maps each traced line back to its workflow file and line,
      and maps every other YAML line to run or unrun from the run's own job
      and step results (read through the API for that commit). It writes the
      same report form SHY-0674 joins.
- [ ] SHY-0674's classification moves `.github/workflows/*.yml` and
      `.github/actions/*/action.yml` to "measured", and their untested counts
      join the record, written in the same PR.

### Error paths

- [ ] A job with no trace, or a trace that cannot be mapped to a line, fails
      the check naming the job (fails closed).
- [ ] A step skipped by its `if:` leaves its lines unrun, never run.

### Edge cases

- [ ] A multi-line `run: |` block maps each traced command to its own line,
      including lines joined by `\` and here-documents.
- [ ] Secrets never reach a trace: tracing is off around any line that
      expands a secret, and a planted secret-like value is checked absent
      from every uploaded trace.

### Performance

- [ ] Tracing adds a measured cost per job, recorded in the PR; the
      converter's measured time is its limit at its step.

### Security

- [ ] Nothing is counted as run that did not run: a planted unrun branch of
      an `if` inside `run:` and a planted skipped step are each reported
      unrun.

### UX

- [x] Not applicable: developer tooling.

### i18n

- [x] Not applicable: no copy.

### Observability

- [ ] CI prints the workflow untested counts, the traced job count and every unrun
      changed workflow line.

## Announce

None: internal quality tooling with no change users can see.

## BDD Scenarios

**Scenario: a changed workflow line is judged**

- **Given** a PR changes a line inside a `run:` block
- **When** that PR's own run traces the step
- **Then** the line is reported run if the trace took it, unrun if not

## Test Plan

- Unit tests of the trace parser and the YAML line mapper; planted unrun
  shell branches, skipped steps and a secret-like value, each seen in CI.
- The no-holes rule applies: before/after lists, coverage of the changed
  code, mutations of every new control.

## Out of Scope

- Jobs that never run on a PR (SHY-0688).

## Dependencies

- SHY-0674

## Risks & Mitigations

- **Tracing leaks a secret into logs.** Covered by the Edge cases AC and its
  planted check.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-22**: filed from the global ruling (relayed by the steadyhand
  session; read in reference-engineering-standards.md). Scored 8: the
  reference assumes about 8 per project; ShyTalk's 228 `run:` steps across 43
  files, a converter and a secret check fit that size.
