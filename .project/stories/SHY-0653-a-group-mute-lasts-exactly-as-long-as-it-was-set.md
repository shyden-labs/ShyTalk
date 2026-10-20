---
id: SHY-0653
status: Draft
owner: claude
created: 2026-10-20
priority: P0
effort: M
estimate: 5
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
---

# SHY-0653: A group mute lasts exactly as long as it was set

## User Story

As a group's owner, admin or mod, I want a member I mute to stay muted for
exactly the time I chose, so that a mute actually stops them posting and
ends when it should.

## Why

Found on 2026-10-20 while preparing SHY-0652, reading `develop` at
8f71a536c5a. Three gaps, each read from the code (none yet run):

1. A timed mute never ends. Both apps save it as `duration`
   (`PrivateMessageRepositoryImpl.kt:619`,
   `IosPrivateMessageRepositoryImpl.kt:614`), but `MuteInfo.fromMap` reads
   `expiresAt`, which nothing writes. A one-hour mute reads back as
   permanent, and the auto-unmute in `PrivateChatViewModel.kt:1286` never
   fires. Nor is `mutedBy` written, which the model reads.
2. A muted member can lift their own mute. `firestore.rules` `mutes/{muteId}`
   lets `callerUniqueId() == muteId` write, so the member may delete or
   rewrite an unexpired mute. The branch exists for the auto-unmute above.
3. A muted member can still post. The message `create` rule reads
   participants, bans and the cross-cohort flag, never `mutes`, so a direct
   write skips the phone's muted state.

## Acceptance Criteria

### Happy path

- [x] First, rules tests prove or disprove gaps 2 and 3 on today's rules,
      and a unit test proves or disproves gap 1; each result is recorded
      here before any fix. **Proven, 2026-10-20**, all three:
      gaps 2 and 3 by PR #2480 head 05db43ae3d2, PR Checks run 39360163266,
      every job green by name, `PASS
      tests/firestore-rules/conversations-rules.test.js` with 16,495 tests
      (11 new): on today's rules a member under a timed or permanent mute
      posted, deleted their own mute before it ended, and shortened it.
      Gap 1 by `MuteInfoFromMapTest` "fromMap reads a row saved with
      duration as ending at mutedAt plus duration", run on the laptop
      before the fix: `expected:<4600000> but was:<null>` (12 tests, 1
      failed; the permanent-row control passed).
- [ ] A timed mute is saved with its end time (and who muted), on both
      phones, and reads back with the same end time.
- [ ] A mute ends at its end time: the member can post again with no
      action by anyone.

### Error paths

- [ ] A muted member's new message is refused by the rules while the mute
      lasts.
- [ ] A muted member cannot delete or change their own mute before it ends.

### Edge cases

- [ ] A permanent mute (no end time) lasts until staff lift it.
- [ ] A mute saved before the fix (`duration` only) is read as ending at
      `mutedAt + duration`, by the apps and the rules alike.
- [ ] A member may clear their own mute once it has ended.

### Performance

- [ ] Sending a group message costs at most one more read (the member's
      mute row), measured in the rules tests' read count.

### Security

- [ ] A direct database write cannot skip any of the above: rules tests,
      one per case, each seen RED against today's rules first.

### UX

- [ ] A muted member sees when their mute ends; nothing changes for anyone
      else.

### i18n

- [x] Not applicable: no new copy (the existing mute strings stay).

### Observability

- [ ] A refused message from a muted member is logged on the device naming
      the action, as SHY-0648 does for group writes.

## Announce

A timed mute in a group chat now ends on time, and a muted member can no
longer post until it does.

## BDD Scenarios

**Scenario: a one-hour mute ends after an hour**

- **Given** Theo, an admin, mutes Selma for one hour
- **When** the hour passes
- **Then** Selma can post again, and her mute row shows the end time

**Scenario: a muted member cannot post round the app**

- **Given** Selma is muted
- **When** a direct write adds a message from Selma
- **Then** the rules refuse it

## Test Plan

- Rules tests in `express-api/tests/firestore-rules/conversations-rules.test.js`
  (CI's rules suite), one per case.
- Unit tests of the saved mute map and `MuteInfo.fromMap` (old and new rows).
- The phone walk: Theo mutes Selma for the shortest offered time; Selma is
  stopped, then posts once it ends. Needs phones.

## Out of Scope

- Moving mutes to a server route with a log entry (SHY-0629).
- Voice-room mutes (SHY-0340).

## Dependencies

- None. SHY-0652 changes the same `mutes` rule (staff branch only); land
  them in either order and merge the clause by hand.

## Risks & Mitigations

- Live rows in the old shape: the legacy AC reads them the same way, so no
  data migration is needed.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; green on dev on both phones; Shyden signs off the phones;
      in the group-roles release branch with SHY-0648, SHY-0647 and
      SHY-0652.

## Notes

- **2026-10-20**: Shyden: "this must be fixed". It joins the group-roles
  hotfix release.

- **2026-10-20**: Filed while preparing SHY-0652. P0: a defect (every defect
  is P0). MVP: a launch user in a group meets it. Scored 5: two rule clauses
  and a legacy read in the rules, the writer on both apps, the reader, and
  tests in three places; above SHY-0652's 3 (three clauses, one decision).
