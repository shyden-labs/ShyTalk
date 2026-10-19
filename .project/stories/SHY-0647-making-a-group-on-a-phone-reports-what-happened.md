---
id: SHY-0647
status: Draft
owner: claude
created: 2026-10-19
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
---

# SHY-0647: Making a group on a phone reports what happened

## User Story

As someone starting a group chat on my phone, I want the app to tell me the
group was made when it was, and to tell me plainly when it was not, so that
I never see a failure for a group that now exists, or make it twice.

## Why

Found on 2026-10-19 while planning SHY-0645 (a reaction journey that makes a
group over the network). Suspected, not yet proven.

Both apps make a group the same way (`PrivateMessageRepositoryImpl.createGroupConversation`
on Android, `IosPrivateMessageRepositoryImpl.createGroupConversation` on
iPhone): create the group with the creator alone, add each member, then
write every member's `conversations/{id}/userSettings/{pid}` row in ONE
batch. The rules allow a `userSettings` write only for the person's own row,
or by someone in the group's `groupAdminIds`. A new group's `groupAdminIds`
is empty unless the creator promoted someone (`GroupSetupViewModel` starts
everyone as MEMBER), so the batch writes the other members' rows without
permission. A batch is all or nothing, so the whole batch would be refused,
and `createGroupConversation` would return an error AFTER the group and its
members were already written.

No test has walked this on the real rules: `GroupChatCreationTest` uses a
fake repository, and j28's "Alice makes a group" is a Web step.

## Acceptance Criteria

### Happy path

- [ ] First, a rules test proves or disproves it: the creator of a new group
      with no admins writes a member's `userSettings` row (expected refused)
      and their own row (expected allowed). The result is recorded here
      before any fix.
- [ ] If refused: the apps make a group without asking for writes the rules
      refuse (the server already writes each recipient's row when a message
      is sent, `express-api/src/routes/conversations.js`), and making a group
      on each phone reports success, opens the group, and shows it to the
      members.
- [ ] If allowed: this story records why, and closes with the rules test as
      its guard.

### Error paths

- [ ] A group creation that really fails says so and leaves no half-made
      group the person cannot see (j28 "A group creation that fails leaves
      nothing behind").

### Edge cases

- [ ] A group where the creator promoted a member to admin is made the same
      way and reports the same success.

### Performance

- [x] Not applicable: the change removes writes, it adds none.

### Security

- [ ] The rules stay as strict: no person may write another member's
      `userSettings` row unless they are that group's admin.

### UX

- [ ] No failure message is shown for a group that was made.

### i18n

- [x] Not applicable: no new copy (the existing error string stays).

### Observability

- [ ] A refused group write is logged on the device with the step that
      failed (create, add, settings).

## Announce

If proven and fixed: making a group on your phone no longer shows an error
when the group was made.

## BDD Scenarios

**Scenario: the creator writes only what the rules allow**

- **Given** Alice makes a group with Theo and Selma and promotes nobody
- **When** the app writes the group's settings
- **Then** every write it makes is one the rules allow

**Scenario: a made group reports success**

- **Given** Alice is on her phone making a group with Theo and Selma
- **When** she taps create
- **Then** the group opens and Theo and Selma see it in their messages

## Test Plan

- Rules test in `express-api/tests/firestore-rules/` (CI's rules suite):
  creator writes a member's row in a no-admin group; creator writes own row.
- Shared/Android unit tests of the repository with the Firestore client
  stood in: the writes it asks for.
- A runner journey step makes a group on each phone (one definition, both
  phones).

## Out of Scope

- Group admin and moderator rules beyond `userSettings`.
- Reactions (SHY-0644, SHY-0645).

## Dependencies

- None.

## Risks & Mitigations

- The suspicion is wrong (another path writes the rows): the first AC
  proves it either way before any code changes.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; green on dev on both phones; Shyden signs off the phones.

## Notes

- **2026-10-19**: Filed from SHY-0645's plan review. P0: a defect if
  proven (every defect is P0). MVP: a launch user making a group meets it.
  Scored 5: one rules test, the same change in two repository files, unit
  tests, one journey step on two phones.
