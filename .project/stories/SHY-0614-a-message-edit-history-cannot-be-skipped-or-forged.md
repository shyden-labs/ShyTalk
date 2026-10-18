---
id: SHY-0614
status: Draft
owner: claude
created: 2026-10-16
priority: P0
effort: L
estimate: 8
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
blocked_by: [SHY-0632]
---

# SHY-0614: A private or group message's edit history cannot be skipped or forged, and a recalled message is kept for moderators

## User Story

As a moderator protecting a community that includes minors, I want a
private or group message's edit history, its recalled text and the group
moderation log to be records nobody can leave out or make up, so that what
I see is what actually happened when I act on a report.

## Why

A side agent pointed out on 2026-10-16 that message edit history is written
by the sender's own phone. Checked the same day in `firestore.rules` on
`origin/develop` (`conversations/{id}` block), and re-checked with a full
inventory on 2026-10-18 at `c19df941c00` (Notes):

- **Edit history can be skipped.** `messages/{id}` `allow update` lets the
  sender (or a group admin or mod) change any field, the text included.
  Nothing requires the matching `edits` entry in the same write, so a
  modified app can rewrite a message and leave no history.
- **Edit history can be forged.** `messages/{id}/edits/{id}` `allow create`
  lets ANY participant add an entry to ANY message in the conversation, with
  any content. Nothing checks `previousText` against the message's real text.
  One participant can put made-up "previous text" on another person's message.
- **A recall erases the evidence.** `recallMessage` (both apps) sets `text`
  to `""` from the phone and keeps nothing, so a harasser can unsend before
  a moderator looks.
- **Hiding names whoever the phone says.** `hideMessage` (both apps) writes
  `hiddenBy` from the phone; nothing checks it is the caller.
- **The group moderation log can be forged.** `mod_log` `allow create` lets
  a group admin or mod write any entry from their device. Nothing in the
  apps, the website or the server writes or reads `mod_log` today, so
  locking it breaks nothing; a real, server-written group log is SHY-0629.

The honest apps write the history correctly; the rules do not make them.

Split on 2026-10-18 (Shyden, "Split into three"): the report's message text
moved to SHY-0627 and room message edits to SHY-0628; this story keeps
private and group messages. Shyden chose on 2026-10-18 that recalled words
are kept for moderators ("Keep for moderators").

