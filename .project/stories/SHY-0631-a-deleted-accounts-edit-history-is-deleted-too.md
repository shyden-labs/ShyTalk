---
id: SHY-0631
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
---

# SHY-0631: A deleted account's edit history is deleted too

## User Story

As someone who deletes their ShyTalk account, I want every copy of what my
messages said deleted with it, including the earlier versions of messages I
edited, so that deleting my account really removes my words.

## Why

Found on 2026-10-18 while designing SHY-0614, read at `c9e7227`:
`deleteOneOnOneConversation` in `express-api/src/cron/accountDeletion.js`
says it deletes "a 1-on-1 conversation and all its subcollections", but it
lists only `messages`, `userSettings` and `mutes`. Firestore never deletes a
document's subcollections with it, so every `messages/{id}/edits/{id}` entry,
each holding a `previousText`, survives the account's deletion with no
parent document. Nothing reads those orphans in the apps (the rules read gate
needs the deleted conversation), but the words stay stored.

SHY-0219 (#1636) is the compliance suite whose erasure test would catch
this; it does not fix it.

## Acceptance Criteria

### Happy path

- [ ] First, every server path that deletes conversation messages is listed
      in Notes, with the subcollections each leaves behind.
- [ ] Each of those paths deletes every subcollection under each message it
      deletes (`edits` today; SHY-0614's `recall` once it lands).
- [ ] A one-off clean-up removes the orphaned `edits` already in dev and
      production, counted before and after.

### Error paths

- [ ] A failure partway leaves the deletion resumable on the next cron run,
      and the run reports it rather than ending green.

### Edge cases

- [ ] A message with many edits is fully deleted (batch limits respected).
- [ ] A group conversation the user only leaves keeps the other members'
      history (today's behaviour).

### Performance

- [ ] The deletion cron's run time is measured before and after on dev.

### Security

- [ ] An integration test seeds a 1:1 conversation with edited messages,
      deletes the account, and finds no document left under it, seen RED
      against today's code first.

### UX

- [ ] Not applicable: no screen changes.

### i18n

- [ ] Not applicable: no user-facing text.

### Observability

- [ ] The cron logs how many messages and subcollection documents it
      deleted per account (counts only).

## BDD Scenarios

**Scenario: a deleted account leaves no edit history behind**

- **Given** A and B's conversation, where B edited "hello" to "hi"
- **When** B's account deletion runs
- **Then** no document is left under that conversation, `edits` included

## Test Plan

- Integration test (emulator, CI) per path, RED first against today's code.
- Unit tests of the path-listing with Firestore stood in.
- Clean-up counts recorded in the PR for dev; production is Shyden's run.

## Out of Scope

- The recall record's own deletion (SHY-0614 deletes what it creates).
- Group messages of a deleted member (kept today; SHY-0219's policy AC).

## Dependencies

- None blocking.

## Risks & Mitigations

- The clean-up deletes the wrong documents: it deletes only `edits` whose
  parent message no longer exists, dry run first with counts.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; clean-up run on dev and its counts recorded.

## Notes

- **2026-10-18**: Filed while designing SHY-0614. P0 as a data-protection
  defect (erased words kept). MVP: launch users delete accounts. Scored 3:
  one cron path, a clean-up script and their tests; larger than SHY-0630 (2).
