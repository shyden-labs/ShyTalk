---
id: SHY-0648
status: Draft
owner: claude
created: 2026-10-19
priority: P0
effort: L
estimate: 8
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
---

# SHY-0648: A group member cannot give themselves powers

## User Story

As a member of a group chat, I want only the people the group trusts to be
able to change who runs it, who is in it and how it works, so that nobody
can take over my group by writing to the database directly.

## Why

Found on 2026-10-19 while working SHY-0647, read from `firestore.rules` at
`95730e62bc9`; suspected, not yet proven by a test.

`conversations/{id}` has ONE `allow update`. It checks that the caller is
a participant and not banned, blocks the three migration fields
(`crossCohortAtMigration`, `frozenAtMigration`, `frozenAtMigrationAt`) and
gates adding a member (one at a time, same cohort). Nothing else is
checked, so any member can, with a direct Firestore write:

- put themselves in `groupAdminIds` or `groupModIds`, or set `createdBy`
  (the owner) to themselves;
- remove every other member, the owner included;
- close the group (`isClosed`), or rewrite `permissions`,
  `systemMessageConfig` and `modNotifyMode`;
- change the group's `cohort` (its comment calls it "immutable
  post-create") or `isGroup`.

The apps hold the role checks in their screens only (`GroupSettingsSheet`:
role badges and the permissions tab for the owner, remove per
`whoCanRemoveMembers`, edit per `whoCanEditInfo`); the repositories
(`PrivateMessageRepositoryImpl`, `IosPrivateMessageRepositoryImpl`) write
each change straight to the document, and the rules accept whatever
arrives. With a minor cohort on the platform, a member taking over a group
and removing its admins is a safeguarding risk. The same rule is live on
production.

Shyden, 2026-10-19: "this is a boig issue. confirm it and raise a P0 to fix
it immediately". He chose a new P0 rules fix, with SHY-0629 (server routes
and a moderation log, P1) keeping these role checks when it moves the
actions to the server.

## Acceptance Criteria

### Happy path

- [ ] First, the hole is proven: rules tests in the emulator, run against
      today's rules in a plant PR (not merged), show each escalation below
      allowed, with the prediction written in the PR body before CI runs.
      The result is recorded here.
- [ ] The rules check the caller's role for each change, matching the
      roles the apps already show (owner = `createdBy`; admin = owner or in
      `groupAdminIds`; mod = in `groupModIds`):
      - `createdBy`, `groupAdminIds`, `groupModIds`, `permissions`,
        `systemMessageConfig`, `modNotifyMode`: the owner only;
      - `isClosed`: an admin;
      - `groupName`, `groupDescription`, `groupPhotoUrl`: the level the
        group's `permissions.whoCanEditInfo` names;
      - removing another member: the level `whoCanRemoveMembers` names,
        never the owner;
      - adding a member: the level `whoCanAddMembers` names, with today's
        one-at-a-time, same-cohort gate kept;
      - leaving (removing yourself): any member.
- [ ] Every admin action each app makes today still succeeds for the role
      the app offers it to (one rules test per action, as the repository
      writes it).

### Error paths

- [ ] Each escalation is refused, one rules test per case, each seen red
      on today's rules first: a member sets themselves as owner, admin or
      mod; removes another member; removes the owner; closes the group;
      changes permissions, system messages, notify mode, cohort or
      `isGroup`; edits the name when `whoCanEditInfo` is above their role.
- [ ] A mod cannot do the owner's or admins' changes; an admin cannot do
      the owner's.
- [ ] A transfer of ownership names a current participant.

### Edge cases

- [ ] A group with no `permissions` map falls back to the apps' defaults
      (`GroupPermissions`: add and edit for everyone, remove for admins).
- [ ] A one-to-one conversation cannot be turned into a group, nor take
      group fields.
- [ ] Changes that touch several fields at once need the role for every
      field they touch.

### Performance

- [ ] No extra document reads: the checks read only the conversation
      document the rule already has (`resource.data`).

### Security

- [ ] A security review of the new rule is recorded in the PR, with each
      branch's test named.
- [ ] Field lists are allow-lists (`hasOnly`), so a field added later is
      refused until a rule names it.

### UX

- [x] Not applicable: the apps already offer each action only to the role
      the rules will require. (SHY-0649 fixes the one place they do not.)

### i18n

- [x] Not applicable: no new copy.

### Observability

- [ ] A refused group change on a phone is logged on the device naming the
      action and the refusal, proven by a unit test per platform.

## Announce

Group chats are safer: only a group's owner and admins can change who runs
it and who is in it.

## BDD Scenarios

**Scenario: a member cannot make themselves admin**

- **Given** Theo is a member of Alice's group and holds no role
- **When** Theo writes himself into the group's admins
- **Then** the write is refused and the group's admins are unchanged

**Scenario: the owner still runs the group**

- **Given** Alice owns a group with Theo and Selma
- **When** Alice makes Theo an admin and removes Selma
- **Then** both changes succeed

**Scenario: anyone may leave**

- **Given** Selma is a member of Alice's group
- **When** Selma leaves
- **Then** she is removed and nothing else changes

## Test Plan

- Plant PR: rules tests in `express-api/tests/firestore-rules/` against
  today's rules, prediction first, then closed unmerged.
- Fix PR: the same tests plus one ALLOW test per app action, green on the
  new rules; each refusal mutation-verified (drop its clause, see it red).
- Unit tests per platform for the logged refusal.

## Out of Scope

- Moving the actions to server routes and logging them (SHY-0629).
- Message hiding and reactions (SHY-0614, done).
- `userSettings` writes at group creation (SHY-0647).

## Dependencies

- None. SHY-0629 builds on it.

## Risks & Mitigations

- A rule tighter than an app's real write breaks a working action: one
  ALLOW test per repository write, shaped exactly as it is written, and the
  dev journey for groups before production.
- Old groups with fields missing: defaults as the apps read them, tested.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; group actions checked on dev; Shyden approves the rules
      for production.

## Notes

- **2026-10-19**: Filed at Shyden's direction, P0 (a security defect, live
  on production). MVP: every launch user in a group meets it. Scored 8,
  measured against SHY-0614 (8: two writes moved, 25 rules tests): one
  rule rewritten for nine field groups, about 25 rules tests plus a plant
  run, two small logging changes.
