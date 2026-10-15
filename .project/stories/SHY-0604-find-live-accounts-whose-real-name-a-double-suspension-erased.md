---
id: SHY-0604
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

# SHY-0604: Find live accounts whose real name a double suspension erased

## User Story

As **Shyden, the operator**, I want to know whether any live account lost its
real name to the double-suspension bug, and get it back where I can, so that
no user is left named "Suspended Account" after their suspension ended.

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

## Acceptance Criteria

### Happy path

- [ ] With Shyden's approval, a read-only query counts live users who are
      not suspended and whose `displayName` is "Suspended Account", and the
      count and the query are written in Notes.
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

- The code fix (SHY-0597).
- Bios and avatars wiped by suspension (SHY-0605).

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
