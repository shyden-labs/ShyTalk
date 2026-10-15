---
id: SHY-0604
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

# SHY-0604: Find live accounts a suspension left worse off

## User Story

As **Shyden, the operator**, I want to know whether any live account is still
missing something a suspension took, or is still suspended past the length
an admin chose, and get it back where I can, so that every user whose
suspension ended has their account back as it was.

## Why

Found 2026-10-16 while working SHY-0597. Until SHY-0597's fix, every suspend
path saved the profile and then masked it with no check for a user already
suspended. A second suspension saved the mask "Suspended Account" as the
real name; unsuspend then restored the mask for good, and the admin panel
showed it too. The nightly run 38694041358 (2026-10-15) shows it happen to a
test user. The fix stops new cases; it cannot bring back a name already
lost. Whether any live user was hit is not known from code.

Shyden ruled 2026-10-16 (AskUserQuestion): file this as its own P0 ticket;
the code fix does not wait for it. Reading live data needs his approval.

Later the same day he approved the read-only check, proven on dev first, and
widened it: *"there's many other things that are "removed" that must be
restored after an account has been restored access. make sure you check and
verify everything goes back to normal, not just the name"*. SHY-0605's
inventory lists what a suspension takes: the name, photos, bio and sign-in
photo, GCS (through a suspension warning), device and network bans and
suggestion flags. Until SHY-0605, most endings gave back only some of it.

Also found 2026-10-16 (SHY-0606): the identity graph's suspend-all never
stored an end date, so a "1 day" identity suspension never ended by itself.
Users suspended that way may still be suspended past the length chosen.

## Acceptance Criteria

### Happy path

- [ ] A read-only query, proven on dev, then run on production through a
      step Shyden approves, counts live users who are not suspended and
      still carry any effect of an ended suspension: the "Suspended Account"
      name, a blank bio or sign-in photo with a saved value, an unrevoked
      `source: 'suspension'` warning, a device or network ban the
      suspension applied, or a suggestion flagged `submitter_suspended`.
      Counts per effect and the query are written in Notes.
- [ ] The same run lists users still suspended by the identity graph
      (`suspendedAt` set, no `suspensionStartDate`) whose chosen
      `identityGraphs/{id}.suspendDuration` has already passed; lifting any
      of them waits for Shyden's approval.
- [ ] Users who may have lifted a permanent suspension themselves (SHY-0611)
      are listed from the API's logs, the only record left (lifting nulls
      `suspensionEndDate`): a `Lifting expired suspension` line for a user
      whose last `Suspending user` line says `endDate: 'permanent'`. Only the
      admin-users suspend logs that line; suspensions from reports.js log no
      end date, so Notes say they could not be checked. The log retention
      window searched is written in Notes; re-suspending anyone waits for
      Shyden's approval.
- [ ] For each account found, the real name is looked for in the evidence
      that exists (backups taken before the second suspension, the admin
      audit log, app logs) and the source is written in Notes.
- [ ] Each account whose name is found is restored only with Shyden's
      approval, and the restore is read back.

### Error paths

- [ ] An account whose real name cannot be found is listed for Shyden with
      what was searched; nothing is guessed.

### Edge cases

- [ ] Users still suspended are counted separately: their saved name may
      already be the mask, which unsuspend would restore.

### Performance

- [ ] N/A: a one-off read.

### Security

- [ ] The query is read-only and runs under Shyden's production approval;
      no production credential is stored outside its environment.

### UX

- [ ] N/A: no screen changes.

### i18n

- [ ] N/A: no new copy.

### Observability

- [ ] N/A: one-off check.

## BDD Scenarios

**Scenario: a live account lost its name**

- **Given** a live user who is not suspended and is named "Suspended Account"
- **When** the check runs with Shyden's approval
- **Then** the account is listed with where its real name can be found

**Scenario: no account was hit**

- **Given** no live user matches
- **When** the check runs
- **Then** Notes record a count of zero and the query used

## Test Plan

1. Run the read-only count on dev first to prove the query (the nightly's
   test users show the pattern there too).
2. Run it on production only with Shyden's approval.

## Out of Scope

- The code fixes (SHY-0597, SHY-0605, SHY-0606, SHY-0608). Bios and sign-in
  photos wiped before SHY-0605 were never saved; this check lists them for
  Shyden, it cannot recover them without a backup.

## Dependencies

- None blocking.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A real user is named "Suspended Account" by choice | Each match is checked against its suspension history before any restore. |

## Definition of Done

- [ ] Count recorded; every match resolved or handed to Shyden.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-16**: Filed from SHY-0597's cause (nightly 38694041358).
- **2026-10-16**: Shyden approved the read-only check ("Yes, after dev proves it") and widened it to everything a suspension takes (quote in Why). Lapsed identity suspensions added from SHY-0606's finding. Blocked by SHY-0605, whose `endSuspension` is how any repair is applied. Re-scored 3 -> 5: five effects plus the lapsed identity list.
