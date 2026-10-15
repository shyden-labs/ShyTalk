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

## Acceptance Criteria

### Happy path

- [ ] `suspend-all` writes the same suspension fields as the admin suspend
      route, including `SUSPENSION_STARTED_RESET` and
      `suspensionStartedProfileFields`, with a test.
- [ ] `unsuspend-all` and the per-node unsuspend write
      `suspensionEndedFields` with the saved profile restored, with a test
      each.

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

- None blocking.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Old documents carry `suspendReason`/`suspendedAt` | The fix reads both names while clearing them. |

## Definition of Done

- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-16**: Filed from SHY-0597.
