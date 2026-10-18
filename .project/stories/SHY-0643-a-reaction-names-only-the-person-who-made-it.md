---
id: SHY-0643
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
blocked_by: [SHY-0614]
---

# SHY-0643: A reaction names only the person who made it

## User Story

As a learner in a private or group chat, I want the reactions on a message to
show only what each person really chose, so that nobody can put a reaction in
my name or take mine away.

## Why

Found on 2026-10-19 while locking the message rules for SHY-0614 (PR 3,
commit e2db2459729). The locked rule lets any participant change a message's
`reactions` field and nothing else, but it cannot check what the new value
says: a participant may write the whole map, so they can add another
person's id to an emoji's list or remove other people's reactions. Before the
lock the sender and group staff could do the same (the update rule had no
field check at all).

Both apps read the map and write the whole map back in a transaction
(Android `PrivateMessageRepositoryImpl.toggleReaction`, iOS
`IosPrivateMessageRepositoryImpl`), so the rules see only the final map.
Firestore rules cannot walk a map of lists to compare each one, so the fix is
likely a server route like the edit and recall routes; the ACs leave the
approach open.

## Acceptance Criteria

### Happy path

- [ ] A participant adds their own reaction to a message: it shows for
      everyone in the chat.
- [ ] A participant removes their own reaction: it is gone for everyone, and
      every other reaction stays.

### Error paths

- [ ] A write that adds another person's id to any emoji's list is refused,
      and the message is unchanged.
- [ ] A write that removes another person's id from any list is refused, and
      the message is unchanged.
- [ ] A person who is not in the conversation, or is banned, cannot react.

### Edge cases

- [ ] Two people reacting to the same message at the same moment both keep
      their reactions (no lost update).
- [ ] Reacting to a hidden or recalled message is refused the same way on
      both phones.

### Performance

- [ ] The reaction round trip on a real phone is measured before and after on
      dev; the median is no slower than before plus 200 ms.

### Security

- [ ] The reactor's id comes from the signed-in token only, never from the
      request body or the app.
- [ ] Rules tests on the emulator prove each refusal above, each seen red
      against the rules before the fix.

### UX

- [ ] Reactions look and behave the same as today on Android, iOS and web; a
      refused reaction leaves the screen as it was.

### i18n

- [x] Not applicable: no new user-facing text.

### Observability

- [ ] A refused reaction write is counted in the server's logs (no message
      text, no other person's id).

## Announce

Nothing: reactions look the same; this stops misuse.

## BDD Scenarios

**Scenario: a participant cannot react in someone else's name**

- **Given** Ana and Budi are in a group chat and Budi sent a message
- **When** Ana's app writes a reaction listing Budi's id
- **Then** the write is refused and the message's reactions are unchanged

**Scenario: removing a reaction keeps everyone else's**

- **Given** Ana and Citra have both reacted 👍 to a message
- **When** Ana removes their 👍
- **Then** only Citra's 👍 remains

## Test Plan

- Rules tests in `express-api/tests/firestore-rules/` (emulator, CI), planted
  red first.
- Route or rules unit tests for the add/remove decision (no services).
- One journey run with both phones on dev for the UX and performance ACs.

## Out of Scope

- Who may hide a message (SHY-0614).
- New reaction types or a reactions list screen.

## Dependencies

- SHY-0614 PR 3 (the locked update rule this narrows).

## Risks & Mitigations

- Moving reactions to a server route adds a round trip: the performance AC
  measures it on a real phone.
- Old app builds keep writing the whole map: the release raises
  `minVersionCode` as SHY-0614 does.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; both phones signed off.

## Notes

- **2026-10-19**: Filed while locking the rules for SHY-0614. P0 by the
  standing rule (a defect: one person can rewrite another's reactions); MVP
  (launch users react). Scored 5: one decision module and route or rule,
  both apps' reaction call, rules tests planted red, a phone journey.
  Blocked by SHY-0614, whose PR 3 brings the rule this narrows.
