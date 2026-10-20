---
id: SHY-0656
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

# SHY-0656: A group's owner, admins and mods can mute a member from the app

## User Story

As a group's owner, admin or mod, I want a Mute button on a member, so that
I can stop someone posting for a while without removing them from the group.

## Why

Found on 2026-10-20 while preparing SHY-0652, reading `develop` at
690bd97d365. Neither app offers a way to start a group mute:

- No screen calls `PrivateChatViewModel.muteGroupMember`
  (`PrivateChatViewModel.kt:1189`); a search of `shared/src/commonMain`,
  `app/src/main` and `iosApp` for the call and for an `onMuteMember`
  callback finds none. The only `Res.string.mute` uses are voice-room ones
  (`UserCardPopup.kt:212`, `ChatPanel.kt:347`).
- The members list in `GroupSettingsSheet.kt` offers Unmute (line 381) and
  Remove, never Mute.
- Yet the group's "Who can mute members" setting
  (`GroupSettingsSheet.kt:458`, `GroupSetupScreen.kt:321`), the rules, both
  repositories and the ViewModel all exist, and the chat shows a mute
  banner and an Unmute button. The setting does nothing a user can reach.

It has been this way since group messaging landed (v0.37, `d893bfa7228`,
2026-02-19), which added the repository, the ViewModel call and the Unmute
wiring but no Mute entry point. It also blocks SHY-0653's phone walk, which
starts with an admin muting a member.

## Acceptance Criteria

### Happy path

- [ ] On a member in the members list, anyone the group's "Who can mute
      members" setting allows sees Mute; choosing a length (15 minutes,
      1 hour, 1 day, 7 days, or until lifted) and an optional reason saves
      the mute through `muteGroupMember`, on both phones (both apps share
      the Compose UI).
- [ ] The muted member's row then shows Unmute in place of Mute, and the
      member sees the existing mute banner with its end time.

### Error paths

- [ ] A failed save shows the existing error and leaves the member
      unmuted on screen.

### Edge cases

- [ ] Mute is never offered on the group's owner, nor on yourself
      (SHY-0652: no admin or mod acts on the owner).
- [ ] Someone the setting does not allow sees no Mute.

### Performance

- [x] Not applicable: one write, as today's Unmute.

### Security

- [x] Not applicable here: the rules already decide who may write a mute
      (SHY-0653, SHY-0652); this story adds only the button.

### UX

- [ ] A unit test of the shared decision (who sees Mute on whom) pins each
      case above; a Compose test shows the button and the length choice.

### i18n

- [ ] Every new label (the Mute action, each length, the reason field) is
      in all 20 locales, each read back by Google Cloud Translation before
      it is committed, with its writer/reader table.

### Observability

- [x] Not applicable: a refused write is already logged on the device
      naming the action (SHY-0648, #2475).

## Announce

Group owners, admins and mods can now mute a member for a set time
straight from the members list.

## BDD Scenarios

**Scenario: an admin mutes a member for an hour**

- **Given** Theo is an admin of a group where admins may mute
- **When** Theo opens the members list, taps Mute on Selma and picks 1 hour
- **Then** Selma is muted for an hour and her row shows Unmute

**Scenario: no one is offered Mute on the owner**

- **Given** Alice owns the group and Theo is an admin
- **When** Theo opens the members list
- **Then** Alice's row shows no Mute

## Test Plan

- Unit tests of the shared who-sees-Mute decision, one per case.
- Compose test of the button and the length choice.
- The phone walk, shared with SHY-0653: Theo mutes Selma for the shortest
  length; Selma is stopped, then posts once it ends. Needs phones.

## Out of Scope

- Who may write a mute, enforced by the rules (SHY-0653, SHY-0652).
- Moving mutes to a server route with a log entry (SHY-0629).
- Voice-room mutes (SHY-0340).

## Dependencies

- None to start. SHY-0652 makes the rules refuse a mute on the owner; this
  story hides the button on the owner either way.

## Risks & Mitigations

- New copy in 20 locales: each line read back by Google before commit.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; green on dev on both phones; Shyden signs off the phones;
      in the group-roles release branch with SHY-0648, SHY-0647, SHY-0652
      and SHY-0653.

## Notes

- **2026-10-20**: Filed while preparing SHY-0652. P0: a defect (a setting
  users can change that nothing they can reach obeys), and it blocks
  SHY-0653's phone walk (P0). MVP: a launch group's staff meet it. Scored
  5: a shared decision, a button and a length choice in Compose, new copy
  in 20 locales with Google read-back, unit and Compose tests; above
  SHY-0655's 2 (one rule clause) and level with SHY-0653's 5.
- **2026-10-20**: Shyden, chosen from written options: it **joins the
  group-roles hotfix** (over shipping without it or hiding the setting),
  and the lengths are **15 minutes, 1 hour, 1 day, 7 days and until
  lifted**.
