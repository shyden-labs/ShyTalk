---
id: SHY-0609
status: Draft
owner: unassigned
created: 2026-10-16
priority: P2
effort: M
estimate: 8
type: feature
roadmap_ids: []
mvp: false
blocked_by: [SHY-0606]
---

# SHY-0609: A suggestions-only suspension

## User Story

As **a moderator**, I want to stop someone using suggestions without
suspending their whole account, so that a learner who misuses the roadmap
board can keep practising languages with their partners.

## Why

Found 2026-10-16 while working SHY-0606. Two admin dialogs offer a
"Suggestions only" scope (`#identity-suspend-scope` and `#ig-scope-picker`
in `public/admin/index.html`), but no route enforces it: identity-graph
`suspend-all` stored the scope and fully suspended the user anyway, and
`PUT /admin/bans/graph/:id` stores a `level` that only the ban check reports.
Two backend tests named for it (`identity-graph-write-lifecycle.test.js`)
have a comment for a body (SHY-0610).

Shyden ruled 2026-10-16 (AskUserQuestion, "Remove it for now"): SHY-0606
takes the choice out of the identity dialog; this ticket builds it properly.

## Acceptance Criteria

### Happy path

- [ ] A suggestions-only suspension refuses every suggestion write (submit,
      vote, comment) with 403 and a message, and leaves every other route,
      the profile and the rooms untouched, with a test per route.
- [ ] Both admin dialogs offer it again only once it is enforced.

### Error paths

- [ ] A suggestion write by a restricted user is refused with the reason and
      end date, never silently dropped.

### Edge cases

- [ ] A full suspension on top of a suggestions-only one ends cleanly
      (SHY-0605's `endSuspension`), and the reverse.
- [ ] The restriction ends by itself at its end date.

### Performance

- [ ] The check adds no extra read per request: it rides on the cached
      suspension lookup.

### Security

- [ ] The restriction cannot be lifted by the restricted user.

### UX

- [ ] The suggestions board tells a restricted user why they cannot post,
      with the end date.

### i18n

- [ ] The new message is translated into every language and read back by
      Google Cloud Translation before it ships.

### Observability

- [ ] Starting and ending the restriction each write an audit entry.

## BDD Scenarios

**Scenario: a restricted learner opens the board**

- **Given** a learner with a suggestions-only suspension
- **When** they try to post a suggestion
- **Then** they are told they cannot until the end date, and their rooms and chats work as before

## Test Plan

1. Unit: the restriction check per suggestion route (mocks only).
2. Browser: the board's message for a restricted user.

## Out of Scope

- Full suspensions (SHY-0605, SHY-0608).

## Dependencies

- SHY-0606 removes the unenforced choice first.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The choice returns before it works | The dialogs offer it only in the PR that enforces it. |

## Definition of Done

- [ ] Every AC ticked with its test named in Notes.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-16**: Filed from SHY-0606 on Shyden's ruling. P2 and not MVP: an admin tool no launch user meets (MVP rule 2026-10-12). Scored 8: three suggestion routes, two dialogs, a translated message.
