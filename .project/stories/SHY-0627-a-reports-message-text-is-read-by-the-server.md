---
id: SHY-0627
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
blocked_by: [SHY-0614, SHY-0628]
---

# SHY-0627: A report's message text is the message as it was sent, read by the server

## User Story

As a moderator acting on a report, I want the message text saved with the
report to be what the reported person actually wrote, read by the server,
so that nobody can be reported for words they never wrote.

## Why

`POST /reports` (`express-api/src/routes/reports.js`) saves `messageText`
from the request body, checked only for length, and never reads the real
message by `conversationId` and `messageId`. A modified app can report
someone for words they never wrote, and the moderator sees the made-up text.
Found by a side-agent note, checked 2026-10-16 on `2aebea9324b` (first filed
inside SHY-0614); re-checked 2026-10-18 at `c19df941c00`.

A room message report sends the room id as `conversationId`
(`RoomViewModel.reportMessage` → `ReportRepository.reportMessage`), so the
route cannot tell a room from a conversation by the field alone.

The other report and appeal routes take no reported content from the
client; `appealText` is the appealing user's own words.

Split out of SHY-0614 on 2026-10-18 (Shyden, "Split into three").

## Acceptance Criteria

### Happy path

- [ ] A report naming a private, group or room message saves the text the
      server reads from the stored message, with who sent it and when, and
      never the client's `messageText`.
- [ ] The saved text carries the message's edit history at that moment
      where one exists (SHY-0614 for private and group, SHY-0628 for rooms).
- [ ] A report on a recalled message saves the recalled text from the
      admin-only record (SHY-0614), marked as recalled.
- [ ] Room and conversation messages are told apart without trusting the
      client; apps still sending the room id as `conversationId` keep
      working.

### Error paths

- [ ] A report naming a message that does not exist is refused with a clear
      error.
- [ ] A report naming a message the reporter cannot read (not a participant,
      a flagged conversation, another cohort's room) is refused with a clear
      error.
- [ ] A report whose `reportedUserId` is not the stored message's sender is
      refused with a clear error.
- [ ] A client `messageText` that differs from the stored text is ignored
      and the difference logged.

### Edge cases

- [ ] A report with no message (a user report) behaves as today.
- [ ] A message deleted after the report was saved does not change the
      report.

### Performance

- [ ] `POST /reports` takes no more than one extra read round trip,
      measured on dev.

### Security

- [ ] Route tests prove each refusal, one test per case, each seen RED
      against today's route first.
- [ ] A security review of the route is recorded in the PR.

### UX

- [ ] Reporting a message looks and behaves the same to the reporter; each
      new refusal shows a translated message.

### i18n

- [ ] Any new error text is translated in every shipped locale and read back
      by Google Cloud Translation before commit.

### Observability

- [ ] A mismatch between the client's and the stored text is logged with the
      report id and the app version, never the text itself.

## BDD Scenarios

**Scenario: a report cannot put words in someone's mouth**

- **Given** B's message "see you tomorrow"
- **When** A's device reports it with `messageText` "something abusive"
- **Then** the report saves "see you tomorrow", read by the server
- **And** the mismatch is logged

**Scenario: a room message report is read from the room**

- **Given** B's room message "hello everyone"
- **When** A reports it from the room
- **Then** the report saves "hello everyone", read from the room

**Scenario: a recalled message is still reportable**

- **Given** B sent "you are stupid" and recalled it
- **When** A reports the recalled message
- **Then** the report saves "you are stupid", marked as recalled

## Test Plan

- Route tests in `express-api` for each source, each refusal and the
  mismatch log.
- Android and iOS: the same tests for the report call (same steps, same
  strictness).
- Journey: report a message, a moderator opens the report and sees the
  stored text.

## Out of Scope

- Who may create a message (SHY-0626).
- Edit history itself (SHY-0614, SHY-0628).

## Dependencies

- Blocked by SHY-0614 (the recalled-text record and private/group history)
  and SHY-0628 (room history): this story's ACs read what they write.

## Risks & Mitigations

- Old apps send the room id as `conversationId`: the route looks the
  message up in both places and checks the reporter can read it.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; journey green on dev.

## Notes

- **2026-10-18**: Split out of SHY-0614 (Shyden). P0 as a security defect.
  MVP: launch moderation relies on it. Scored 5: one route, three message
  sources, refusals, both apps' error handling and a journey; SHY-0614's
  report share was the 5 points it rose by on 2026-10-16.
