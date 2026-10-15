---
id: SHY-0589
status: Draft
owner: unassigned
created: 2026-10-15
priority: P2
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
blocked_by: [SHY-0587, SHY-0218]
---

# SHY-0589: The app API has a private Swagger page

## User Story

As **Shyden, the operator**, I want a private Swagger page for the API that
ShyTalk's Android, iOS and web apps call, so that every call the apps make is
documented and can be tried on dev with a test persona's sign-in.

## Why

Global Swagger rule (Shyden 2026-10-15). Shyden ruled this API **private** the
same day (asked; "Private"; *"I don't think this API should be allowed to be
used publicly"*): only our own apps call it, and public docs would map every
call, sign-in included, on a platform with minors. See SHY-0587.

Measured on `origin/develop` 661f0ae5722: **116 routes** plus `/api/health` in
`index.js`: `admin-log-config.js` (1, the apps' unauthenticated `GET
/log-config`), `age-verification.js` (2), `auth.js` (8), `ban-status.js` (1),
`banners.js` (1), `config.js` (8), `conversations.js` (5), `data-export.js`
(3), `device-info.js` (1), `devices.js` (1), `economy.js` (13), `health.js`
(1), `legal-versions.js` (1), `logs.js` (2), `notifications.js` (4),
`pm-lock-check.js` (1), `reports.js` (2), `room-mutations.js` (19),
`rooms.js` (2), `storage.js` (2), `subscriptions.js` (7),
`suggestions-notifications.js` (3), `support-tickets.js` (6), `translate.js`
(2), `users.js` (20).

## Acceptance Criteria

### Happy path

- [ ] The app API's own spec file (from SHY-0218) is served on its own private
      docs page (SHY-0587), every route with method, parameters, body, every
      response status and error shape.
- [ ] On the dev docs, Shyden can try any operation as a chosen test persona
      (a persona's dev token, never a real user's), and the real response
      matches the spec.
- [ ] On production, only operations proven to change nothing are tryable.

### Error paths

- [ ] Each operation documents its refusals: no token, an expired token, a
      banned user, the wrong age cohort (`sameCohort`), rate limits (429), App
      Check failures on the pre-sign-in paths.

### Edge cases

- [ ] Pre-sign-in operations (the `skipsAuth` list: OTP, PIN, biometric,
      health, legal versions, config reads) are marked as needing no token and,
      where `requiresAppCheck` applies, as needing an App Check token.
- [ ] Each production-tryable GET is proven to write nothing, one test per
      operation; `GET /auth/biometric/challenge` is NOT tryable on production
      (it creates a challenge).

### Performance

- [ ] N/A: documentation only; no route changes.

### Security

- [ ] Planted: the app docs page and spec refuse a signed-out request and an
      ordinary app user's token (SHY-0587's gate, re-run for this page).
- [ ] No real user's token, uid or personal data appears in examples.

### UX

- [ ] Operations are grouped as the apps use them (sign-in, profile, rooms,
      messages, coins and gifts, reports, notifications, support).

### i18n

- [ ] N/A: operator-only developer docs, English only.

### Observability

- [ ] The page states how many operations it documents, checked against the
      spec's count.

## BDD Scenarios

**Scenario: Shyden tries a room call as a test persona on dev**

- **Given** Shyden is signed in to the dev app-API docs with a test persona chosen
- **When** he tries "join room"
- **Then** the persona joins on dev and the response matches the spec

## Test Plan

1. RED first: a page test expecting every app operation against an empty spec.
2. Mutations: drop an operation; mark `POST /rooms/:roomId/join` as changing
   nothing; each goes red.

## Out of Scope

- Writing the app spec and its provider/consumer contract tests (SHY-0218).

## Dependencies

- SHY-0587 (page, gate, try-it-out rule); SHY-0218 (the app spec).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A persona token pasted into the page is kept by the browser | Swagger UI's `persistAuthorization` stays off. |

## Definition of Done

- [ ] Page live on dev behind the gate; tests required in CI.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from the global Swagger rule. The question to Shyden
  said 139 routes; a recount moved 23 router-guarded `admin-cleanup.js` routes
  to the admin API (SHY-0588). His ruling does not depend on the count.