Related, not duplicated: SHY-0403 (#1927) covers the journey for moderators
seeing edit history; SHY-0613 (#2373) puts these trails in the release
suite; SHY-0626 stops messages being created under another person's name.

## Acceptance Criteria

### Happy path

- [x] First, every client write to `messages`, `edits` and `mod_log` (both
      apps and the website) is listed per call site in Notes, with what each
      changes.
- [ ] Editing a message's text goes through one server route that, in one
      transaction, saves the current text as an `edits` entry (with editor,
      time and previous text read from the stored message, never from the
      request) and updates the message.
- [ ] Recalling a message goes through one server route that, in one
      transaction, saves the current text where only admins can read it
      (never in `edits`, which participants read), then marks the message
      recalled and blanks its text.
- [ ] Both apps call those routes; neither writes `edits`, `isRecalled` or a
      message's text directly any more.
- [ ] Hiding a message stays a phone write, allowed only when `hiddenBy` is
      the caller and only `isHidden` and `hiddenBy` change.
- [ ] A reaction stays a phone write by any participant, allowed only when
      `reactions` is the one field that changes. (Today's rule lets only the
      sender or group staff update a message, so a recipient's reaction is
      refused; read from the rule on 2026-10-18, proven by the new test.)

### Error paths

- [ ] The rules refuse a client create on `edits` and on `mod_log`.
- [ ] The rules refuse a client update that changes a message's `text`,
      `isEdited`, `editedAt`, `editCount` or `isRecalled`.
- [ ] The rules refuse every client read and write of the recalled-text
      records except an admin's read.
- [ ] The rules refuse every client delete of a message (no app deletes one;
      a delete would erase the record).
- [ ] The edit and recall routes refuse anyone but the sender, a banned
      user, a message already recalled, and a conversation flagged
      `crossCohortAtMigration`.

### Edge cases

- [ ] Two edits at once both land in history, in order (transaction).
- [ ] An edit racing a recall leaves either the edit then the recall, or the
      recall alone; never an edited recalled message.
- [ ] Old edit entries written by earlier app versions stay readable.
- [ ] Apps still in use that write directly get a clear error, not a silent
      loss: the edit or recall fails visibly, and the release raises config
      `minVersionCode` so they open the existing force-update screen.
- [ ] Every server path that deletes a conversation's messages also deletes
      their recalled-text records.

### Performance

- [ ] An edit or a recall takes no longer than today's direct write plus one
      round trip, measured on dev.

### Security

- [ ] Rules tests in the emulator prove each refusal above, one test per
      case (skipped history, forged entry on own message, forged entry on
      someone else's message, direct text change, direct recall, recalled
      text read by a participant, forged `hiddenBy`, forged `mod_log`), each
      seen RED against today's rules first.
- [ ] A security review of the routes and rules is recorded in the PR.

### UX

- [ ] Editing and recalling a message look and behave the same to the user.

### i18n

- [ ] The privacy policy's new line (below) is translated by Google Cloud
      Translation in every shipped locale and read back by it before commit.
      The "update the app" message is the existing translated force-update
      screen; no new text.

### Observability

- [ ] Each route logs every edit and recall with the conversation id,
      message id and caller, never the text. (The server never sees a rules
      refusal and the API gets no app version, so old-app use ends with the
      `minVersionCode` raise rather than being logged.)
- [ ] The privacy policy says: "If you recall (unsend) a message, ShyTalk's
      moderators can still read what it said. It is deleted when the
      conversation is deleted."

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

**Scenario: an honest edit keeps its history**

- **Given** a sent message "hello"
- **When** the sender edits it to "hello there" in the app
- **Then** the message reads "hello there"
- **And** its edit history holds "hello", written by the server

**Scenario: a recalled message is kept for moderators only**

- **Given** B's message "you are stupid"
- **When** B recalls it in the app
- **Then** A sees it as recalled with no text
- **And** A's device cannot read the recalled text
- **And** an admin can read "you are stupid" with who recalled it and when

## Test Plan

- Firestore rules tests (emulator), one per refusal, each seen RED against
  today's rules first.
- Route tests in `express-api` for both transactions, the sender check, ban,
  already-recalled and cohort flag.
- Android and iOS: the same tests for calling the routes (same steps, same
  strictness).
- Journey: edit, recall, then a moderator opens the history (with SHY-0403).

## Out of Scope

- A report's message text (SHY-0627).
- Room message edits (SHY-0628).
- A server-written group moderation log (SHY-0629).
- Who may read edit history (SHY-0403 holds that AC).
- The release suite itself (SHY-0613).

## Dependencies

- Blocked by SHY-0632: the privacy line's translations need its Google
  Cloud Translation read-back. The routes and rules PRs do not wait on it.
- SHY-0613's checks for trails 12 and 13 assert this story's
  refusals once it lands.

## Risks & Mitigations

- Old app versions break on edit and recall: the error is clear and the
  force-update path covers it.
- A rule too strict could block other legitimate message updates: the
  inventory below lists every client write, and each kept write has its own
  allow-test.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; journey green on dev.

## Notes

- **2026-10-16**: Filed from a side agent's note, checked against
  `firestore.rules` on `origin/develop` `e60d064a6a5`. P0 as a security
  defect (rules let a client forge or drop a moderation record). MVP: launch
  moderation relies on it.
- **2026-10-16**: Report text added and the score raised from 8 to 13.
- **2026-10-18**: Split into three (Shyden): reports to SHY-0627, room edits
  to SHY-0628; the group log story SHY-0629 filed; recall kept for
  moderators. Re-scored 8: two routes, rules for four paths, both apps, the
  privacy line, rules tests and a journey; the same size as SHY-0626.
- **2026-10-18, inventory** (`git grep` over `app/src/main`, `shared/src`,
  `iosApp`, `public`, `functions` and `express-api/src` at `c19df941c00`;
  the website writes none of these):

  | Call site (Android; iOS twin in `IosPrivateMessageRepositoryImpl.kt`) | Writes                                                                                                                         |
  | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
  | `PrivateMessageRepositoryImpl.editMessage`                            | batch: `edits` entry `{previousText, editedAt}` (text read by the phone) + message `text`, `isEdited`, `editedAt`, `editCount` |
  | `PrivateMessageRepositoryImpl.recallMessage`                          | message `isRecalled: true`, `text: ""`                                                                                         |
  | `PrivateMessageRepositoryImpl.hideMessage`                            | message `isHidden: true`, `hiddenBy` (from the phone)                                                                          |
  | `PrivateMessageRepositoryImpl.toggleReaction`                         | transaction: message `reactions`                                                                                               |
  | `sendTextMessage` and the other sends                                 | none: `POST /api/conversations/:id/messages`                                                                                   |
  | `mod_log`                                                             | no writer and no reader anywhere; only `cron/testDataCleanup.js` names it                                                      |

- **2026-10-18, design**: approach chosen: server routes for edit and recall
  in a transaction, rules lock the fields (rules-only checks rejected: they
  cannot make the honest record the only one; a Cloud Function trigger
  rejected: it runs after the forged write is live). ACs amended from the
  design: reactions by any participant (today a recipient's is refused), no
  client delete of a message, recall records deleted with their
  conversation, the force-update screen as the "update" message, and route
  logging in place of rules-refusal logging the server cannot see.
  Orphaned `edits` after account deletion filed as SHY-0631.
