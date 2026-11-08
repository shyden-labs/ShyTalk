# ShyTalk's email sender Implementation Plan (#88)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `sendMail(env, {to, subject, text, html})` that sends ShyTalk's mail through Cloudflare Email Sending: live from `no-reply@shytalk.app`, dev and test from `no-reply@dev.shytalk.app` through the PROD-account door.

**Architecture:** A small shared module (`packages/mail`) holds the message check and the `E_*`-code-to-reason map. The live Worker calls its own `send_email` binding. Each door Worker gains one reserved route, `POST /__door/mail`, guarded by a per-environment `MAIL_SECRET` compared in constant time, which calls the door's own binding. The dev/test Worker's `sendMail` posts to its own `SITE_ORIGIN + /__door/mail`. Every send writes one audit row.

**Tech Stack:** TypeScript on Cloudflare Workers, Wrangler 4.157 (`send_email` with `allowed_sender_addresses`), Vitest 5 unit tests, GitHub Actions deploys.

**Spec:** `docs/superpowers/specs/2026-11-08-email-sender-design.md` (with the 2026-11-08 change below).

**Spec change (Shyden, 2026-11-08):** no CI integration test that sends mail. AC3 is proven by one measured send to a Gmail and an Outlook inbox, with the headers saved as evidence on #88 (Task 5).

## Global Constraints

- `sendMail` answers `{ok: true, messageId}` or `{ok: false, reason}`; it never throws for a send failure, and it never logs the body (a code is a secret).
- Live sends only as `no-reply@shytalk.app`; dev and test only as `no-reply@dev.shytalk.app`; each binding is locked with `allowed_sender_addresses`.
- Reasons: `rate-limit`, `daily-limit`, `suppressed`, `sender-not-verified`, `delivery-failed`, `suspended`, `unavailable`, `invalid`; an unknown code is `unknown`, with the code kept in the audit row.
- `MAIL_SECRET` is a Wrangler secret on both sides, separate from `DOOR_SECRET`, compared in constant time.
- No retry wrapper. Every other door request is forwarded exactly as today.
- Audit rows `mail.sent` / `mail.failed` hold neither the code, nor the body, nor the recipient (see Review Focus 1).
- Unit tests stand in the binding and every fetch (global rule: a unit test reaches no service and starts no process).
- Door deploys run only from `main` with the `production` reviewer (unchanged).
- No door host is written under `tests/`, `scripts/` or `.github/` (`environments.test.ts` guard): tests use `example.test` origins, compare against `DOOR_MAIL_FROM`, and `door-config.test.ts` pins it as `no-reply@` plus the dev door's own route host. `DoorMailEnv` and `MailEnv` optional fields are `T | undefined` (`exactOptionalPropertyTypes`).

## Review Focus

1. **The recipient in the audit trail.** The `audit` table refuses DELETE (`migrations/0002_audit.sql`), while the privacy policy promises deletion. A recipient address in an audit row could never be removed. Expected: no mail audit row holds the address. Pinned in Task 3 (`never puts the recipient, subject or body in the audit row`).
2. **A wrong or missing mail secret at the door.** Expected: a 403, no send, and nothing forwarded to the origin (the origin would answer something else, which a caller might misread). Pinned in Task 2.
3. **The door unreachable or answering junk** (network error, 5xx HTML, non-JSON). Expected: `{ok: false, reason: 'unavailable'}`, never a throw and never `ok: true`. Pinned in Task 3.
4. **A malformed message**: two addresses in `to`, a CR/LF in `subject` (header injection), an empty text, an oversized body. Expected: `invalid` before any binding is called, on both sides. Pinned in Tasks 1 and 2.
5. **An error that echoes its input.** A thrown binding `Error` may carry the address or body in its `message`. Expected: only a `/^E_[A-Z_]+$/` `code` is ever kept or logged, never `message`. Pinned in Task 1.

---

### Task 1: The shared mail module

