---
id: SHY-0652
status: Draft
owner: claude
created: 2026-10-20
priority: P0
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
blocked_by: [SHY-0647]
---

# SHY-0652: No admin or mod can act on a group's owner

## User Story

As the owner of a group, I want no admin or mod to be able to mute me, hide
my messages or change my settings, so that the person who made the group
always stays in charge of it.

## Why

Found on 2026-10-20 while fixing SHY-0647. Shyden ruled that the owner
holds every power an admin or mod holds, and more ("they're the overlords
with full permissions, more so than admins"), then chose "Yes, owner
untouchable": staff may not act on the owner, in the rules and on the
phones.

Read on `SHY-0647-group-create-writes` at f2e7dfe99e3: `firestore.rules`
lets any `groupAdminIds` member write any `userSettings` row, any admin or
mod write any `mutes/{id}`, and any admin or mod hide any message. None
exempts `createdBy`. SHY-0648 already stops anyone removing the owner. On
the phones, `PrivateMessageBubble` shows Hide to staff on every message
they did not send (`isModOrAbove && !isSent`), the owner's included, and
`GroupSettingsSheet` shows Unmute against a muted owner. Remove already
skips the owner (`role != GroupRole.OWNER`).

## Acceptance Criteria

### Happy path

- [ ] The owner still mutes members, hides messages and writes members'
      settings rows (SHY-0647's tests stay green).

### Error paths

- [ ] An admin or mod who writes the owner's `mutes` row, hides one of the
      owner's messages, or writes the owner's `userSettings` row is refused
      by the rules; rules tests pin each.

### Edge cases

- [ ] The owner may still write their own `mutes` and `userSettings` rows.
- [ ] An admin or mod may still act on every other member, each other
      included, as the group's permissions allow.

### Performance

- [x] Not applicable: each rule adds one comparison on a document the
      request already reads (the conversation `get()` is cached).

### Security

- [ ] A direct database write cannot skip the check: the rules refuse
      it, not only the phones.

### UX

- [ ] The phones do not offer Hide on the owner's messages, nor Mute or
      Unmute against the owner, to anyone but the owner (both apps share
      the Compose UI); a unit test of the shared decision pins it.

### i18n

- [x] Not applicable: no new copy.

### Observability

- [x] Not applicable: a refused write is already logged on the device
      naming the action (SHY-0648, #2475).

## Announce

Group owners can no longer be muted, or have their messages hidden, by the
admins and mods of their own group.

## BDD Scenarios

**Scenario: an admin cannot hide the owner's message**

- **Given** Alice owns a group where Theo is an admin
- **When** Theo looks at a message Alice sent
- **Then** Theo is not offered Hide, and a direct hide is refused

**Scenario: an admin still moderates members**

- **Given** Alice owns a group where Theo is an admin and Selma a member
- **When** Theo hides Selma's message and mutes Selma
- **Then** both succeed

## Test Plan

- Rules tests in `express-api/tests/firestore-rules/conversations-rules.test.js`
  (CI's rules suite): staff refused on the owner's mute, message and
  settings row; staff allowed on a member; the owner allowed on its own rows.
- Shared unit test (commonTest) of the decision the phones use to offer
  Hide, Mute and Unmute.
- The phone walk for the release adds: Theo (admin) sees no Hide on
  Alice's message.

## Out of Scope

- Moving ownership to another member.
- ShyTalk's own moderators (reports, suspensions): unchanged.

## Dependencies

- SHY-0647 (#2453): the owner's powers in the same rules.

## Risks & Mitigations

- An owner who misbehaves cannot be silenced inside the group: ShyTalk's
  own moderators handle it through reports (Shyden's ruling).

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; green on dev on both phones; Shyden signs off the phones;
      in the release branch with SHY-0648 and SHY-0647.

## Notes

- **2026-10-20**: Filed from Shyden's ruling during SHY-0647. P0: a
  defect (every defect is P0). MVP: a launch user owning a group meets it.
  Scored 3: three rule clauses with tests, one shared decision with a unit
  test, two button conditions.
