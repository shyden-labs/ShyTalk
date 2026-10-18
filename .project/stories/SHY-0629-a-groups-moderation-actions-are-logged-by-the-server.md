---
id: SHY-0629
status: Draft
owner: claude
created: 2026-10-18
priority: P1
effort: L
estimate: 13
type: feature
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0629: A group's moderation actions are logged by the server

## User Story

As a platform moderator looking into a group, and as a group's own admins,
I want every moderation action taken in a group (hiding a message, muting
or removing a member, changing roles) recorded by the server, so that I can
see who did what to whom and when, and nobody can leave an action out or
make one up.

## Why

Found on 2026-10-18 while taking SHY-0614's inventory, at `c19df941c00`:
the `conversations/{id}/mod_log` collection has a rule but no writer and no
reader anywhere (apps, website, server). Group moderation actions are phone
writes (`PrivateMessageRepositoryImpl`: `hideMessage`, `muteGroupMember`,
`unmuteGroupMember`, `removeGroupParticipant`, `updateGroupRoles`,
`transferOwnership`, `closeGroupConversation`; iOS twins in
`IosPrivateMessageRepositoryImpl`) and none of them is recorded. SHY-0614
locks `mod_log` against phone writes; this story gives it a real, honest
writer.

Filed on 2026-10-18 at Shyden's choice ("Lock it, file a log story").

## Acceptance Criteria

### Happy path

- [ ] First, every group moderation action (both apps and the website) is
      listed per call site in Notes, with what each changes.
- [ ] Each listed action goes through a server route that, in one
      transaction, applies the action and writes a `mod_log` entry from the
      action itself: who acted, what, to whom, when, and on which message.
- [ ] Both apps call those routes; none of those actions is a phone write
      any more.
- [ ] Platform admins can read a group's log from the admin panel; the
      group's admins and mods can read their own group's log.

### Error paths

- [ ] Each route refuses a caller without the role the action needs, a
      banned caller and a conversation flagged `crossCohortAtMigration`.
- [ ] The rules refuse the phone writes each route replaces.

### Edge cases

- [ ] An action that changes nothing (muting a muted member) writes no
      entry.
- [ ] A removed or departed admin's past entries still show who they were.

### Performance

- [ ] Each action takes no longer than today's direct write plus one round
      trip, measured on dev.

### Security

- [ ] Rules tests in the emulator prove each refusal, one test per case,
      each seen RED against today's rules first.
- [ ] A security review of the routes and rules is recorded in the PR.

### UX

- [ ] Every moderation action looks and behaves the same to the user.

### i18n

- [ ] The log's labels are translated in every shipped locale and read back
      by Google Cloud Translation before commit.

### Observability

- [ ] A refused direct write is logged by source with the app version.

## BDD Scenarios

**Scenario: a hide is on the record**

- **Given** M is a mod of a group and B posted "spam link"
- **When** M hides the message in the app
- **Then** the group's log shows M hid B's message, and when

**Scenario: a mod cannot leave an action off the record**

- **Given** M is a mod of a group
- **When** M's device mutes a member directly
- **Then** Firestore refuses the write

## Test Plan

- Firestore rules tests (emulator), one per refusal, each seen RED first.
- Route tests in `express-api` per action.
- Android and iOS: the same tests for each changed call (same steps, same
  strictness).
- Journey: a mod hides and mutes, an admin reads the group's log.

## Out of Scope

- Platform admin actions (SHY-0622, the admin audit log).
- Hiding a message's `hiddenBy` check (SHY-0614 binds it now).

## Dependencies

- None blocking. SHY-0614 locks `mod_log`; this story writes it.

## Risks & Mitigations

- Many actions across both apps: the first AC lists them all, and the story
  may split per action group once measured.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; journey green on dev.

## Notes

- **2026-10-18**: Filed at Shyden's choice. P1, not P0: once SHY-0614 locks
  `mod_log`, nothing can be forged; this adds a record that never existed.
  MVP false: no launch user meets a group log, and launch moderation runs on
  reports (assumed; Shyden may re-rank). Scored 13: seven actions moved to
  server routes across both apps, a reader in the admin panel and the app,
  rules tests and a journey; larger than SHY-0614 (8), which moves two.