**Files:**
- Create: `packages/mail/index.ts`, `packages/mail/README.md`
- Modify: `packages/environment/index.ts` (export `secretsMatch`, used by `requireDoorSecret`), `packages/environment/README.md`
- Test: `tests/unit/mail-shared.test.ts`, existing `tests/unit/environment.test.ts` (unchanged, must stay green)

**Interfaces:**
- Produces:
  - `type MailReason = 'rate-limit' | 'daily-limit' | 'suppressed' | 'sender-not-verified' | 'delivery-failed' | 'suspended' | 'unavailable' | 'invalid' | 'unknown'`
  - `interface MailMessage { to: string; subject: string; text: string; html?: string }`
  - `type MailResult = { ok: true; messageId: string } | { ok: false; reason: MailReason; error?: string }`
  - `interface EmailSender { send(message: MailMessage & { from: string }): Promise<{ messageId: string }> }` (structural stand-in for the `send_email` binding)
  - `checkMessage(value: unknown): MailMessage | null`
  - `failureFor(error: unknown): { ok: false; reason: MailReason; error?: string }`
  - `MAIL_MAX_BYTES = 65536`, `DOOR_MAIL_PATH = '/__door/mail'`, `MAIL_SECRET_HEADER = 'x-shytalk-mail-secret'`
  - `secretsMatch(given: string, configured: string | undefined): Promise<boolean>` in `packages/environment`

- [ ] **Step 1: Write the failing tests** in `tests/unit/mail-shared.test.ts`, one `it` per case:
  - `it.each` over the seven codes: `failureFor(Object.assign(new Error('x'), {code}))` equals `{ok: false, reason, error: code}` for `E_RATE_LIMIT_EXCEEDED`→`rate-limit`, `E_DAILY_LIMIT_EXCEEDED`→`daily-limit`, `E_RECIPIENT_SUPPRESSED`→`suppressed`, `E_SENDER_NOT_VERIFIED`→`sender-not-verified`, `E_DELIVERY_FAILED`→`delivery-failed`, `E_ACCOUNT_SUSPENDED`→`suspended`, `E_INTERNAL_SERVER_ERROR`→`unavailable`.
  - `E_SOMETHING_NEW` → `{ok: false, reason: 'unknown', error: 'E_SOMETHING_NEW'}`.
  - An error with no code, a non-Error value, and a code that is not `/^E_[A-Z_]+$/` (`'a@b.test'`) each give `{ok: false, reason: 'unknown'}` with no `error` key.
  - An error whose `message` is `'to a@b.test: 123456'` yields a result whose `JSON.stringify` contains neither `a@b.test` nor `123456`.
  - `checkMessage({to: 'a@b.test', subject: 'Your code', text: '123456'})` returns the same object; with `html` too, keeps it.
  - `checkMessage` returns `null` for: not an object; `to` missing, `'a@b.test, c@d.test'`, `'a@b.test;c@d.test'`, `'<a@b.test>'`, `'no-at-sign'`, a 255-character address; `subject` `''`, 201 characters, containing `\r` or `\n`; `text` `''`; `html` not a string; a message whose `JSON.stringify` is over `MAIL_MAX_BYTES` bytes.
  - `secretsMatch('s', 's')` true; `('s', 't')`, `('', '')`, `('s', undefined)`, `('', undefined)` false.
- [ ] **Step 2: Run** `npx vitest run --config vitest.unit.config.ts tests/unit/mail-shared.test.ts`. Expected: FAIL, the modules do not export these names.
- [ ] **Step 3: Implement** the module. `failureFor` reads only `error.code`. `checkMessage` allows exactly one address matching `/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/` of at most 254 characters. Move `requireDoorSecret`'s SHA-256 compare into `secretsMatch`, and make `requireDoorSecret` call it.
- [ ] **Step 4: Run** the new test and `tests/unit/environment.test.ts`. Expected: PASS. Mutate once: drop the CR/LF check and the `/^E_/` guard, watch their tests go red, then restore.
- [ ] **Step 5: Commit** `feat: the shared mail check and failure reasons` (body `Refs #88`).

