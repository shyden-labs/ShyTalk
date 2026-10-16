---
id: SHY-0614
status: Draft
owner: claude
created: 2026-10-16
priority: P0
effort: L
estimate: 13
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
---

# SHY-0614: A message's edit history, a group's moderation log and a report's message text cannot be skipped or forged

## User Story

As a moderator protecting a community that includes minors, I want a
message's edit history, a group's moderation log and the message text saved
with a report to be records nobody can leave out or make up, so that what I
see is what actually happened when I act on a report.

## Why

A side agent pointed out on 2026-10-16 that message edit history is written
by the sender's own phone. Checked the same day in `firestore.rules` on
`origin/develop` (`conversations/{id}` block):

- **Edit history can be skipped.** `messages/{id}` `allow update` lets the
  sender (or a group admin or mod) change any field, the text included.
  Nothing requires the matching `edits` entry in the same write, so a
  modified app can rewrite a message and leave no history.
- **Edit history can be forged.** `messages/{id}/edits/{id}` `allow create`
  lets ANY participant add an entry to ANY message in the conversation, with
  any content. Nothing checks `previousText` against the message's real text.
  One participant can put made-up "previous text" on another person's message.
- **The group moderation log can be forged.** `mod_log` `allow create` lets
  a group admin or mod write any entry from their device, with no check of
  who acted or what was done.

Both apps write these directly (`PrivateMessageRepositoryImpl.kt`
`editMessage`, Android; `IosPrivateMessageRepositoryImpl.kt` `editMessage`,
iOS): an atomic batch of the `edits` entry plus the message update. The
honest app writes the history correctly; the rules do not make it.

- **A report's message text can be made up.** `POST /reports`
  (`routes/reports.js`) saves `messageText` from the request body, checked
  only for length, and never reads the real message by `conversationId` and
  `messageId`. A modified app can report someone for words they never wrote,
  and the moderator sees the made-up text. (Found by a second side-agent
  note, checked 2026-10-16 on `2aebea9324b`; the first version of this
  story wrongly called reports "not affected". The other report and appeal
  routes take no reported content from the client; `appealText` is the
  appealing user's own words.)

Related, not duplicated: SHY-0403 (#1927) covers moderators seeing edit
history and its zero tests today; it does not cover forging or skipping.
SHY-0613 (#2373) puts these trails in the release suite.

## Acceptance Criteria

### Happy path

- [ ] First, every client write to `messages`, `edits` and `mod_log` (both
      apps and the website) is listed per call site in Notes, with what each
      changes.
- [ ] Editing a message's text goes through one server route that, in one
      transaction, saves the current text as an `edits` entry (with editor,
      time and previous text read from the stored message, never from the
      request) and updates the message.
- [ ] Both apps call that route; neither writes `edits` or a message's text
      directly any more.
- [ ] `mod_log` entries are written by the server from the action itself
      (who, what, whom, when), never from client-supplied fields.
- [ ] A report naming a message saves that message's text as the server
      reads it from the stored message (with its edit history at that
      moment), never the client's `messageText`. Every report path that
      names a message (private, group and room messages) does this.

### Error paths

- [ ] The rules refuse a client create on `edits` and on `mod_log`.
- [ ] The rules refuse a client update that changes a message's `text`,
      `isEdited`, `editedAt` or `editCount`. Any other client update kept by
      the first AC is allowed only on its own listed fields.
- [ ] The route refuses an edit by anyone but the sender, by a banned user,
      or in a conversation flagged `crossCohortAtMigration`.
- [ ] A report naming a message the reporter cannot read, or one that does
      not exist, is refused with a clear error; a client `messageText` that
      differs from the stored text is ignored and the difference logged.

### Edge cases

- [ ] Two edits at once both land in history, in order (transaction).
- [ ] Old edit entries written by earlier app versions stay readable.
- [ ] Apps still in use that write directly get a clear error, not a silent
      loss: the edit fails visibly and asks the user to update.

### Performance

- [ ] An edit takes no longer than today's direct write plus one round
      trip, measured on dev.

### Security

- [ ] Rules tests in the emulator prove each refusal above, one test per
      case (skipped history, forged entry on own message, forged entry on
      someone else's message, forged `mod_log`).
- [ ] A security review of the route and rules is recorded in the PR.

### UX

- [ ] Editing a message looks and behaves the same to the user.

### i18n

- [ ] The "update the app" error is translated in every shipped locale and
      read back by Google Cloud Translation before commit.

### Observability

- [ ] A refused direct write is logged by source with the app version, so
      old-app use is visible.

## BDD Scenarios

**Scenario: a modified app cannot rewrite a message without history**

- **Given** a sent message "hello"
- **When** the sender's device updates its text to "bye" directly
- **Then** Firestore refuses the write
- **And** the message still reads "hello"

**Scenario: a participant cannot invent someone else's past words**

- **Given** a conversation between A and B, and B's message "hi"
- **When** A's device creates an `edits` entry on that message
- **Then** Firestore refuses the write

**Scenario: a report cannot put words in someone's mouth**

- **Given** B's message "see you tomorrow"
- **When** A's device reports it with `messageText` "something abusive"
- **Then** the report saves "see you tomorrow", read by the server
- **And** the mismatch is logged

**Scenario: an honest edit keeps its history**

- **Given** a sent message "hello"
- **When** the sender edits it to "hello there" in the app
- **Then** the message reads "hello there"
- **And** its edit history holds "hello", written by the server

## Test Plan

- Firestore rules tests (emulator), one per refusal, each seen RED against
  today's rules first.
- Route tests in `express-api` for the transaction, sender check, ban and
  cohort flag.
- Android and iOS: the same tests for calling the route (same steps, same
  strictness).
- Journey: edit, then a moderator opens the edit history (with SHY-0403).

## Out of Scope

- Who may read edit history (SHY-0403 holds the moderator-only AC).
- The release suite itself (SHY-0613).

## Dependencies

- None blocking. SHY-0613's checks for trails 12 and 13 assert this story's
  refusals once it lands.

## Risks & Mitigations

- Old app versions break on edit: the error is clear and the force-update
  path covers it.
- A rule too strict could block other legitimate message updates: the first
  AC lists every client write before any rule changes.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; journey green on dev.

## Notes

- **2026-10-16**: Filed from a side agent's note, checked against
  `firestore.rules` on `origin/develop` `e60d064a6a5`. P0 as a security
  defect (rules let a client forge or drop a moderation record). MVP: launch
  moderation relies on it.
- **2026-10-16**: Reported message text added (second side-agent note,
  checked in `routes/reports.js`); score raised from 8 to 13 for the
  report route's server-side read across private, group and room messages
  and its tests.
- First scored 8: one route, rules for three paths, both apps, rules tests and a
  journey. Larger than SHY-0612 (3); smaller than SHY-0613 (13), which spans
  thirteen trails.
