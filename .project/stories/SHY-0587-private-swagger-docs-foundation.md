---
id: SHY-0587
status: Draft
owner: unassigned
created: 2026-10-15
priority: P2
effort: L
estimate: 8
type: infra
roadmap_ids: []
mvp: false
---

# SHY-0587: Private Swagger docs: the page, the sign-in gate and the "Try it out" rule

## User Story

As **Shyden, the operator**, I want one private Swagger page per ShyTalk API,
served from our own servers and visible only after I sign in, so that every
call the apps, admin panel and schedulers make is documented and can be tried,
while nobody else can read or use those docs.

## Why

Global rule, Shyden 2026-10-15 (`~/.claude/global-rules/reference/reference-engineering-standards.md`,
"EVERY API HAS A FULLY CAPABLE SWAGGER INTERFACE"): every API in every project
gets a fully capable Swagger interface; a private API's Swagger is private.
His decisions the same day: private docs sit behind a sign-in with his account;
a hand-written OpenAPI spec per API is the contract (SHY-0218 for the app,
admin and roadmap APIs); the library is `swagger-ui-dist` (npm, Apache-2.0,
swagger-api project; 5.33.2 read from npm 2026-10-15), self-hosted, never a CDN.

Shyden ruled the same day that **every ShyTalk API is private** (asked; both
"Private"; then *"I don't think this API should be allowed to be used
publicly"*). So ShyTalk has no public docs page at all.

This story builds what every per-API story reuses: the page, the gate, the
spec loading and the production "Try it out" rule. The six API stories
(SHY-0588 to SHY-0593) each add one API's page.

Measured on `origin/develop` 661f0ae5722: the Express API serves **326 routes
in 47 route files** plus `/api/health` and `/robots.txt` in `index.js`
(`admin-suggestions.js` is an empty stub). Grouped by caller and guard:

| API | Routes | Story | Spec owned by |
| --- | --- | --- | --- |
| Admin + portal | 182 | SHY-0588 | SHY-0218 |
| App client | 116 (+ `/api/health`) | SHY-0589 | SHY-0218 |
| Roadmap / suggestions | 12 | SHY-0590 | SHY-0218 |
| System (schedulers, uptime ping) | 4 | SHY-0591 | SHY-0591 |
| Apple App Store notifications webhook | 1 | SHY-0592 | SHY-0592 |
| Test helpers (non-production only) | 11 | SHY-0593 | SHY-0593 |

`functions/` holds only the Cloudflare Pages dev-site gate (password wall and
`robots.txt`); it serves no API. No Firebase Cloud Functions exist.

The grouping comes from each route's path and the guard in its handler or its
`router.use`. A route whose boundary is unclear is settled while its spec is
written, and the spec's in-sync check (SHY-0218) is the exact record.

## Acceptance Criteria

### Happy path

- [ ] `swagger-ui-dist` is a pinned dependency of `express-api` (exact version,
      in the lockfile), and the docs page serves its files from our own origin;
      no request leaves for a CDN (asserted from the served HTML and assets).
- [ ] One docs page per API, each loading only its own spec file (one spec per
      API, never one combined file), so a page can never show another API's
      operations.
- [ ] Signed in as Shyden, every documented operation can be tried on the
      **dev** API (`dev-api.shytalk.shyden.co.uk`), writes included.
- [ ] On **production** (`api.shytalk.shyden.co.uk`), "Try it out" works only
      for operations the spec marks as changing nothing (a vendor extension,
      e.g. `x-changes-nothing: true`); every other operation is documented but
      cannot be sent from the page. No test data reaches production.

### Error paths

- [ ] Not signed in (no session, expired session, signed in as anyone but
      Shyden): the docs page, every spec file and every docs asset that could
      describe the API answer with no API content (a login redirect, 401 or
      404), proven by request tests for each.
- [ ] A spec file that fails to parse fails CI, naming the file; the page
      never serves a half-loaded spec.

### Edge cases

- [ ] The "changes nothing" marker is checked: a test fails any production-
      tryable operation whose method is not GET or HEAD, and the per-API
      stories prove each marked GET writes nothing (e.g.
      `GET /auth/biometric/challenge` creates a challenge, so it is NOT
      marked).
- [ ] The gate's choice is recorded in this story before building: recommended
      Cloudflare Access for Shyden's email in front of the docs path (the page
      is gated before any of our code runs; check first that
      `api.shytalk.shyden.co.uk` is proxied through Cloudflare, never assumed),
      with the spec files ALSO requiring an admin ID token with the
      `totpVerified` claim (the portal's existing check), so either layer alone
      keeps the docs closed. The alternative, the admin portal's own sign-in,
      needs a cookie, because a browser sends no bearer header when it first
      opens a page.
- [ ] The docs path is excluded from the general rate limiter's budget only if
      measured necessary; it is never on the auth skip list without the gate.

### Performance

- [ ] The docs files add nothing to any API route's response time (served by a
      static handler mounted ahead of nothing on the request path of API
      calls), checked by the existing API latency tests.

