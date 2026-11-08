# ShyTalk's email sender: design (#88)

Status: approved direction (Shyden, 2026-11-08): Cloudflare Email Sending, dev/test mail through the PROD-account door, dev/test from `no-reply@dev.shytalk.app`, DMARC reports to `dmarc@shyden.co.uk`. Replaces the Oracle Email Delivery draft (Shyden asked for the domain's own provider; Cloudflare, the registrar, sells no mailbox, so its Email Sending was chosen over SparkedHost hosting and Oracle).

## Intent

ShyTalk sends its own sign-in codes from `no-reply@shytalk.app` through Cloudflare Email Sending, from the Workers it already runs. For now the sender does one job: emailing codes for account creation and sign-in (#133; the website's #60 uses the same sender). Closed-testing confirmations (#55) reuse it later. Trusted devices (#134) skip the code where they can, which keeps the count down.

## Goals

- One function, `sendMail(env, {to, subject, text, html})`, answering `{ok: true, messageId}` or `{ok: false, reason}`. It never throws for a send failure, and it never logs the body (a code is a secret).
- Live can send only as `no-reply@shytalk.app`; dev and test only as `no-reply@dev.shytalk.app`. Each binding is locked with `allowed_sender_addresses`, so neither can send as the other.
- SPF, DKIM and DMARC pass at Gmail and Outlook (headers read, #88 AC3).
- A caller shows a failure as a failure, never "check your email" (#88 AC4; the callers #133, #60 and #55 test their own screens).

## Non-goals

- No marketing mail, no newsletters, no bulk sends.
- No inbound mail (support mail is Shyden Labs' shared support system, decision 225).
- No retry wrapper (global rule: a retry is not a fix). A failed send is reported with its reason.

## Measured facts (Cloudflare docs, read 2026-11-08)

- Pricing (updated 2026-06-09): sending to any recipient needs Workers Paid; 3,000 emails a month included per account, then $0.35 per 1,000. Hard bounces count; sends rejected at the API (suppressed recipients included) do not. Sends to verified destination addresses are free and outside the quota.
- Limits (updated 2026-10-30): new accounts start on a conservative daily quota that rises with good sending; up to 50 recipients and 25 MiB per mail. Increases can be requested.
- Workers API (updated 2026-10-30): a `send_email` binding; `env.EMAIL.send({to, from, subject, text, html})` returns `{messageId}` and throws an `Error` with a `code` (`E_RATE_LIMIT_EXCEEDED`, `E_DAILY_LIMIT_EXCEEDED`, `E_RECIPIENT_SUPPRESSED`, `E_SENDER_NOT_VERIFIED`, `E_DELIVERY_FAILED`, `E_ACCOUNT_SUSPENDED`, `E_INTERNAL_SERVER_ERROR` and others). Bindings can be restricted with `allowed_sender_addresses`.
- Domains: onboarding adds the records itself: `cf-bounce` MX, SPF (`include:_spf.mx.cloudflare.net`) and DKIM on `cf-bounce.<domain>`, and DMARC on `_dmarc.<domain>`. A subdomain (`dev.shytalk.app`) is a separate sending domain, onboarded the same way. A zone allows 30 sending/routing domains.
- Accounts: a sending domain must be in the sender's own Cloudflare account. `shytalk.app` is in the PROD account (`workers/web/wrangler.json`, `workers/door/wrangler.json`); dev and test Workers run in the non-prod account. A subdomain as its own zone needs Enterprise (DNS docs, Subdomain setup: Free/Pro/Business "No"). Hence dev/test mail goes through the PROD-account door (Shyden, 2026-11-08).

## The how

- **Live:** the live Worker (`workers/web`, env `prod`, PROD account) gets a `send_email` binding `EMAIL`, `allowed_sender_addresses: ["no-reply@shytalk.app"]`, and calls it directly.
- **Dev and test:** the door Worker (`workers/door`, PROD account, already answering `dev.shytalk.app` and `test.shytalk.app`) gets a `send_email` binding `EMAIL`, `allowed_sender_addresses: ["no-reply@dev.shytalk.app"]`, and one reserved route, `POST /__door/mail`. It accepts only requests carrying that environment's `MAIL_SECRET` (a Wrangler secret on both sides, separate from `DOOR_SECRET`, compared in constant time), sends, and answers `{ok, messageId}` or `{ok: false, reason}`. Every other request is forwarded as today. The dev/test Worker's `sendMail` posts to `SITE_ORIGIN + /__door/mail`.
- **Shared quota:** dev, test and live share the PROD account's 3,000 a month and its daily cap. Dev and test use it lightly (journey runs, Shyden's phones); `sendMail` reports `E_DAILY_LIMIT_EXCEEDED` as `daily-limit`, so a run that hits it fails naming why.
- **Door deploys:** `deploy-doors.yml` deploys only from `main` with the `production` environment's reviewer, so the door's mail route changes only at a release Shyden approves.
- **DMARC:** onboarding writes `_dmarc` records; they are edited to `v=DMARC1; p=quarantine; rua=mailto:dmarc@shyden.co.uk`, moving to `p=reject` after two clean weeks. Reports to another domain need that domain's consent record (RFC 7489 section 7.1): `shytalk.app._report._dmarc.shyden.co.uk TXT "v=DMARC1"`, and the `dmarc@shyden.co.uk` mailbox must exist. Both are in shyden.co.uk's DNS and hosting, outside this repo: Shyden's step.
- **Reasons:** `sendMail` maps each `E_*` code to a short `reason` (`rate-limit`, `daily-limit`, `suppressed`, `sender-not-verified`, `delivery-failed`, `suspended`, `unavailable`, `invalid`); an unknown code maps to `unknown` with the code kept in the audit row.
- **Audit:** every send writes one audit row (`mail.sent` or `mail.failed`, with the reason), without the code or the body (as #60 AC3 asks).
- **Tests:** unit tests stand in the binding and the door's fetch: each `E_*` code to its reason, the door refusing a missing or wrong `MAIL_SECRET`, the door forwarding every other path unchanged, no body in any log line. An integration test in CI sends one mail on dev to a mailbox whose headers are read (SPF, DKIM, DMARC pass).

## Steps that are Shyden's (his identity and his consoles)

1. PROD Cloudflare account: subscribe to Workers Paid ($5/month), unless it already is.
2. Email Service, Email Sending: onboard `shytalk.app` and `dev.shytalk.app` (records added automatically), then read back with `dig`.
3. shyden.co.uk: create the `dmarc@shyden.co.uk` mailbox or alias, and add the consent record above.
4. Production approval of the door and live deploys that add the bindings.
