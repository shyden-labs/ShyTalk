---
id: SHY-0551
status: Draft
owner: claude
created: 2026-10-11
priority: P0
effort: S
estimate: 3
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0551: A failing scheduled job opens an issue instead of failing silently

## User Story

As the operator, I want every scheduled workflow that fails to open (or
update) one GitHub issue assigned to me, so that a job that stops working is
seen the first night, not two months later.

## Why

Measured 2026-10-11, scheduled workflows on `develop`:

- `cron-support-retention.yml`: 45 of 45 runs failed since 2026-08-28 (401;
  cause in SHY-0550). Nobody was told.
- `playwright-nightly.yml`: no success since 2026-09-11 (45 runs read); the
  latest (38123310775) fails in `start-local-services` on every browser, the
  step SHY-0544 fixes. Nobody was told.
- `cron-account-deletion.yml`, `cron-support-retention.yml` and
  `playwright-nightly.yml` contain no failure notification of any kind
  (0 matches for issue/notify/`failure()`). `deploy-prod.yml` already has an
  `Alert - Deploy Failed` job that opened #1398, so the repo has the idiom.

Global rule (2026-10-07, "nothing we rely on stops silently"): each such
point gets an outcome check that opens an issue assigned to ShydenMcM, with a
planted failure proving it.

## Acceptance Criteria

### Happy path

- [ ] The population is derived, not listed: every workflow with an `on:
      schedule` trigger (read from `.github/workflows/*.yml`) has a final job
      that runs on `failure()` and opens an issue assigned to `ShydenMcM`,
      titled by workflow name, linking the run.
- [ ] A second failure of the same workflow comments on the open issue
      instead of opening another.
- [ ] A guard test reads every scheduled workflow and fails when one has no
      such job; it carries the population (`searched(...)`) and a floor at the
      measured count, and a planted workflow without the job goes RED.

### Error paths

- [ ] If the alert job itself cannot create the issue, the run's summary
      names the failure (the job fails red, never silently).

### Edge cases

- [ ] A cancelled run opens nothing (cancellations are not failures).

### Performance

- [ ] The alert job adds no time to a passing run (it is skipped).

### Security

- [ ] The alert job's permissions are `issues: write` only, read back by
      the guard; it uses the workflow token, no extra secret.

### UX

- [ ] The issue body says which workflow failed, when, and links the run,
      readable without opening logs.

### i18n

- [ ] Not applicable: operator-facing GitHub text only.

### Observability

- [ ] A planted failure (dispatch of one scheduled workflow with a forced
      failing step on a branch) opens the issue, assigned, and a second run
      comments on it; both recorded with run ids, then the issue is closed.

## BDD Scenarios

**Scenario: A nightly job fails**

- **Given** a scheduled workflow fails
- **When** its alert job runs
- **Then** one issue titled with the workflow's name is open and assigned to ShydenMcM
- **And** it links the failing run

**Scenario: A scheduled workflow has no alert job**

- **Given** a workflow with an `on: schedule` trigger and no failure alert job
- **When** the guards suite runs
- **Then** the guard fails naming that workflow

## Test Plan

- Guards suite: the scheduled-workflow alert guard with floor and planted mutant.
- CI: the planted-failure dispatch.

## Out of Scope

- Fixing the failing jobs themselves (SHY-0550, SHY-0544).
- Outcome checks for non-workflow points (emails, analytics, backups).

## Dependencies

- None to build; the planted-failure proof needs a workflow dispatch.

## Risks & Mitigations

- Alert noise from a flaky job: one issue per workflow, updated by comment.

## Definition of Done

- [ ] Every AC ticked with evidence; board item Done.

## Notes

- Found 2026-10-11 alongside SHY-0550.
