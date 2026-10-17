---
id: SHY-0605
status: In Review
owner: unassigned
created: 2026-10-16
priority: P0
effort: L
estimate: 13
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
| Saves then masks name, photo, cover | the 4 masking start paths (admin-users suspend, reports.js x3) | yes, except timed expiry: `users.js` `lift-suspension` restores nothing and nulls the saved values, so the user keeps "Suspended Account" for good |
| Blanks bio and sign-in photo, unsaved | the same 4 start paths | **no** |
| Sets GCS to 0 with a `source: 'suspension'` warning | admin-users suspend | **no**, on no end path |
| Bans devices and network (`autoApplyBans`) | admin-users suspend only | admin-users unsuspend only |
| Flags the user's suggestions | admin-users suspend only | admin-users unsuspend only |
| Evicts from rooms, clears `currentRoomId` | admin-users, reports.js | not needed: they rejoin |

Suspensions end in five places that write the user: admin-users unsuspend,
reports.js admin unsuspend, appeal approval (reports.js), timed expiry
(users.js) and the identity graph's unsuspend-all. Each carries its own
list. The identity graph's per-node unsuspend touches only the graph node,
never the user (SHY-0606's).

Corrected 2026-10-16 on develop `8f20691fc33` (plan review passes 1-2):
the reports.js `createWarning` calls are the separate "warned" actions
(`source: 'report'`), not part of a suspension, and stay; only the
admin-users suspend writes a `source: 'suspension'` warning.

## Acceptance Criteria

### Happy path

- [x] One function ends a suspension (`endSuspension` in
      `express-api/src/utils/end-suspension.js`, beside the helpers in
      `suspension.js`) and every end path calls it;
      no end path writes `isSuspended: false` itself, with a guard that
      finds a direct write in any route.
- [x] Ending restores name, uploaded photo, cover, bio (`description`) and
      sign-in photo (`avatarUrl`); a suspension saves the last two beside
      the others (Shyden 2026-10-16: "Restore both").
- [x] An upheld appeal, and only an upheld appeal, revokes every unrevoked
      warning this suspension created and gives its GCS deduction back,
      capped at 100, keeping the warning in history marked revoked. It gives
      the GCS back like the admin "revoke warning" action but leaves
      `warningCount` alone, which a suspension warning never raised. An admin
      lift, identity-graph lift or timed expiry leaves the GCS and the
      warning as they are (Shyden 2026-10-17: "only successful appeals should
      restore the score").
- [x] "This suspension" starts at the first suspend of a run: suspending an
      already-suspended user keeps the run's start
      (`suspensionRunStartedAt`), so an upheld appeal gives back the first
      warning's deduction too, and never an earlier suspension's.
- [x] An appeal is tied to the exact suspension it answers and never reaches
      another (Shyden 2026-10-18: "appeals must be tied to the exact
      suspension that was given and cannot be allowed to leak into a
      different suspension/appeal"). Each suspension warning and each appeal
      records its run (`suspensionRunStartedAt`); an appeal made before that
      is placed by when it was made.
- [x] An appeal upheld after its suspension has ended (a timed one can run
      out while the appeal waits) still gives back that suspension's GCS,
      and ends nothing.
- [x] An earlier suspension's appeal, decided while a later suspension is in
      force, leaves the later suspension in force and its appeal fields
      untouched (a denial never forbids appealing the later one), and gives
      back only its own suspension's GCS (Shyden 2026-10-18).
- [x] Every suspension holds the score at 0 while it is in force: points an
      earlier appeal gives back during a later suspension are taken again on
      the later run's own warning, and come back if that appeal is upheld
      too (Shyden 2026-10-18).
- [x] An earlier suspension's pending appeal does not stop the user
      appealing the suspension in force; a second appeal of the same
      suspension is still refused 409.
- [x] Both appeal routes admit the same people through one check: a user who
      is not suspended is refused 400 and a suspension that cannot be
      appealed 403 (the app's route checked neither; Shyden 2026-10-18).
- [x] Ending lifts the device and network bans the suspension applied and
      unflags the suggestions it flagged, on every end path.
- [x] Every end path clears the suspension cache with the numeric user id
      (found in passing: the identity graph's unsuspend-all never clears
      it, so an unsuspended user stays blocked up to 5 minutes; appeal
      approval passes the raw appeal id).
- [x] The admin view of a suspended user shows the saved bio and sign-in
      photo beside the saved name, photo and cover (found in passing:
      `admin-users.js` shows only those three).
- [x] One test per end path per effect, each RED against today's code.

### Error paths

- [x] A failed step fails the request with an error the admin panel shows;
      it never answers success with part of the account still taken away.
- [x] A user with no bio or sign-in photo saves `null` and restores nothing.

### Edge cases

- [x] Suspending an already-suspended user keeps the first saved bio and
      sign-in photo (SHY-0597's rule).
- [x] A warning revoked by hand during the suspension is not revoked twice
      and its GCS is not given back twice.
- [x] Ending a suspension of a user who is not suspended changes nothing,
      on every end path (found in passing: reports.js admin unsuspend has
      no such check and rewrites and audits an unsuspended user).
- [x] Revoking a suspension warning by hand leaves `warningCount` alone
      (found in passing: the revoke route decrements it for every warning,
      though a suspension warning never incremented it).

### Performance

- [x] N/A: one user per call.

### Security

- [x] A restored bio is rendered through the same escaping as any bio.
- [x] Every end path keeps its existing admin or owner check, with a test.

### UX

- [x] N/A: no new screens or copy.

### i18n

- [x] N/A: no new copy.

### Observability

- [x] Each ending writes one audit entry naming what was put back.

## Announce

On the roadmap and in the release notes: when a suspension ends, by appeal,
by an admin or by running out, the account comes back as it was: name,
photos, bio, standing and access.

## BDD Scenarios

**Scenario: an appeal is upheld**

- **Given** a user with a bio, a sign-in photo and a GCS of 80 who was suspended
- **When** their appeal is approved
- **Then** their bio, photo and name are back, their GCS is 80 and the suspension warning shows as revoked

**Scenario: a timed suspension runs out**

- **Given** a user suspended for a day, whose devices were banned
- **When** they sign in after the day has passed
- **Then** the ban is lifted and their profile is as before, and their GCS stays where the suspension left it

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
| GCS given back to someone who served a deserved suspension | Only an upheld appeal gives it back (Shyden 2026-10-17); the revoked warning stays in history. |

## Definition of Done

- [ ] Every AC above ticked with its test named in Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-16**: Filed from SHY-0597.
- **2026-10-16**: Shyden's rulings (AskUserQuestion): restore bio and sign-in photo; everything a suspension removes comes back; every ending gives the GCS back; every suspension starts the same way (SHY-0608). Re-scored 3 -> 8 from the inventory above: six end paths, five effects.
- **2026-10-16**: In Progress on `story/SHY-0605-ending-a-suspension-restores-everything`. Inventory corrected from the plan's review passes (five end paths write the user; four start paths mask; the `createWarning` row was the separate warned action). Found in passing and folded in: the cache clear on every end path, the admin view of the saved bio and photo, reports.js unsuspend's missing not-suspended check, and the revoke route's `warningCount` decrement. Estimate stays 8.
- **2026-10-17**: Shyden reversed the GCS ruling: *"if the suspension is lifted due to anything other an an appeal. do not restore the score. only successful appeals should restore the score"*. A run start (`suspensionRunStartedAt`) bounds the appeal's revoke, so a re-suspension's first warning is included and an earlier suspension's never is.
- **2026-10-17**: In Review. Proof per AC (unit tests mock every service; the
  integration and web tests run in CI and are confirmed on the PR's run):
  - One ending + guard: `tests/utils/end-suspension.unit.test.js`; guard
    `tests/scripts/suspension-ends-in-one-place.test.js` (149 src files; red on
    the pre-change tree at all five paths; 28 planted forms red, 12 green).
  - Restores five fields: `end-suspension.unit.test.js` "puts the ... back";
    integration `tests/routes/suspension-ending-restores-everything.test.js`
    per end path.
  - GCS only on an upheld appeal: `end-suspension.unit.test.js` "reads and revokes no
    warning when the ending is not an upheld appeal"; E3 route test "with the
    GCS given back"; guard "only the upheld appeal gives the GCS back";
    integration per path.
  - Run start, re-suspension, hand-revoked warning, no-field warning:
    `end-suspension.unit.test.js` (commit 4).
  - Bans and suggestions on every path: `end-suspension.unit.test.js` "lifts the
    auto-applied bans", "unflags the suggestions"; each route calls it (guard).
  - Cache by numeric id: `end-suspension.unit.test.js` "clears the suspension cache
    by the numeric id after the write".
  - Admin view: `admin-users-missing-moderation.test.js` (4); web test 17.
  - One test per end path per effect, red on today's code: each route file's
    tests run against the pre-change routes: 7, 12, 5 and 4 failures.
  - Failed step: each route's "answers 500 naming the step"; the panel shows it
    (`apiCall` throws `data.error`; users.js and appeals.js toast it).
  - Not suspended changes nothing: "answers alreadyUnsuspended" (E1, E2);
    `end-suspension.unit.test.js` "does nothing for a user who is not suspended".
  - warningCount on revoke: `utils/warnings` tests (commit 2).
  - Escaping: web test 17 plants markup in a bio and asserts it is shown as
    text with no elements. Bios elsewhere render through Compose `Text` (apps)
    and are not rendered on the public web.
  - Auth kept: each route's 403 test (E1, E2, E3, E5 admin; E4 owner).
  - Audit entry: `end-suspension.unit.test.js` "writes the audit entry in the shape
    the audit log page reads"; integration "records one ending".
  - Mutations: 34 predicted, none survived (routes M1-M16, admin view V1-V3,
    guard reader G1-G15).
  - Found in passing, filed: SHY-0623 (#2394), seven undeclared packages.
- **2026-10-18**: CI on `3de05eb44e9` red on two whole-repo file-count floors
  this branch's new files moved (re-measured: 2004 -> 2013, 472 -> 475). A
  side note then showed an appeal upheld after its suspension timed out gave
  nothing back, and that a leftover appeal could block or lift a later,
  separate suspension. Shyden ruled appeals are tied to their exact
  suspension, an old appeal leaves a later suspension in force, appeals from
  a user who is not suspended are refused, and every suspension holds the
  score at 0 while in force (memory `project-suspension-restores-everything`).
  Six criteria added; re-scored 8 -> 13 (two more routes, the appeal record,
  the per-suspension pending check and the held score). Proof per criterion:
  - Tied to its suspension: `tests/utils/appeals.unit.test.js`
    "appealedSuspension" (12); warnings tagged: `admin-users-write.test.js`
    "the warning names its suspension"; appeals record it: "createAppeal".
  - Upheld after it ended: `end-suspension.unit.test.js` "gives back the GCS
    of an appealed suspension that already ended, ending nothing";
    integration "an appeal upheld after its suspension ran out".
  - Earlier appeal, later suspension in force: `end-suspension.unit.test.js`
    "gives back an earlier suspension's GCS and leaves the later one in
    force"; `reports-coverage-appeals.test.js` "an appeal of an earlier
    suspension, a later one in force" (5); integration, same name (4).
  - Score held at 0: `end-suspension.unit.test.js` "a later suspension in
    force holds what comes back" (7); integration "upholding both appeals".
  - Pending check per suspension: `appeals.unit.test.js` "findPendingAppeal";
    each route's "accepts an appeal while an earlier suspension's appeal is
    still pending" and 409 test.
  - One admission check: `appeals.unit.test.js` "appealRefusal" (6);
    `users-missing.test.js` 400 and 403 (the app's own screen shows the form
    only when `canAppeal`, `SuspensionScreen.kt:229`).
  - Unit gate 105 files 2,778/2,778 (`daedc86591e` then re-ran its 3 files,
    168/168). Mutations: 15 (N1-N15) then 35 (P1-P36), none survived.