### Security

- [ ] `helmet`'s Content Security Policy stays as it is for every API route;
      any loosening Swagger UI needs applies to the docs path alone, with a test
      pinning both.
- [ ] Planted: request each docs URL with no session, a normal user's token and
      an admin token without `totpVerified`; each is refused. Remove the gate in
      a mutation run and watch the tests go red.
- [ ] The docs carry no secrets: example values are non-personal, and a guard
      fails a spec containing anything shaped like a key or token.

### UX

- [ ] Each page states which API and which environment it is on, and says
      plainly on production why a write cannot be tried there ("try this on
      the dev docs").

### i18n

- [ ] N/A: operator-only developer docs, English only.

### Observability

- [ ] Every refused docs request is logged by the existing request logger with
      the reason (no session, not Shyden), and a daily check proves the gate
      still refuses an anonymous request (global rule: nothing we rely on stops
      silently).

## BDD Scenarios

**Scenario: A stranger cannot see the docs**

- **Given** someone who is not signed in as Shyden
- **When** they open the admin API docs page or its spec file
- **Then** they get no API content

**Scenario: A write cannot be tried on production**

- **Given** Shyden is signed in to the production docs
- **When** he opens an operation that changes data
- **Then** "Try it out" is unavailable and the page points him to the dev docs

**Scenario: Every call can be tried on dev**

- **Given** Shyden is signed in to the dev docs
- **When** he tries any operation
- **Then** the request reaches the dev API and its real response is shown

## Test Plan

1. RED first: request tests for the gate and the try-it-out rule against a
   stub spec, then build until green.
2. Mutations: drop the gate; mark a POST as changing nothing; load a CDN URL;
   each goes red.
3. On dev after merge: open each page signed out (refused) and signed in
   (loads), read by eye once.

## Out of Scope

- Writing the specs (SHY-0218 for the app, admin and roadmap APIs; SHY-0591 to
  SHY-0593 for the rest).
- Any public docs page: Shyden ruled every ShyTalk API private (2026-10-15).

## Dependencies

- None to start; the per-API stories wait on this one.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The API host is not proxied through Cloudflare, so Access cannot sit in front | Checked first (Edge cases); the fallback is the portal sign-in with a cookie. |
| Swagger UI needs inline styles that `helmet` blocks | Loosen for the docs path only, pinned by a test. |
| A GET that writes is marked tryable on production | The per-API stories prove each marked GET writes nothing. |

## Definition of Done

- [ ] Gate and try-it-out rule mutation-verified; tests required in CI.
- [ ] Story `In Review` before merge; CI green by name; merged to `develop`.

## Notes

- **2026-10-15**: Filed on the relay from the shyden.co.uk session of Shyden's
  global Swagger rule. Shyden ruled every ShyTalk API private the same day.
  `repo-template` gets the pattern in its own repo, not here.
