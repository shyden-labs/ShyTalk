---
id: SHY-0554
status: Draft
owner: claude
created: 2026-10-12
priority: P0
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0554: Local services are ready before any workflow seeds, and a seed that cannot reach storage fails

## User Story

As a developer reading a red integration, Playwright or E2E run, I want the
run to stop where storage was missing, so that I never chase a test failure
whose real cause was a bucket that was never created.

## Why

Found 2026-10-12 while building SHY-0544. `test-backend.yml` and
`sonarcloud.yml` wait for the S3 stand-in and Mailpit to answer before they
use them. `integration-tests.yml`, `playwright-tests.yml` and
`e2e-tests.yml` start the same services (`start-local-services`) and then
run `node ../local/seed.js` with no wait. The only thing between the two is
the express-api `npm ci`, which is usually long enough, and nothing proves
it is.

If the stand-in is not answering yet, `local/seed.js` does not fail: it
catches the error, prints "S3 stand-in not available, skipping bucket
creation" and exits 0. The run then fails later, in whichever test first
reads or writes media, with an error that points away from the cause.

## Acceptance Criteria

### Happy path

- [ ] Every workflow that runs `start-local-services` waits for the S3
      stand-in (`http://localhost:9002/health`) and Mailpit before its first
      use of either, through ONE shared step or script (no copied loops).
- [ ] A test lists every workflow that uses `start-local-services` (derived
      from the files, not a hand list) and requires the wait before the
      seed or test step in each.

### Error paths

- [ ] `local/seed.js` exits non-zero when it cannot create the bucket or set
      its policy, naming the endpoint it tried. A local run with no Docker
      gets the same clear failure, not a silent skip.
- [ ] A container that never becomes ready fails the wait within its stated
      bound, naming the container and printing its last log lines. No retry.

### Edge cases

- [ ] `local/start.sh` and `local/start.ps1` keep working: they already wait
      before seeding.

### Performance

- [ ] The added wait costs no measurable time on a green run (it returns on
      the first poll once ready): recorded from one run before and after.

### Security

- [ ] Not applicable.

### UX

- [ ] Not applicable.

### i18n

- [ ] Not applicable.

### Observability

- [ ] The wait prints how long each service took.

## BDD Scenarios

**Scenario: Storage not ready at seed time**

- **Given** a workflow whose S3 stand-in is still starting
- **When** the seed step runs
- **Then** the wait holds it until the stand-in answers, or fails naming
  the container

**Scenario: Storage unreachable**

- **Given** no S3 stand-in at the configured endpoint
- **When** `local/seed.js` runs
- **Then** it exits non-zero naming the endpoint

## Test Plan

- Unit tests of the workflow wiring and of the seed's exit status (seed
  logic called in-process, storage client mocked).
- The PR's own integration, Playwright and E2E runs, read by step name.

## Out of Scope

- Which S3 stand-in runs (SHY-0544).

## Dependencies

- SHY-0544 (the stand-in and its `/health` path).

## Risks & Mitigations

- **A developer's local seed now fails where it used to skip.** That is the
  intent; the message says what to start.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-12**: Found while building SHY-0544; left out of that PR to keep
  it to the image swap. Scored 3: one shared wait wired into three
  workflows, one seed change, two tests.
