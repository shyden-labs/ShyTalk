---
id: SHY-0590
status: Draft
owner: unassigned
created: 2026-10-15
priority: P2
effort: XS
estimate: 2
type: infra
roadmap_ids: []
mvp: false
blocked_by: [SHY-0587, SHY-0218]
---

# SHY-0590: The roadmap API has a private Swagger page

## User Story

As **Shyden, the operator**, I want a private Swagger page for the API behind
the public roadmap page (suggestions, votes, disputes, roadmap sign-in), so
that it is documented and can be tried on dev.

## Why

Global Swagger rule (Shyden 2026-10-15). Shyden ruled this API **private** the
same day: only our own roadmap page calls it, and public docs would only help
someone script votes or spam. See SHY-0587.

Measured on `origin/develop` 661f0ae5722: **12 routes**, `roadmap-auth.js` (2:
`GET /roadmap/me`, `POST /roadmap/signout`) and `suggestions.js` (10:
create, edit, delete, vote, unvote, dispute, search, tags, mine, blocked).
The 22 admin routes in `suggestions.js` (moderation) are in the admin API
(SHY-0588).

## Acceptance Criteria

### Happy path

- [ ] The roadmap API's own spec file (from SHY-0218) is served on its own
      private docs page (SHY-0587), all 12 routes with every response status.
- [ ] Every operation can be tried on dev as a test persona; production allows
      only operations proven to change nothing (search, tags).

### Error paths

- [ ] Each operation documents its refusals: no token, a non-JSON body
      (`requireJson`), a blocked user, voting twice.

### Edge cases

- [ ] `GET /suggestions/mine` and `/suggestions/blocked` are proven read-only
      before they are tryable on production.

### Performance

- [ ] N/A: documentation only.

### Security

- [ ] Planted: the page and spec refuse a signed-out request and an ordinary
      user's token.

### UX

- [ ] N/A beyond SHY-0587's page layout.

### i18n

- [ ] N/A: operator-only developer docs, English only.

### Observability

- [ ] The page's operation count is checked against the spec's.

## BDD Scenarios

**Scenario: Shyden tries a vote on dev**

- **Given** Shyden is signed in to the dev roadmap-API docs as a test persona
- **When** he tries "vote for a suggestion"
- **Then** the vote is recorded on dev and the response matches the spec

## Test Plan

1. RED first: a page test expecting the 12 operations against an empty spec.
2. Mutation: mark `POST /suggestions/:id/vote` as changing nothing; red.

## Out of Scope

- Writing the roadmap spec and its contract tests (SHY-0218).

## Dependencies

- SHY-0587; SHY-0218.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| None beyond SHY-0587's | — |

## Definition of Done

- [ ] Page live on dev behind the gate; tests required in CI.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from the global Swagger rule; private by Shyden's
  ruling the same day.
