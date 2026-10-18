---
id: SHY-0644
status: Draft
owner: claude
created: 2026-10-19
priority: P0
effort: S
estimate: 3
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0001
blocked_by: [SHY-0645]
---

# SHY-0644: A reaction that does not save says so

## User Story

As a learner reacting to a message in a private or group chat, I want to be
told when my reaction did not save, so that I am never left thinking I
reacted when nobody can see it.

## Why

Found on 2026-10-19 while testing SHY-0614's rules lock.
`PrivateChatViewModel.toggleReaction` (shared, both apps) calls
`pmRepository.toggleReaction` and drops the result: a failed write shows
nothing at all. The reaction only appears when Firestore's listener sees it,
so a refused or failed write leaves the bubble unchanged with no message.

This is live today: the production rules let only a message's sender and
group staff update it, so every recipient's reaction is refused (seen in
plant #2441, "ALLOW a recipient reacts" red against the old rules) and the
person sees nothing happen. SHY-0614 PR 3 lets participants react; any
failure that remains (no network, a banned account, a locked chat, SHY-0643's
refusals) is still silent until this lands.

## Acceptance Criteria

### Happy path

- [ ] A reaction that saves shows on the bubble as today, with no extra
      message.

### Error paths

- [ ] A reaction refused by the server or rules shows a short message
      saying it was not saved, and the bubble stays as it was.
- [ ] A reaction that fails for lack of network says the same and can be
      tried again by tapping the emoji again.

### Edge cases

- [ ] Tapping several reactions quickly while offline shows one message, not
      one per tap.

### Performance

- [x] Not applicable: no new network call; the result already returns.

### Security

- [x] Not applicable: no change to what is written or who may write it.

### UX

- [ ] The message uses the app's existing error snackbar on Android and iOS,
      readable by TalkBack and VoiceOver.

### i18n

- [ ] The new message exists in all 20 app languages, each written by Google
      Cloud Translation and read back by it before commit (table in the PR).

### Observability

- [ ] A failed reaction is logged on the device with its reason, never the
      message text.

## Announce

Nothing: a small fix to an error case.

## BDD Scenarios

**Scenario: a refused reaction tells the person**

- **Given** Budi's reaction to a message is refused
- **When** Budi taps 👍 on it
- **Then** Budi sees that the reaction was not saved
- **And** the message shows no 👍 from Budi

## Test Plan

- `PrivateChatViewModel` tests in `shared/src/commonTest` for success, a
  refusal and a network failure (fake repository), each asserting the UI
  state.
- Translation table read back by Google for all 20 languages.
- One journey step on both phones on dev (with SHY-0614's reaction
  scenarios).

## Out of Scope

- Who may react and with whose name (SHY-0614, SHY-0643).

## Dependencies

- SHY-0645: the journey this fix is proven on, on both phones.

## Risks & Mitigations

- A message on every failed tap would nag: the edge-case AC shows one.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; both phones signed off.

## Notes

- **2026-10-19**: Filed while testing SHY-0614 PR 3. P0 by the standing rule
  (a defect: a failure shown as nothing, live today); MVP (launch users
  react). Scored 3: one view-model change, one string in 20 languages, tests
  on both phones' shared code.
