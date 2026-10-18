---
id: SHY-0641
status: In Review
owner: claude
created: 2026-10-19
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0641: The reset script resets dev only, and fails when a step fails

## User Story

As the operator, I want the environment reset script to be unable to touch
production and to say so plainly when any step fails, so that a wipe is never
aimed at live data and never reported done when it was not.

## Why

Found on 2026-10-18 while proving SHY-0631's paths: `scripts/reset-data.mjs`
wiped production too (`--env prod`, a production key and the typed project id),
and ran on load, so no test could reach its steps without a child process.
Shyden, 2026-10-18 (AskUserQuestion): **"Dev only"**. Read at `origin/develop`
b744be3961a, three more defects:

- the dev check was `project_id.includes('dev')`, so `devious-prod` passed;
- `R2_BUCKET_NAME` could aim the R2 wipe at the production bucket `shytalk-media`;
- a failed R2 wipe or RTDB clear was caught and logged, and the run still
  printed "reset complete" (failing never shows success).

## Acceptance Criteria

### Happy path

- [x] The script resets `shytalk-dev` only: `--env prod`, any other `--env`, any
      project but `shytalk-dev` and any bucket but `shytalk-media-dev` are refused
      before anything is deleted. Proof: `express-api/tests/scripts/reset-data.unit.test.js` "refusal: dev only" (8 tests).
- [x] Importing the script runs nothing; `main` runs only when it is executed.
      Proof: `express-api/tests/scripts/reset-data.unit.test.js` imports it with no credentials; the `runs-on-import` mutant
      fails the whole file.
- [x] Conversations are deleted as one tree through `deleteTree` (SHY-0631), and
      no hand-made subcollection list names conversations. Proof: `express-api/tests/scripts/reset-data.unit.test.js`
      "conversations go as one tree".

### Error paths

- [x] A failed step (conversations, R2, RTDB) rejects the run, nothing after it
      runs, and "complete" is never printed. Proof: `express-api/tests/scripts/reset-data.unit.test.js` "run never reports
      success after a failed step".

### Edge cases

- [x] Without R2 credentials the R2 phase is skipped and says so. Proof: `express-api/tests/scripts/reset-data.unit.test.js`.

### Performance

- [x] Not applicable: a manual tool.

### Security

- [x] The refusals and the failure paths are unit-tested with Firestore, RTDB
      and R2 stood in, no process and no socket; mutation-verified (9 mutants,
      all killed).

### UX

- [x] Not applicable.

### i18n

- [x] Not applicable.

### Observability

- [x] The refusal names what was refused (`--env`, project or bucket), never a
      credential.

## Announce

Nothing: operator tooling with no learner-facing change.

## BDD Scenarios

**Scenario: a production key is refused**

- **Given** a production service account and `--env dev`
- **When** the reset starts
- **Then** it refuses, naming the project, and deletes nothing

**Scenario: a failed R2 wipe is a failed reset**

- **Given** the R2 wipe fails
- **When** the reset runs
- **Then** it ends as a failure and never prints "reset complete"

## Test Plan

- `express-api/tests/scripts/reset-data.unit.test.js` (imports the script's steps).
- One dev reset by Shyden after merge, if he wants one (the dev key is not on
  this Mac).

## Out of Scope

- A production wipe workflow (not wanted now).

## Dependencies

- Unblocks SHY-0631's paths AC (the reset script's `deleteTree` call is pinned here).

## Risks & Mitigations

- The script cannot be run end to end here (no dev key on this Mac): the data
  blocks (collection lists, seed fixtures) were spliced byte for byte from the
  old file, and every step is unit-tested.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-19**: Filed while proving SHY-0631. P0 (a laptop path to wipe
  production, and a reset that reports success after failing); not MVP
  (tooling). Scored 5: refactor for testability, three refusals, failure
  propagation and 15 tests. I quoted Shyden "about 3" before reading the
  failure paths; the measured scope is 5.
