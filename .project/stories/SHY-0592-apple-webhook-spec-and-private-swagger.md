---
id: SHY-0592
status: Draft
owner: unassigned
created: 2026-10-15
priority: P2
effort: S
estimate: 3
type: infra
roadmap_ids: []
mvp: false
blocked_by: [SHY-0587]
---

# SHY-0592: The Apple notifications webhook has a hand-written spec, contract tests and a private Swagger page

## User Story

As **Shyden, the operator**, I want the endpoint Apple calls with App Store
purchase and subscription notifications documented, contract-tested and shown
on a private Swagger page, so that a change to how we answer Apple cannot
silently break renewals, refunds or revocations.

## Why

Global Swagger rule (Shyden 2026-10-15); every ShyTalk API is private (same
day). Only Apple calls this endpoint. SHY-0218's spec covers the client-facing
APIs only, so this spec is written here.

Measured on `origin/develop` 661f0ae5722: **1 route**,
`POST /api/apple-notifications/v2` (`routes/apple-notifications.js`). Its
answers: 400 `signedPayload required`, 400 `Invalid notification signature`,
400 `Notification missing notificationUUID`, 400 `Invalid embedded
transaction`, 200 `{ ok: true, deduped: true }` for a repeat, 200
`{ ok: true }`.

## Acceptance Criteria

### Happy path

- [ ] A hand-written `express-api/openapi/apple-notifications.yaml` (never
      generated) documents the route, the `signedPayload` body, every status
      and error above.
- [ ] Contract tests (integration suite) hold the real endpoint to the spec for
      every documented answer.
- [ ] The spec is served on its own private docs page (SHY-0587).

### Error paths

- [ ] Each 400 answer is contract-tested with the input that causes it.

### Edge cases

- [ ] A valid signed payload cannot be made from the page (only Apple signs
      them), so the dev docs show the refusals live and document Apple's App
      Store Server API "request a test notification" call as the way to drive
      the success path on dev (sandbox).
- [ ] The duplicate answer (`deduped: true`) is contract-tested by sending the
      same notification twice in the integration suite with a fixture signed
      by the suite's own test certificate chain, never a disabled check.

### Performance

- [ ] N/A: no route changes.

### Security

- [ ] Planted: the page and spec refuse a signed-out request and an ordinary
      user's token.
- [ ] The spec says plainly that the signature check is the endpoint's only
      guard, and a contract test proves an unsigned payload is refused.

### UX

- [ ] N/A beyond SHY-0587's page layout.

### i18n

- [ ] N/A: operator-only developer docs, English only.

### Observability

- [ ] The contract suite reports the number of answers it checked (6), with a
      recorded floor.

## BDD Scenarios

**Scenario: An unsigned notification is refused as documented**

- **Given** a request with a payload Apple did not sign
- **When** it reaches the webhook
- **Then** the answer is 400 "Invalid notification signature", as the spec says

## Test Plan

1. RED first: contract tests against an empty spec.
2. Mutations: change one 400 message; return 500 for a duplicate; each goes red.

## Out of Scope

- Google Play's notifications (no endpoint exists today).

## Dependencies

- SHY-0587 (page and gate).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A test certificate chain is accepted in production | The test chain is loaded only in the test suite, pinned by a test that production config rejects it. |

## Definition of Done

- [ ] Spec, contract tests and page merged; contract step required in CI.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed from the global Swagger rule.
