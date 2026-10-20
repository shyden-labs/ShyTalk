---
id: SHY-0659
status: Draft
owner: claude
created: 2026-10-21
priority: P0
effort: S
estimate: 2
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0659: The ShyTalk system thread is named, not "Unknown"

## User Story

As a member who receives a notice from ShyTalk (a warning, or a restriction
lifted), I want the thread to say it is from ShyTalk, so that I know the
message is official and not from a stranger.

## Why

Found on the SHY-0647 phone walk, 2026-10-20, on both phones (Android
0.99.0-b383 as Alice, iPhone local Debug-Dev 2822 as Theo): the thread holding
"A restriction on your account has been lifted." and a moderation warning is
titled "Unknown" in the conversation list.

Cause, read on `develop` at 35526136fb9: the server writes the system user
(`users/SHYTALK_SYSTEM`, display name `SYSTEM_DISPLAY_NAME` "ShyTalk System",
`express-api/src/utils/system-pm.js`). The apps fetch the other person of each
one-to-one thread through `POST /api/users/batch` (SHY-0338), and that route
keeps numeric ids only (`express-api/src/routes/users.js`, "Numeric uniqueIds
only"), so `SHYTALK_SYSTEM` is dropped, `otherUser` is null, and the shared
`ConversationListItem.kt` falls back to the "Unknown" string. The list item is
`commonMain`, so both phones show it.

## Acceptance Criteria

### Happy path

- [ ] `POST /api/users/batch` returns the system user's public profile when
      asked for `SHYTALK_SYSTEM`, beside the numeric ids it already returns.
- [ ] The conversation list on each phone titles the system thread with that
      name.

### Error paths

- [ ] A system user document that does not exist yet is created on first
      use as today, and the route never fails the other ids for it.

### Edge cases

- [ ] Any other non-numeric id is still dropped (the numeric filter stays
      for everything but the one system id).
- [ ] The system user is returned whatever the caller's cohort (it has no
      cohort) and is never dropped by the block filter.

### Performance

- [x] Not applicable: one id in a batch the route already reads.

### Security

- [ ] The route returns only the system user's public fields, the same
      shape as any other profile.

### UX

- [ ] The thread reads as official on both phones (name, and the existing
      system badge in `ConversationListItem.kt`).

### i18n

- [x] Not applicable: the name is the product's own, never translated.

### Observability

- [x] Not applicable: no new failure path.

## Announce

Notices from ShyTalk now say they are from ShyTalk.

## BDD Scenarios

**Scenario: a notice thread is named**

- **Given** Alice has a notice from ShyTalk
- **When** she opens her messages
- **Then** the notice thread is titled with ShyTalk's system name, not "Unknown"

## Test Plan

- Route tests in `express-api/tests/` for `/api/users/batch`: the system id
  alone, mixed with numeric ids, another non-numeric id still dropped, every
  cohort.
- A phone check on both phones, one walk definition.

## Out of Scope

- The system thread's place at the top of the list: it is pinned there on
  purpose (`ConversationListViewModel.kt`, `emitSortedConversations`, since
  v0.37, 2026-02-19). The walk noted it sits above newer threads; Shyden
  kept the pin on 2026-10-21 ("Keep it pinned"): account notices must stay
  in sight.

## Dependencies

- None.

## Risks & Mitigations

- Widening the id filter lets other strings through: an edge-case AC pins
  that only the one system id is admitted.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; checked on both phones on dev.

## Notes

- **2026-10-21**: Filed from the SHY-0647 phone walk (finding 1, Minor, both
  phones). P0: a defect (every defect is P0). MVP: every member who gets a
  notice meets it. Scored 2: one clause in one route, route tests, a phone
  check. Server decides (`project-live-app-server-decides`): the server
  already holds the name.
