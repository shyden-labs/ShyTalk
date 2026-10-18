---
id: SHY-0626
status: Draft
owner: claude
created: 2026-10-18
priority: P0
effort: L
estimate: 8
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
---

# SHY-0626: A message cannot be posted under someone else's name, or as the system

## User Story

As a member of a room or a conversation, including a minor, I want every
message shown under a person's name to have been sent by that person, and
every system message to come from ShyTalk itself, so that nobody can put
words in my mouth or fake an official notice.

## Why

Found on 2026-10-18 while taking SHY-0614's inventory, checked in
`firestore.rules` at `c19df941c00`:

- **Room messages.** `rooms/{id}/messages/{id}` `allow create` checks only
  that the caller is the room's owner or a participant. It never checks that
  `senderId` or `senderName` is the caller, nor the `type`. Both apps create
  room messages from the phone (`MessageRepositoryImpl.createAndSendMessage`,
  Android; `IosMessageRepositoryImpl`, iOS), including `SYSTEM` messages
  sent as `senderId: "system"`, `senderName: "System"` with any text, and
  `JOIN` messages. A modified app can post words under another member's
  name, or make the room's system voice announce anything.
- **Private and group messages.** `conversations/{id}/messages/{id}`
  `allow create` checks only that the caller is a participant and the
  conversation is not flagged; it never checks `senderId`. Both apps send
  through `POST /api/conversations/:id/messages`, so the direct-create rule
  serves no honest client, yet it lets a modified app write a message as the
  other participant.
- A forged message also corrupts a report: once SHY-0627 reads the stored
  message, a forged one still names the victim as its sender.

`GIFT` room messages are written by the server (`routes/economy.js`) and are
not affected.

## Acceptance Criteria

### Happy path

- [ ] First, every client create of a room or conversation message (both
      apps and the website) is listed per call site in Notes, with its type
      and fields.
- [ ] A member's own room message (`TEXT`, `JOIN`) is accepted only when
      `senderId` is the caller and `senderName` is the caller's stored
      display name or comes from the server.
- [ ] `SYSTEM` room messages are written only by the server, from the action
      that causes them, never with text from the phone.
- [ ] Private and group messages are created only by the server route.

### Error paths

- [ ] The rules refuse a client room message whose `senderId` is not the
      caller.
- [ ] The rules refuse a client room message of type `SYSTEM` or `GIFT`.
- [ ] The rules refuse every client create of a conversation message.
- [ ] Apps still in use that write a refused message get a clear error, not
      a silent loss.

### Edge cases

- [ ] Every action that sends a system message today still sends it, now
      from the server, in the same words and in the reader's language.
- [ ] A member whose display name changed after joining still posts.

### Performance

- [ ] Sending a room message takes no longer than today, measured on dev.

### Security

- [ ] Rules tests in the emulator prove each refusal, one test per case,
      each seen RED against today's rules first.
- [ ] A security review of the rules and any new route is recorded in the
      PR.

### UX

- [ ] Sending and reading messages look the same to the user.

### i18n

- [ ] Any new or moved user-facing text is translated in every shipped
      locale and read back by Google Cloud Translation before commit.

### Observability

- [ ] A refused direct write is logged by source with the app version.

## BDD Scenarios

**Scenario: a member cannot speak as another member**

- **Given** A and B are in a room
- **When** A's device creates a room message with `senderId` B
- **Then** Firestore refuses the write

**Scenario: a member cannot speak as the system**

- **Given** A is in a room
- **When** A's device creates a `SYSTEM` message "This room is closing, go to
  this link"
- **Then** Firestore refuses the write

**Scenario: a participant cannot write the other person's private message**

- **Given** a conversation between A and B
- **When** A's device creates a message with `senderId` B directly
- **Then** Firestore refuses the write

## Test Plan

- Firestore rules tests (emulator), one per refusal, each seen RED first.
- Route tests in `express-api` for any system-message route.
- Android and iOS: the same tests for each changed send (same steps, same
  strictness).
- Journey: a room member sends, a system message appears after an owner
  action.

## Out of Scope

- Editing messages (SHY-0614, SHY-0628).
- A report's message text (SHY-0627).

## Dependencies

- None blocking.

## Risks & Mitigations

- A system message the inventory misses stops appearing: the first AC lists
  every send before any rule changes, and each kept send has an allow-test.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; journey green on dev.

## Notes

- **2026-10-18**: Filed while taking SHY-0614's inventory. P0 as a security
  defect (impersonation in spaces with minors). MVP: launch users meet it.
  Scored 8: rules for two paths, system messages moved to the server, both
  apps, rules tests and a journey; the same size as SHY-0614.
- **2026-10-18**: Also found designing SHY-0614: the send route
  (`POST /api/conversations/:id/messages`) accepts type `MOD_ACTION` from any
  participant with any text (both apps send "<name> hid a message" this
  way), so a participant can post a fake moderation notice. The "as the
  system" ACs cover it; the inventory AC lists it.
