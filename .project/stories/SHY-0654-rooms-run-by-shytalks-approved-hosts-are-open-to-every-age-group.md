---
id: SHY-0654
status: Draft
owner: claude
created: 2026-10-20
priority: P1
effort: L
estimate: 8
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0654: Rooms run by ShyTalk's approved hosts are open to every age group

## User Story

As a learner of any age, I want to join a lesson or event run by a ShyTalk
teacher or MC, so that public learning services reach everyone, while every
other room, chat and contact stays split by age group.

## Why

Shyden, 2026-10-20: "we do still need age-based segregation. but this
shouldn't affect public services such as teacher rooms, MC rooms etc."
Confirmed from written options: rooms open to both age groups are only those
hosted by approved hosts.

Read on `develop` at 235e977d018: no room crosses age groups today.
`express-api/src/middleware/sameCohort.js` has no host-type exemption, and
`rooms.js` gates invites (:58) and joins (:142) with `requireSameCohort`.
Account types `TEACHER`, `MC_SINGER`, `MC_EVENT_HOST` and `SHYTALK_OFFICIAL`
exist and only an admin sets them (`admin-users.js` `change-role`), but
`change-role` does not check the account's age group, so an under-18 account
could be given one.

Shyden's safety answers (2026-10-20, each from written options):
1. Mixed rooms are **only rooms hosted by an account an admin made Teacher,
   MC singer, MC event host or ShyTalk Official**.
2. Under-18s in a mixed room **listen, use its text chat, and speak on a seat
   only when the host invites them**.
3. **No contact across age groups outside the room**: following, private
   messages, friend requests and gifts between an adult and an under-18 stay
   blocked, even after meeting in a mixed room.
4. **No extra host check**, "because only adults can become MC or teacher";
   this story makes the server enforce that.

## Acceptance Criteria

### Happy path

- [ ] An under-18 and an adult can both join a room whose host is an approved
      host type, on both phones.
- [ ] An under-18 in a mixed room can listen and use the room's text chat.
- [ ] The host can invite an under-18 to a seat; once seated they can speak.

### Error paths

- [ ] An under-18 cannot take a seat in a mixed room unless the host invited
      them; the server and the rules refuse a direct write.
- [ ] Giving `TEACHER`, `MC_SINGER`, `MC_EVENT_HOST` or `SHYTALK_OFFICIAL` to
      an under-18 account is refused by the server with a clear error.
- [ ] A room whose host loses the approved type (or is suspended) stops being
      mixed: no new cross-age joins, and people from the other group already
      inside are removed with a message.

### Edge cases

- [ ] Every room whose host is not an approved type stays split exactly as
      today (existing cohort tests stay green unchanged).
- [ ] Following, private messages, friend requests and gifts between an adult
      and an under-18 stay refused, including between two people in the same
      mixed room, and including gifts sent inside the room.
- [ ] An approved host who is moved into the under-18 group (date-of-birth
      correction) loses the type.

### Performance

- [ ] Joining a mixed room is no slower than joining any room, measured on
      dev.

### Security

- [ ] Every rule above is enforced by the server and the database rules, not
      only by the apps; rules and route tests pin each, each seen RED first.
- [ ] A security review of the cohort changes is recorded in the PR.

### UX

- [ ] A mixed room shows it is open to everyone, in the room list and inside
      the room.
- [ ] An under-18 sees why they cannot take a seat (waiting for the host's
      invite), not a bare error.

### i18n

- [ ] Every new string is in all 20 locales and read back by Google Cloud
      Translation before commit.

### Observability

- [ ] A refused cross-age action (seat, contact, gift, role) is logged by the
      server naming the action, without personal data beyond the ids.

## Announce

Lessons and events run by ShyTalk's teachers and MCs are now open to learners
of every age.

## BDD Scenarios

**Scenario: a learner under 18 joins a teacher's lesson**

- **Given** Bao is a ShyTalk teacher hosting a room, and Mia is under 18
- **When** Mia opens Bao's room
- **Then** Mia joins, listens and can type in the room's chat

**Scenario: an under-18 speaks only when invited**

- **Given** Mia is in Bao's mixed room
- **When** Mia tries to take a seat without an invite
- **Then** she is told she needs the host's invite, and a direct write is
  refused

**Scenario: no private contact across age groups**

- **Given** Mia (under 18) and Sam (adult) are both in Bao's room
- **When** Sam tries to message, follow or gift Mia
- **Then** each is refused, as it is outside the room

## Test Plan

- Route tests (`express-api/tests/routes/`): joins, seats, `change-role`
  refusal, contact and gift refusals across ages from a mixed room.
- Firestore rules tests: room membership and seats in a mixed room.
- Unit (commonTest): the decision of whether a room is mixed and what an
  under-18 may do in it.
- Journey (one definition, both phones): Bao hosts, Mia and Sam join; Mia
  waits for the invite then speaks; Sam's message to Mia is refused.

## Out of Scope

- Mixing age groups anywhere outside approved hosts' rooms.
- Any change to how age groups are assigned.

## Dependencies

- None blocking. Built after the live-app work (EPIC-0011, Shyden's order,
  2026-10-20).

## Risks & Mitigations

- **An adult reaches under-18s through a mixed room.** Only admin-approved
  hosts open one; under-18s speak only when invited; all private contact
  across ages stays refused by the server.
- **A host type given to an under-18 by mistake.** The server refuses it.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; green on dev on both phones; Shyden signs off the phones.

## Notes

- **2026-10-20**: Filed from Shyden's sidenote and his four safety answers.
  P1: a feature, after the live-app work. MVP: a launch learner meets it.
  Scored 8: the cohort exemption on joins and seats in the server and the
  rules, a `change-role` refusal, the host-loses-type clean-up, the room
  badge in 20 locales, and tests in four places.
- My calls, not Shyden's answers (for him to check at pickup): a host who
  loses the type ends the mixing and the other group is removed with a
  message; a mixed room shows a badge; a host moved into the under-18 group
  loses the type.
- Server decides (the approved live-app model, 2026-10-20): which host types
  open mixed rooms is server config; the badge text is server copy.
