---
id: SHY-0649
status: Draft
owner: claude
created: 2026-10-19
priority: P0
effort: S
estimate: 2
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
blocked_by: [SHY-0648]
---

# SHY-0649: An admin who leaves a group only leaves

## User Story

As an admin of someone else's group, I want "Leave" to take only me out of
the group, so that leaving never closes the group for everyone in it.

## Why

Found on 2026-10-19 while taking SHY-0648's role inventory, read at
`95730e62bc9`; not yet seen on a phone.

`GroupSettingsSheet` shows "Close group" to the owner and "Leave" to
everyone else. Both call `PrivateChatViewModel.leaveGroup()`, which closes
the group when `uiState.isAdmin` is true, and `isAdmin` is
`Conversation.isAdmin()`: the owner OR anyone in `groupAdminIds`. So an
admin who is not the owner taps "Leave" and the whole group is closed
(`closeGroupConversation`, `isClosed: true`) instead of removing only them.
`leaveGroup()` is shared code, so both apps do it.

Blocked by SHY-0648: once the rules let only admins close a group, this
path still closes it, so the fix must land against the new rules.

## Acceptance Criteria

### Happy path

- [ ] A non-owner admin who taps "Leave" is removed from the group, and
      from `groupAdminIds`; the group stays open for everyone else.
- [ ] The owner's "Close group" still closes the group.

### Error paths

- [ ] A leave the server or rules refuse shows the existing leave error
      and changes nothing on screen.

### Edge cases

- [ ] A mod who leaves is removed from `groupModIds` too.
- [ ] The last admin leaving leaves the owner in charge; nothing closes.

### Performance

- [x] Not applicable: one write replaces another.

### Security

- [ ] The write passes SHY-0648's rules as a member removing themselves,
      proven by a rules test shaped as the app writes it.

### UX

- [ ] The members still in the group see the admin gone, and the group
      open, on both phones.

### i18n

- [x] Not applicable: no new copy.

### Observability

- [x] Not applicable: no new failure path.

## Announce

Leaving a group as an admin no longer closes it for everyone else.

## BDD Scenarios

**Scenario: an admin leaves**

- **Given** Theo is an admin of Alice's group with Selma
- **When** Theo taps Leave
- **Then** Theo is no longer in the group and the group stays open for
  Alice and Selma

**Scenario: the owner closes**

- **Given** Alice owns a group
- **When** Alice taps Close group
- **Then** the group is closed

## Test Plan

- Shared unit test of `leaveGroup()` with the repository stood in: owner,
  admin, mod and member each make the expected write.
- Rules test: the admin's leave write is allowed by SHY-0648's rules.
- A journey step on both phones: an admin leaves, the others still post.

## Out of Scope

- Group role rules (SHY-0648) and server routes (SHY-0629).

## Dependencies

- SHY-0648 (the rules the write must pass).

## Risks & Mitigations

- Leaving keeps the user's role ids behind: the edge cases test both
  lists.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; checked on dev on both phones.

## Notes

- **2026-10-19**: Filed in passing from SHY-0648. P0: a defect (every
  defect is P0). MVP: a launch user in a group meets it. Scored 2: one
  condition in shared code, a unit test, a rules test, a journey step.
