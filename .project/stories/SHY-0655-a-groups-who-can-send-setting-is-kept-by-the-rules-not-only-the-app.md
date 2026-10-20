---
id: SHY-0655
status: Draft
owner: claude
created: 2026-10-20
priority: P0
effort: S
estimate: 2
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0655: A group's "who can send" setting is kept by the rules, not only the app

## User Story

As a group's owner, I want "who can send" set to admins only to stop
everyone else posting, so that an announcement group stays an announcement
group even against a direct write.

## Why

Found on 2026-10-20 while fixing SHY-0653, reading `develop` at
235e977d018: `GroupPermissions.whoCanSend` is stored on the conversation and
offered in `GroupSettingsSheet.kt:445`, but the message `create` rule in
`firestore.rules` reads participants, bans, the cross-cohort flag and (since
SHY-0653) mutes, never `permissions.whoCanSend`. Only the phone hides the
input, so a member can post into an admins-only group with a direct write.
The rules already judge the other levels with `levelAllows` /
`permissionAllows` (SHY-0648).

## Acceptance Criteria

### Happy path

- [ ] First, a rules test proves or disproves it on today's rules: a member
      posts in a group whose `whoCanSend` is `ADMINS_ONLY` (expected
      allowed today). The result is recorded here before any fix.
- [ ] Anyone the level admits still posts: everyone under `EVERYONE`; mods,
      admins and the owner under `MODS_AND_ABOVE`; admins and the owner under
      `ADMINS_ONLY`; the owner under `OWNER_ONLY`.

### Error paths

- [ ] Someone below the level is refused by the rules, one rules test per
      level.

### Edge cases

- [ ] A group with no `permissions` map, or an unknown level, reads as the
      default (`EVERYONE`), as `GroupPermissions.fromMap` does.
- [ ] One-to-one conversations are unaffected.

### Performance

- [x] Not applicable: the rule reads a field of the conversation document the
      request already reads (cached).

### Security

- [ ] A direct write cannot skip the setting: rules tests, each seen RED
      first.

### UX

- [x] Not applicable: the phones already hide the input below the level.

### i18n

- [x] Not applicable: no new copy.

### Observability

- [x] Not applicable: a refused send is already logged on the device
      naming the action (SHY-0648, `firebaseCall`).

## Announce

An admins-only group now stays admins-only, whatever app someone uses.

## BDD Scenarios

**Scenario: a member cannot post in an admins-only group**

- **Given** Alice's group lets only admins send
- **When** a direct write adds a message from Selma, a member
- **Then** the rules refuse it

**Scenario: an admin still posts**

- **Given** the same group, where Theo is an admin
- **When** Theo sends a message
- **Then** it is posted

## Test Plan

- Rules tests in `express-api/tests/firestore-rules/conversations-rules.test.js`,
  one per level and role, each seen RED against today's rules first.

## Out of Scope

- Moving sends to a server route.

## Dependencies

- None. Touches the same `create` rule as SHY-0653: land after it and merge
  the clause by hand.

## Risks & Mitigations

- The default must match the app's (`EVERYONE`), or every group without a
  map goes silent: an edge-case AC pins it.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`.

## Notes

- **2026-10-20**: Filed while fixing SHY-0653. P0: a defect (every defect is
  P0). MVP: a launch user in a group meets it. Scored 2: one clause reusing
  `permissionAllows`, rules tests per level. Server decides: the level is
  already server-stored data.
