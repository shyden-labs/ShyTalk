---
id: SHY-0628
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
---

# SHY-0628: A room message's edit keeps its history, written by the server

## User Story

As a moderator acting on a report from a room, I want every edit of a room
message to keep what it said before, written by the server, so that
nobody can say something abusive in a room and then edit it away.

## Why

Found on 2026-10-18 while taking SHY-0614's inventory, at `c19df941c00`:
room message edits (`MessageRepositoryImpl.editMessage`, Android;
`IosMessageRepositoryImpl.editMessage`, iOS) update `text`, `isEdited` and
`editedAt` straight from the phone and keep no history at all.
`rooms/{id}/messages/{id}` `allow update` lets the sender change any field.
A room member can post abuse, wait, then edit it to something harmless, and
a moderator who opens the report sees only the harmless text.

Split out of SHY-0614 on 2026-10-18 (Shyden, "Split into three").

## Acceptance Criteria

### Happy path

- [ ] Editing a room message's text goes through one server route that, in
      one transaction, saves the current text as a history entry (editor,
      time and previous text read from the stored message, never from the
      request) and updates the message.
- [ ] Both apps call that route; neither writes a room message's text
      directly any more.
- [ ] Only admins can read a room message's history.

### Error paths

- [ ] The rules refuse a client update that changes a room message's
      `text`, `isEdited` or `editedAt`, and every client write to its
      history.
- [ ] The route refuses an edit by anyone but the sender, by a banned user,
      on a `SYSTEM`, `JOIN` or `GIFT` message, or in a closed room.

### Edge cases

- [ ] Two edits at once both land in history, in order (transaction).
- [ ] Apps still in use that write directly get a clear error, not a silent
      loss: the edit fails visibly and asks the user to update.

### Performance

- [ ] A room edit takes no longer than today's direct write plus one round
      trip, measured on dev.

### Security

- [ ] Rules tests in the emulator prove each refusal, one test per case,
      each seen RED against today's rules first.
- [ ] A security review of the route and rules is recorded in the PR.

### UX

- [ ] Editing a room message looks and behaves the same to the user.

### i18n

- [ ] The "update the app" error reuses SHY-0614's translated text, or any
      new text is translated in every shipped locale and read back by Google
      Cloud Translation before commit.

### Observability

- [ ] A refused direct write is logged by source with the app version.

## BDD Scenarios

**Scenario: a room edit keeps what it said before**

- **Given** B's room message "you are stupid"
- **When** B edits it to "hello" in the app
- **Then** the room shows "hello"
- **And** an admin can read "you are stupid" in its history

**Scenario: a modified app cannot edit a room message without history**

- **Given** B's room message "you are stupid"
- **When** B's device updates its text directly
- **Then** Firestore refuses the write

## Test Plan

- Firestore rules tests (emulator), one per refusal, each seen RED first.
- Route tests in `express-api` for the transaction, sender, ban, type and
  closed-room checks.
- Android and iOS: the same tests for calling the route (same steps, same
  strictness).
- Journey: edit a room message, an admin reads its history.

## Out of Scope

- Private and group messages (SHY-0614).
- Showing room history in the moderation screen beyond the report
  (SHY-0627 saves it with the report).

## Dependencies

- None blocking. Shares the "update the app" error with SHY-0614.

## Risks & Mitigations

- Old apps break on room edit: the error is clear and the force-update path
  covers it.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; journey green on dev.

## Notes

- **2026-10-18**: Split out of SHY-0614 (Shyden). P0 as a security defect
  (an abusive room message can be edited away with no trace). MVP: launch
  users meet it. Scored 5: one route, rules for one path, both apps, rules
  tests and a journey; smaller than SHY-0614 (8), which has two routes.
