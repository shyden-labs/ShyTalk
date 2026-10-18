---
id: SHY-0636
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0636: The journey runner retries nothing; a failed step names its cause

## User Story

As a developer reading a device journey's result, I want every set-up and
screen step to either succeed or fail once with its real cause, so that a
green run proves the app worked and a red one tells me why.

## Why

Found on 2026-10-18 while designing SHY-0631, read at `6ff7a90e4ca`:
`express-api/scripts/device-journey-runner.js` holds 8 retry loops
(`for (let attempt = …)`), which the standing rule counts as defects (a retry
is not a fix):

| Line | Step | What is retried |
| --- | --- | --- |
| 1710 | `openPersonaPicker` | the picker open, unbounded |
| 2804 | Pick persona | open and select, 3 times |
| 3253 | Setup: give Nora a message from Raul | Firestore clean-up, 3 times with `sleep(500 * attempt)` |
| 3503 | Setup: clear any earlier Alice-Lena conversation | the same |
| 4007 | The phone is signed in as the account we seeded | settle and wait for Home, unbounded |
| 4214 | Open Settings, then Contact support | the same |
| 4487 | Setup: clear any room Theo still owns | Firestore clean-up, 3 times |
| 4563 | UI: the room screen shows the seat grid | a tap, 4 times |

SHY-0524 (#2161) removes fixed-duration `sleep` calls; it does not remove
these loops. SHY-0491 (#2072) is the picker's own disappearance.

## Acceptance Criteria

### Happy path

- [ ] All 8 loops are gone: each step does its work once, waits on a named
      condition where something is genuinely pending (`pollUntil`, with a
      stated ceiling), and fails at once naming the cause otherwise.
- [ ] The three Firestore clean-ups delete each conversation or room with
      `recursiveDelete` (SHY-0631's helper where the runner can reach it).

### Error paths

- [ ] A failed step's message names what it waited for, what it saw and the
      ceiling, never "attempt 3 of 3".

### Edge cases

- [ ] A mistapped persona row is detected and reported as a mistap, not
      tapped again.

### Performance

- [ ] One full dev matrix run's duration is measured before and after.

### Security

- [ ] Not applicable: test tooling against dev only.

### UX

- [ ] Not applicable: no app changes.

### i18n

- [ ] Not applicable: no user-facing text.

### Observability

- [ ] A guard counts `attempt` loops in the runner and its drivers, floored
      at 0, and goes red on a planted one.

## BDD Scenarios

**Scenario: a set-up step fails once and says why**

- **Given** the Firestore clean-up before the report journey
- **When** a delete is refused
- **Then** the step fails at once, naming the path and the error

**Scenario: a pending screen is waited for, not retried**

- **Given** the app still recomposing after a cold start
- **When** the step waits for Home
- **Then** it polls for `main_profileTab` up to its ceiling and passes or
  fails once

## Test Plan

- Unit tests of each rewritten step with the device and Firestore stood in.
- One dev matrix run green after the change (CI, not the laptop).

## Out of Scope

- Fixed `sleep` calls (SHY-0524).
- The picker's disappearance itself (SHY-0491).

## Dependencies

- SHY-0631 provides the conversation helper; the room clean-up can land
  without it.

## Risks & Mitigations

- Removing a loop can turn a hidden flake into a red run (expected): each red
  is a real defect filed with its error text and duration.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; one dev matrix run green.

## Notes

- **2026-10-18**: Filed while designing SHY-0631. P0 by the standing rule
  that any defect is P0; not MVP (test tooling). Scored 3: eight loops in
  one file plus a guard; same size as SHY-0524 (3).
