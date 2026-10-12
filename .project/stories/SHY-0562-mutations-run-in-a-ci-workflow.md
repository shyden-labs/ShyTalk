---
id: SHY-0562
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

# SHY-0562: Mutations run in a CI workflow that reports each one red or green

## User Story

As the operator proving a new guard or test catches what it claims, I want
a CI workflow that applies a list of mutations one at a time and reports
each as red or green, so that mutation proof of integration, browser and
guard suites never runs on the laptop.

## Why

Global rule (Shyden, 2026-10-09, every project): "Mutations run in CI": a
CI workflow takes a list of mutations, applies each, runs the target file
and reports a RED/GREEN table; no local guard, integration or browser file
runs, even for a mutation. Measured on develop at `197a9bcb98e`: ShyTalk has
28 workflows and none applies mutations. Its suites run under
`express-api/jest.config.js`, `playwright.config.ts` and Gradle; SHY-0216
(Stryker and Pitest) scores mutation coverage and is a different tool.

## Acceptance Criteria

### Happy path

- [ ] A mutation list committed on a branch (file, exact text to find,
      replacement, target test command) is run by a CI workflow started on
      that branch's PR.
- [ ] Each mutation is applied to a clean tree on its own, its target is
      run, and the job summary shows one row per mutation: id, target,
      RED or GREEN, and the failing line for a RED.
- [ ] Jest (Express), Playwright and Gradle targets are each supported.

### Error paths

- [ ] A mutation whose find-text matches zero or more than one place fails
      the workflow naming it; nothing runs against an unapplied mutation.
- [ ] A target that errors before running any test is reported as an error,
      never as RED.

### Edge cases

- [ ] A baseline run with no mutation applied runs first; if it is not
      GREEN the workflow stops and says so.
- [ ] The workflow is never a required check and never runs on a plain
      push; it changes nothing on the branch.

### Performance

- [ ] Each mutation's run time is shown in its row.

### Security

- [ ] The workflow holds no write token and no secret; mutation text is
      read as data, never run as a shell command.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The table counts mutations planned, applied and reported, and the
      three are equal or the run fails.

## BDD Scenarios

**Scenario: A guard is proved against a planted defect**

- **Given** a PR with a mutation list naming one guard mutation
- **When** the mutation workflow runs on that PR
- **Then** the summary shows the baseline GREEN and the mutation RED with
  its failing line

## Test Plan

- Unit tests of the list parser and applier against fixtures (exact-match
  counts, unapplied refusal); one run on a PR proving each runner kind.

## Out of Scope

- Mutation scoring tools (SHY-0216) and the floor recorder (SHY-0556).

## Dependencies

- None.

## Risks & Mitigations

- **A workflow that only exists on the default branch cannot be dispatched
  from a PR.** Start it from the PR itself (a label on `pull_request`), so
  the first PR can use it.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Filed while starting SHY-0556, from the 2026-10-09 global
  rule. Scored 5: one workflow, one applier with its tests, three runner
  kinds proved on a PR.
