---
id: SHY-0616
status: Draft
owner: claude
created: 2026-10-16
priority: P3
effort: M
estimate: 5
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0616: Every website page, the portal and the dev-site gate keep a log

## User Story

As the operator, I want every page of the website, the sign-in portal and
the dev-site password gate to keep a log, so that an error on any of them
can be found after it happens.

## Why

Shyden's global rule (2026-10-16): every application we build keeps a log,
and its logging is tested; the log comes after the release and never
blocks it.

Measured on `origin/develop` `158d84d7812` (2026-10-16): 7 of the 11 HTML
pages under `public/` load `public/js/logger.js`, which sends errors,
clicks and page timings to ShyTalk's own `POST /api/logs`. Four load
nothing:

- `public/portal/index.html` (the sign-in portal; `portal.js` only writes
  `console.error`)
- `public/404.html`
- `public/do-not-sell.html`
- `public/events/khmer-new-year.html`

The dev-site gate (`functions/_middleware.js`, `functions/_lib/lockdown.js`,
a Cloudflare Pages function, a no-op on production) has no log at all, not
even of a refused password.

Shyden's choice (AskUserQuestion, 2026-10-16): _"All, full logger"_: every
page gets the full logger, the opt-out page included, and the dev gate logs
to Cloudflare's own log.

## Acceptance Criteria

### Happy path

- [ ] The four pages load `logger.js` and call `ShyTalkLogger.init` with
      their own `source` (`portal`, `not-found`, `do-not-sell`,
      `event-page`), the same way `privacy.html` does.
- [ ] The portal passes its signed-in token through `getToken`, as the
      admin panel does.
- [ ] The dev gate logs each refused request (time, path, reason) to
      Cloudflare's own log, never the password typed.

### Error paths

- [ ] A failing `POST /api/logs` never breaks the page it came from.

### Edge cases

- [ ] A guard reads every HTML page under `public/` (from the filesystem,
      not a list) and fails when one does not load the logger; it has a
      recorded floor and is seen RED with a page planted without it. New
      event pages are caught by it.
- [ ] When the `repo-template` logging design lands, these pages move to
      it with the rest of the website (not in this story).

### Performance

- [ ] Page weight and load time are measured before and after on each of
      the four pages; no visible regression.

### Security

- [ ] No password, token or form content reaches a log; a test plants each
      one on the portal and watches it stripped.
- [ ] The page's Content Security Policy still holds.

### UX

- [ ] No visible change on any page.

### i18n

- [ ] Not applicable: no user-facing text changes.

### Observability

- [ ] The new logging's checks run in the `logs` suite (SHY-0613); unit
      keeps fast stand-ins.
- [ ] Each page's first log line is seen in the admin log viewer on dev.

## BDD Scenarios

**Scenario: an error on the portal is kept**

- **Given** the portal page throws an error
- **When** the logger sends it
- **Then** the admin log viewer on dev shows it with source `portal`

**Scenario: a refused dev-site password is logged**

- **Given** a request to the dev site with a wrong password
- **When** the gate refuses it
- **Then** Cloudflare's log shows the refusal without the password

## Test Plan

- Playwright specs per page (one test per page, not a loop).
- Jest test of `lockdown.js`'s log call, password absent.
- The guard over every page, with its mutation.

## Out of Scope

- The phone apps (SHY-0615).
- Choosing a new log store (the `repo-template` research).

## Dependencies

- SHY-0613 (the `logs` suite). None blocking; it follows the release.

## Risks & Mitigations

- The opt-out page records clicks, which Shyden accepted on 2026-10-16.

## Definition of Done

- [ ] Every AC ticked with its proof; CI green by step name; merged to
      `develop`; checked on dev.

## Notes

- **2026-10-16**: Filed for the global "every app logs" rule. Estimate 5:
  four script tags and inits, one log call in the gate, one guard, and
  their tests. P3 because it follows the release. The global
  `seasonal-event` skill's page template does not load the logger; the
  guard catches new event pages.
