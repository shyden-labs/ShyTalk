---
id: SHY-0605
status: Draft
owner: unassigned
created: 2026-10-16
priority: P0
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0605: A suspension wipes a user's bio and avatar for good

## User Story

As **a learner whose suspension has ended**, I want my profile back as I left
it, so that an appeal I won does not cost me the introduction I wrote for my
language partners.

## Why

Found 2026-10-16 while working SHY-0597. Every suspension writes
`description: null` and `avatarUrl: null` (now in one place,
`suspensionStartedProfileFields` in `express-api/src/utils/suspension.js`),
but saves neither. Display name, profile photo and cover photo are saved and
restored on unsuspend; the bio and avatar are not. So a user whose appeal is
approved gets their name back and loses their bio and avatar permanently.

Whether that is intended is not written anywhere: a bio may be the very
content that was reported. That choice is Shyden's.

## Acceptance Criteria

### Happy path

- [ ] Shyden's decision is recorded in Notes: restore the bio and avatar on
      unsuspend, or keep them wiped (and say so to the user).
- [ ] If restore: a suspension saves `description` and `avatarUrl` beside the
      other saved fields, and every unsuspend path restores them, with a
      test per path.
- [ ] If wiped: the unsuspend message tells the user their bio was removed.

### Error paths

- [ ] A user with no bio or avatar saves `null` and restores nothing.

### Edge cases

- [ ] Suspending an already-suspended user keeps the first saved bio and
      avatar (same rule as SHY-0597).

### Performance

- [ ] N/A.

### Security

- [ ] A restored bio is rendered through the same escaping as any bio.

### UX

- [ ] N/A unless Shyden chooses "wiped", then the message above.

### i18n

- [ ] Any new message is translated and read back by Google Cloud
      Translation before it ships.

### Observability

- [ ] N/A.

## BDD Scenarios

**Scenario: an appeal is approved**

- **Given** a user with a bio and avatar who was suspended
- **When** their suspension ends
- **Then** their profile is as Shyden decided: restored, or wiped with a message

## Test Plan

1. Unit: the saved fields and each unsuspend path (mocks only).
2. Integration: suspend then unsuspend a seeded user and read the profile.

## Out of Scope

- Names lost before SHY-0597 (SHY-0604).

## Dependencies

- None blocking.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Restoring brings back the reported content | Shyden decides; a moderator can still clear a bio by hand. |

## Definition of Done

- [ ] Decision recorded; ACs for that decision ticked.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-16**: Filed from SHY-0597.