### Task 2: The door's mail route

**Files:**
- Create: `workers/door/src/mail.ts`
- Modify: `workers/door/src/index.ts`, `workers/door/src/door.ts` (header comment: the door now holds one binding), `workers/door/wrangler.json`
- Test: `tests/unit/door-mail.test.ts`, `tests/unit/door-config.test.ts`, `tests/unit/door.test.ts` (adds one dispatch case)

**Interfaces:**
- Consumes: Task 1's `checkMessage`, `failureFor`, `EmailSender`, `MAIL_MAX_BYTES`, `DOOR_MAIL_PATH`, `MAIL_SECRET_HEADER`, `secretsMatch`.
- Produces:
  - `DOOR_MAIL_FROM = 'no-reply@dev.shytalk.app'`
  - `interface DoorMailEnv { EMAIL?: EmailSender; MAIL_SECRET?: string }`. `DoorEnv` gains both fields.
  - `handleMail(request: Request, env: DoorMailEnv): Promise<Response>`. The answers: 405 for a method other than POST; 503 `{ok: false, reason: 'unavailable'}` when `EMAIL` or `MAIL_SECRET` is unset; 403 for a wrong secret; 413 `{ok: false, reason: 'invalid'}` for a body over `MAIL_MAX_BYTES`; 400 `{ok: false, reason: 'invalid'}` for bad JSON or a failed check; 200 `{ok: true, messageId}`; 502 with `failureFor`'s result when the binding throws.
  - The index dispatches on exact `pathname === DOOR_MAIL_PATH` to `handleMail`, and everything else to `forward`.

- [ ] **Step 1: Write the failing tests.**
  - In `door-mail.test.ts`, with a recording `EMAIL` stand-in:
    - each answer above is its own `it`;
    - on success, `send` received `{to, subject, text, html, from: 'no-reply@dev.shytalk.app'}`, and a caller's `from` is ignored;
    - a 403 and a 503 call neither `send` nor the global `fetch` (`vi.stubGlobal('fetch', vi.fn())`, then `expect(fetch).not.toHaveBeenCalled()`);
    - a `console.*` spy over a success and over a throw: no line contains the address, the subject or the text.
  - In `door.test.ts`: the default export sends `POST /__door/mail` to `handleMail` and never to the origin; `/__door/mail/x` and `/api/x` still forward.
  - In `door-config.test.ts`: each environment holds exactly `['name', 'routes', 'send_email', 'vars']`; `DOOR_MAIL_FROM` is `no-reply@` plus the dev door's route host; `send_email` equals `[{ name: 'EMAIL', allowed_sender_addresses: [that sender] }]`. Update the file's header comment.
- [ ] **Step 2: Run** those three files. Expected: FAIL, with no `mail.ts`, no dispatch, and no `send_email` block.
- [ ] **Step 3: Implement** `handleMail` and the dispatch, and add the `send_email` block to both door environments in `workers/door/wrangler.json`. Read the body with `request.text()` after checking `content-length` against `MAIL_MAX_BYTES`, then check the text's byte length again.
- [ ] **Step 4: Run** the three files, then `npm run typecheck` and `npm run lint`. Expected: PASS. Also run `cd workers/door && npx wrangler deploy --dry-run --env dev --outdir "$TMPDIR/door-dev"` and confirm it bundles with no config warning. Mutate once: compare the secret with `===` short-circuited to `true`, see the 403 test fail, then restore.
- [ ] **Step 5: Commit** `feat: the door sends dev and test mail on /__door/mail` (body `Refs #88`).

### Task 3: `sendMail` in the site Worker

**Files:**
- Create: `workers/web/src/mail.ts`
- Modify: `workers/web/src/web.ts` (`WebEnv` gains `EMAIL?: EmailSender` and `MAIL_SECRET?: string`), `workers/web/wrangler.json` (prod `send_email`)
- Test: `tests/unit/mail.test.ts`, `tests/unit/web-config.test.ts`

