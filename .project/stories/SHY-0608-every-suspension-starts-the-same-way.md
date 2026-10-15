---
id: SHY-0608
status: Draft
owner: unassigned
created: 2026-10-16
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: true
blocked_by: [SHY-0605]
---

# SHY-0608: Every suspension starts the same way

## User Story

As **Shyden, the operator**, I want a suspension to do the same things
whichever screen or report it comes from, so that a suspended user cannot
slip back in on a device a report-driven suspension left unbanned, and so
that ending any suspension knows exactly what to undo.

## Why

Found 2026-10-16 while working SHY-0605's inventory (develop `5c43f8761cd`).
Suspensions start in five places, and they disagree:

| Start path | Mask profile | GCS warning | Device/network bans | Flag suggestions | Evict |
| --- | --- | --- | --- | --- | --- |
| admin-users `POST /user/:id/suspend` | yes | yes, GCS to 0 | yes | yes | yes |
| reports.js resolve | yes | `createWarning` | no | no | yes |
| reports.js bulk resolve | yes | no | no | no | yes |
| reports.js `POST /admin/users/:id/suspend` | yes | no | no | no | yes |
| identity-graph `suspend-all` | no | no | no | no | no |

Shyden ruled 2026-10-16 (AskUserQuestion, "Yes, every suspension"): one
shared start step that every path uses, so a report-driven suspension also
bans devices and network and flags suggestions.

## Acceptance Criteria

### Happy path

- [ ] One function starts a suspension (`startSuspension` beside
      `endSuspension` in `express-api/src/utils/suspension.js`); every start
      path calls it, with a guard that finds a direct `isSuspended: true`
      write in any route.
- [ ] Every start path saves and masks the profile, records the GCS warning,
      bans devices and network, flags suggestions and evicts from rooms,
      with one test per path per effect, each RED against today's code.
- [ ] Every effect started here is undone by SHY-0605's `endSuspension`,
      shown by a suspend-then-end test per start path.

### Error paths

- [ ] A failed step fails the request with an error the admin panel shows;
      it never answers success with the suspension half applied.

### Edge cases

- [ ] Suspending an already-suspended user keeps the first saved profile and
      does not take GCS twice.

### Performance

- [ ] Bulk resolve suspends each user once, however many reports name them.

### Security

- [ ] Every start path keeps its existing admin check, with a test.

### UX

- [ ] N/A: no new copy.

### i18n

- [ ] N/A.

### Observability

- [ ] Each start writes one audit entry naming what was applied.

## BDD Scenarios

**Scenario: a report is resolved with a suspension**

- **Given** a reported user signed in on one device
- **When** a moderator resolves the report with a suspension
- **Then** the device is banned, the suggestions are flagged and the profile is masked, as from the Users tab

## Test Plan

1. Unit: `startSuspension` per effect, and each start path calls it (mocks only).
2. Integration: suspend a seeded user from each path and read back every effect.

## Out of Scope

- Ending a suspension (SHY-0605).
- The identity graph's dialog (SHY-0606).

## Dependencies

- SHY-0605: `endSuspension` must undo everything this starts.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Report suspensions become stricter than before | Shyden chose this 2026-10-16. |
| A shared device bans an innocent second user | The existing auto-ban rules apply unchanged; ending lifts them. |

## Definition of Done

- [ ] Every AC ticked with its test named in Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-16**: Filed from SHY-0605's inventory; Shyden's ruling above. Scored 5: five start paths, five effects, most already written once in admin-users.
