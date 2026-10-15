---
id: SHY-0605
status: Draft
owner: unassigned
created: 2026-10-16
priority: P0
effort: M
estimate: 8
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0605: Ending a suspension puts everything back

## User Story

As **a learner whose suspension has ended**, I want my account back exactly
as I left it, so that an appeal I won, or a suspension I served, does not
cost me my introduction, my picture or my standing with my language
partners.

## Why

Found 2026-10-16 while working SHY-0597. Every suspension writes
`description: null` and `avatarUrl: null` (now in one place,
`suspensionStartedProfileFields` in `express-api/src/utils/suspension.js`)
but saves neither, so both are lost for good. `avatarUrl` is the sign-in
provider's photo, which the apps show whenever the user never uploaded their
own (`User.photoUrl` falls back to it).

Shyden ruled 2026-10-16 (AskUserQuestion): *"there's many other things that
are "removed" that must be restored after an account has been restored
access. make sure you check and verify everything goes back to normal, not
just the name"*. So this story covers everything, not only the bio.

What a suspension does today, and what ending it undoes (measured
2026-10-16 on develop `5c43f8761cd`):

| A suspension does | Where | Undone on ending? |
| --- | --- | --- |
| Saves then masks name, photo, cover | every start path | yes, except timed expiry: `users.js` `lift-suspension` restores nothing and nulls the saved values, so the user keeps "Suspended Account" for good |
| Blanks bio and sign-in photo, unsaved | every start path | **no** |
| Sets GCS to 0 with a `source: 'suspension'` warning | admin-users suspend | **no**, on no end path |
| Warning via `createWarning` | reports.js resolve | **no** |
| Bans devices and network (`autoApplyBans`) | admin-users suspend only | admin-users unsuspend only |
| Flags the user's suggestions | admin-users suspend only | admin-users unsuspend only |
| Evicts from rooms, clears `currentRoomId` | admin-users, reports.js | not needed: they rejoin |

Suspensions end in six places: admin-users unsuspend, reports.js admin
unsuspend, appeal approval (reports.js), timed expiry (users.js), and the
identity graph's unsuspend-all and per-node unsuspend (SHY-0606). Each
carries its own list.

## Acceptance Criteria

### Happy path

- [ ] One function ends a suspension (`endSuspension` beside the helpers in
      `express-api/src/utils/suspension.js`) and every end path calls it;
      no end path writes `isSuspended: false` itself, with a guard that
      finds a direct write in any route.
- [ ] Ending restores name, uploaded photo, cover, bio (`description`) and
      sign-in photo (`avatarUrl`); a suspension saves the last two beside
      the others (Shyden 2026-10-16: "Restore both").
- [ ] Ending revokes every unrevoked warning the suspension created and gives
      its GCS deduction back, capped at 100, keeping the warning in history
      marked revoked, the same as the admin "revoke warning" action. This
      holds on every ending: upheld appeal, admin lift, identity-graph lift
      and timed expiry (Shyden 2026-10-16: "Every ending").
- [ ] Ending lifts the device and network bans the suspension applied and
      unflags the suggestions it flagged, on every end path.
- [ ] One test per end path per effect, each RED against today's code.

### Error paths

- [ ] A failed step fails the request with an error the admin panel shows;
      it never answers success with part of the account still taken away.
- [ ] A user with no bio or sign-in photo saves `null` and restores nothing.

### Edge cases

- [ ] Suspending an already-suspended user keeps the first saved bio and
      sign-in photo (SHY-0597's rule).
- [ ] A warning revoked by hand during the suspension is not revoked twice
      and its GCS is not given back twice.
- [ ] Ending a suspension of a user who is not suspended changes nothing.

### Performance

- [ ] N/A: one user per call.

### Security

- [ ] A restored bio is rendered through the same escaping as any bio.
- [ ] Every end path keeps its existing admin or owner check, with a test.

### UX

- [ ] N/A: no new screens or copy.

### i18n

- [ ] N/A: no new copy.

### Observability

- [ ] Each ending writes one audit entry naming what was put back.

## BDD Scenarios

**Scenario: an appeal is upheld**

- **Given** a user with a bio, a sign-in photo and a GCS of 80 who was suspended
- **When** their appeal is approved
- **Then** their bio, photo and name are back, their GCS is 80 and the suspension warning shows as revoked

**Scenario: a timed suspension runs out**

- **Given** a user suspended for a day, whose devices were banned
- **When** they sign in after the day has passed
- **Then** the ban is lifted and their profile and GCS are as before

## Test Plan

1. Unit: `endSuspension` per effect, and each end path calls it (mocks only).
2. Integration: suspend then end a seeded user on each path and read back
   the profile, warnings, bans and suggestions.

## Out of Scope

- Making every suspension START the same way (SHY-0608).
- The identity graph's routes and dialog (SHY-0606).
- Accounts already affected in live data (SHY-0604).

## Dependencies

- None blocking.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Restoring brings back reported content | Shyden chose restore; a moderator can still clear a bio by hand. |
| GCS given back to someone who served a deserved suspension | Shyden chose every ending; the revoked warning stays in history. |

## Definition of Done

- [ ] Every AC above ticked with its test named in Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-16**: Filed from SHY-0597.
- **2026-10-16**: Shyden's rulings (AskUserQuestion): restore bio and sign-in photo; everything a suspension removes comes back; every ending gives the GCS back; every suspension starts the same way (SHY-0608). Re-scored 3 -> 8 from the inventory above: six end paths, five effects.