**Interfaces:**
- Consumes: Task 1's types, `checkMessage` and `failureFor`; Task 1's `DOOR_MAIL_PATH` and `MAIL_SECRET_HEADER`; `audit()` from `workers/web/src/audit.ts`.
- Produces: `LIVE_MAIL_FROM = 'no-reply@shytalk.app'`, and `sendMail(env: MailEnv, message: MailMessage): Promise<MailResult>`, where `interface MailEnv extends AuditEnv { DB: AuditDatabase<unknown> & { batch(statements: unknown[]): Promise<unknown> }; EMAIL?: EmailSender; SITE_ORIGIN?: string; MAIL_SECRET?: string }`.
  - prod: an `invalid` message is refused without sending; no `EMAIL` gives `unavailable`; otherwise it calls `EMAIL.send({...message, from: LIVE_MAIL_FROM})`, and a throw goes through `failureFor`.
  - test/dev: no `SITE_ORIGIN` or `MAIL_SECRET` gives `unavailable`; otherwise it POSTs JSON to `SITE_ORIGIN + DOOR_MAIL_PATH` with `MAIL_SECRET_HEADER`. A JSON body shaped as `MailResult` is returned as it is; anything else (a throw, non-JSON, an unexpected shape) is `unavailable`.
  - Each outcome then runs `env.DB.batch([audit(env, {actor: 'system', action: 'mail.sent' | 'mail.failed', detail})])`, where `detail` is `{messageId}` or `{reason, error?}`, with no `subject`. An audit write that throws is rethrown (the trail is required).

- [ ] **Step 1: Write the failing tests** in `mail.test.ts`, with a recording `EMAIL`, a stubbed global `fetch`, and a recording `DB`:
  - prod success sends `from: 'no-reply@shytalk.app'` and answers `{ok: true, messageId}`;
  - prod with `E_DAILY_LIMIT_EXCEEDED` thrown answers `{ok: false, reason: 'daily-limit', error: 'E_DAILY_LIMIT_EXCEEDED'}`;
  - prod without `EMAIL` answers `unavailable` and calls no fetch;
  - prod never calls `fetch`, and dev/test never touch `EMAIL`;
  - dev posts to `https://dev.shytalk.app/__door/mail` with the header and the JSON body, and returns the door's `{ok: true, messageId}`;
  - dev: `fetch` throwing, a 502 with an HTML body, a 200 with `{}`, and a 200 with `{ok: true}` (no messageId) each give `unavailable`; dev with no `MAIL_SECRET` gives `unavailable` with no fetch;
  - `invalid` is returned without a send or a fetch, and is still audited as `mail.failed`;
  - one audit row per call, action `mail.sent` / `mail.failed`, actor `system`, detail as above;
  - `never puts the recipient, subject or body in the audit row`: none of the address, subject or text appears in any bound audit value;
  - a `console.*` spy over every case: no line holds the address, subject or text;
  - an audit batch that rejects makes `sendMail` reject.
  - In `web-config.test.ts`: prod's `send_email` equals `[{ name: 'EMAIL', allowed_sender_addresses: ['no-reply@shytalk.app'] }]`, and test and dev have no `send_email`.
- [ ] **Step 2: Run** both files. Expected: FAIL, with no `mail.ts` and no `send_email`.
- [ ] **Step 3: Implement** `sendMail`, and add prod's `send_email` to `workers/web/wrangler.json`.
- [ ] **Step 4: Run** both files, `npm run test:unit`, `npm run typecheck` and `npm run lint`. Expected: PASS, with whole-repo coverage at or above the CI gate. Also run `npx wrangler deploy --dry-run --env prod` from `workers/web` and confirm it bundles. Mutate once: audit `{to: message.to}`, see the audit test fail, then restore.
- [ ] **Step 5: Commit** `feat: sendMail, live by binding and dev/test through the door` (body `Refs #88`).

