---
id: SHY-0606
status: Draft
owner: unassigned
created: 2026-10-16
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: true
blocked_by: [SHY-0605, SHY-0608]
---

# SHY-0606: Identity-graph suspensions skip the suspension lifecycle

## User Story

As **Shyden, the operator**, I want a suspension from the identity graph to
behave exactly like every other suspension, so that a linked-account
suspension hides the profile, can be appealed, and is undone cleanly.

## Why

Found 2026-10-16 while working SHY-0597, reading
`express-api/src/routes/identity-graph.js`:

- `POST /admin/identity-graph/:id/suspend-all` writes `isSuspended: true`
  with its own field names (`suspendedAt`, `suspendReason`) instead of the
  ones every other path writes (`suspensionReason`, `suspensionStartDate`,
  `suspensionEndDate`, `suspensionCanAppeal`). It does not mask the profile,
  so a suspended account keeps showing its name and photos to everyone.
- `POST /admin/identity-graph/:id/unsuspend-all` writes `isSuspended: false`
  and clears only those three fields. It does not use
  `suspensionEndedFields`, so it never restores the saved profile: a user
  masked by any other suspension and cleared here keeps "Suspended Account"
  for good, the same loss as SHY-0597 by another route. It also leaves
  `suspensionAppealStatus` behind, the defect SHY-0463 fixed everywhere
  else.
- Both catch a failed user write, log a warning and still answer success.
- The 2026-10-15 nightly (38694041358, chromium) called `suspend-all` twice
  then `unsuspend-all` on one test user.
- The dialog's length (1, 3, 7, 30 days or permanent, sent as a bare `"1"`)
  is stored only on the graph document and never as an end date, so every
  identity suspension has acted as permanent until an admin lifted it.
- The dialog's "Suggestions only" scope is stored and never read: no route
  enforces a suggestions-only restriction, so it fully suspended the user.
- The dialog has no "can appeal" choice and the route stores none.

## Acceptance Criteria

### Happy path

- [ ] `suspend-all` starts the suspension through SHY-0608's
      `startSuspension`, with a test.
- [ ] `unsuspend-all`, and the per-node unsuspend when the node is the
      user's account, end it through SHY-0605's `endSuspension`, with a test
      each.
- [ ] The chosen length becomes `suspensionEndDate` (permanent: none), so a
      timed identity suspension ends by itself, with a test per length.
- [ ] The dialog offers full suspension only: "Suggestions only" is removed
      until SHY-0609 builds it (Shyden 2026-10-16, "Remove it for now").
- [ ] The dialog has a "Can appeal" box and the route refuses a request
      without `canAppeal`, like the other suspend screens (Shyden
      2026-10-16), with a browser test of the dialog.

### Error paths

- [ ] A failed user write fails the request with an error the admin panel
      shows; it never answers success (a test forces the failure).

### Edge cases

- [ ] `suspend-all` on an already-suspended user keeps the first saved
      profile (SHY-0597's rule), with a test.

### Performance

- [ ] N/A.

### Security

- [ ] The routes keep their existing admin checks, with a test.

### UX

- [ ] N/A: no new copy.

### i18n

- [ ] N/A.

### Observability

- [ ] N/A beyond the error path above.

## BDD Scenarios

**Scenario: a linked-account suspension is lifted**

- **Given** a user suspended from the Users tab, then from the identity graph
- **When** the admin unsuspends all from the identity graph
- **Then** the user's real name and photos are back and no suspension field is left

## Test Plan

1. Unit tests per route with the mocked database (RED first).
2. Integration: suspend from the Users tab, unsuspend from the graph, read
   the profile.

## Out of Scope

- Live accounts already affected (SHY-0604).

## Dependencies

- SHY-0605 (`endSuspension`) and SHY-0608 (`startSuspension`).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Old documents carry `suspendReason`/`suspendedAt` | The fix reads both names while clearing them. |

## Definition of Done

- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-16**: Filed from SHY-0597.
- **2026-10-16**: Shyden's rulings (AskUserQuestion): remove "Suggestions only" for now (SHY-0609 builds it); add a required "Can appeal" box; every suspension starts and ends through one shared step (SHY-0608, SHY-0605), so this story now wires the graph routes and the dialog to them. Users already stuck under a lapsed identity suspension are SHY-0604's.
