---
id: SHY-0611
status: Draft
owner: unassigned
created: 2026-10-16
priority: P0
effort: S
estimate: 2
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0611: A permanently suspended user can lift their own suspension

## User Story

As **Shyden, the operator**, I want a permanent suspension to stay in place
until a moderator lifts it, so that "permanent" protects the community it
was given to protect.

## Why

Found 2026-10-16 while working SHY-0605. `POST /api/users/:uniqueId/lift-suspension`
(`express-api/src/routes/users.js`) is open to suspended users
(`isSuspensionExemptPath` in `middleware/auth.js`) so that a timed suspension
can end itself when the app sees it has run out. Its only check is
`if (suspensionEndDate && suspensionEndDate > now())`. A permanent
suspension has no end date, so the check is skipped and the owner is
unsuspended. The apps never send it for a permanent suspension
(`User.isActivelySuspended`: `suspensionEndDate ?: return true // permanent`),
but anyone can send it by hand.

A test pins the hole as intended:
`express-api/tests/routes/users-missing.test.js:293`, "returns 200 and lifts
a permanent (null endDate) expired suspension" (added 2026-03-13 in a
coverage batch). Shyden ruled 2026-10-16 (AskUserQuestion, "Fix it, flip
that test"): fix it as its own P0, next, ahead of SHY-0605.

## Acceptance Criteria

### Happy path

- [ ] A timed suspension whose end date has passed is still lifted by its
      owner, with a test.

### Error paths

- [ ] A permanent suspension (no end date) is refused with 400 and
      `Suspension is permanent`, and nothing is written; the test at
      `users-missing.test.js:293` becomes this case, RED against today's code.
- [ ] A timed suspension not yet over is still refused (existing test kept).

### Edge cases

- [ ] An end date stored under the old snake_case name is read the same way.

### Performance

- [ ] N/A.

### Security

- [ ] The route keeps its owner check, with a test that another user cannot
      lift someone else's suspension.

### UX

- [ ] N/A: the apps never send this for a permanent suspension.

### i18n

- [ ] N/A: the message is an API error, not shown in the apps.

### Observability

- [ ] A refused self-lift of a permanent suspension is logged as a warning
      with the user id.

## BDD Scenarios

**Scenario: a permanently suspended user calls the lift route by hand**

- **Given** a user suspended with no end date
- **When** they POST to their own lift-suspension route
- **Then** they get 400 and stay suspended

## Test Plan

1. Unit (mocks only): flip the pinned test, RED first; the timed and not-yet-over cases.

## Out of Scope

- What a timed expiry restores (SHY-0605).
- Whether any live user already used the hole (SHY-0604's live check lists users unsuspended with no end date and no admin audit entry).

## Dependencies

- None blocking.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A client relies on lifting a null end date | Both apps treat null as permanent and never call it then (`User.isActivelySuspended`). |

## Definition of Done

- [ ] Every AC ticked with its test named in Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-16**: Filed from SHY-0605's inventory on Shyden's ruling above.