### Task 4: Deploys put `MAIL_SECRET`

**Files:**
- Modify: `.github/workflows/deploy-doors.yml`, `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-release.yml`
- Test: `tests/unit/deploy-doors.test.ts`, `tests/unit/deploy-dev.test.ts`, `tests/unit/deploy-release.test.ts`

**Interfaces:** secret names. The `production` environment holds `MAIL_SECRET_TEST` and `MAIL_SECRET_DEV` for the doors, `dev` holds `MAIL_SECRET` for the dev Worker, and `test` holds `MAIL_SECRET` for the test Worker. PROD's Worker holds none.

- [ ] **Step 1: Write the failing tests**, mirroring each file's existing door-secret test:
  - deploy-doors checks all four secrets before deploying either door, and fails by name (`MAIL_SECRET_TEST missing`, `MAIL_SECRET_DEV missing`) when one is missing;
  - deploy-doors puts `MAIL_SECRET --env test` and `--env dev` after the deploy, from their own variables;
  - deploy-dev puts `MAIL_SECRET --env dev` after the deploy, failing by name when it is missing;
  - deploy-release puts `MAIL_SECRET` on TEST only, failing by name when it is missing, and never with `--env prod`.
  - deploy-doors' `push.paths` also lists `packages/mail/**` and `packages/environment/**` (the door imports both), and deploy-dev's changed-areas pattern adds `packages/mail/` (found while running this plan, 2026-11-08).
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement** the lines, copying the `DOOR_SECRET` blocks' form: an `env:` entry, a `-z` check with `::error title=… missing::`, and `printf '%s' … | npx wrangler secret put MAIL_SECRET --env …`.
- [ ] **Step 4: Run** the three files and `npm run test:unit`. Expected: PASS.
- [ ] **Step 5: Commit** `ci: deploys put each environment's mail secret` (body `Refs #88`). Push the branch `feat/88-email-sender` and open one PR into `develop`. It squash-merges once CI is green on its head SHA.

### Task 5: Shyden's steps, release, and the measured send

Not code. Each step's result is read back and recorded on #88.

- [ ] **Step 1 (Shyden):** put the PROD account on Workers Paid; onboard `shytalk.app` and `dev.shytalk.app` in Email Sending; create `dmarc@shyden.co.uk` and the TXT record `shytalk.app._report._dmarc.shyden.co.uk "v=DMARC1"`; make two random secrets (`openssl rand -hex 32`), keep them in Bitwarden, and set dev's as `MAIL_SECRET_DEV` (production) and `MAIL_SECRET` (dev), and test's as `MAIL_SECRET_TEST` (production) and `MAIL_SECRET` (test).
- [ ] **Step 2:** read back with `dig`: the `cf-bounce` MX, SPF and DKIM for both domains, and `_dmarc`. Then edit `_dmarc` to `v=DMARC1; p=quarantine; rua=mailto:dmarc@shyden.co.uk` and read it back (AC2). Check for no second SPF TXT on either name.
- [ ] **Step 3:** dev deploys on the merge. The door changes only at the next release Shyden approves (`deploy-doors.yml`, `main` only).
- [ ] **Step 4 (measured send, dev sender):** Shyden runs one copyable `curl` from his Mac, with the dev mail secret from Bitwarden, posting to `https://dev.shytalk.app/__door/mail` addressed to a Gmail inbox and an Outlook inbox. Read each mail's headers in Chrome and save `Authentication-Results` (spf, dkim and dmarc each `pass`) as evidence on #88 (AC3, dev sender).
- [ ] **Step 5 (live sender):** `no-reply@shytalk.app` has no caller until #133. Its Gmail and Outlook headers are read on #133's first live sign-in code, and #88 AC3's live half is ticked then. Until that read, #88 stays open (the proof rule).
- [ ] **Step 6:** two clean weeks of DMARC reports, then `p=reject` (a dated follow-up on #88).
