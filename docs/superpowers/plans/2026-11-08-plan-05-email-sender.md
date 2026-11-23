# ShyTalk's email sender Implementation Plan (#88)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `sendMail(env, {to, subject, text, html})` that sends ShyTalk's mail through Oracle Email Delivery's HTTPS submission API: live as `no-reply@shytalk.app` from Singapore, dev and test as `no-reply@dev.shytalk.app` from London.

**Architecture:** A small shared module (`packages/mail`) holds the message check, the request signer (WebCrypto RSA-SHA256, Oracle's signature version 1) and the status-to-reason map. The site Worker's `sendMail` builds the `SubmitEmail` body, signs it with its environment's own Oracle key, posts it, and writes one audit row. Each environment's deploy puts its five `OCI_*` secrets into its Worker.

**Tech Stack:** TypeScript on Cloudflare Workers (WebCrypto), Wrangler 4.157, Vitest 5 unit tests, GitHub Actions deploys.

**Spec:** `docs/superpowers/specs/2026-11-08-email-sender-design.md` (Oracle rewrite, set-up as built). Replaces the Cloudflare Email Sending plan merged in #140; the reference branch `feat/88-email-sender` is not merged.

## Global Constraints

- `sendMail` answers `{ok: true, messageId}` or `{ok: false, reason}`; it never throws for a send failure, and it never logs the address, subject or body (a code is a secret).
- Live signs with `shytalk-mail-live`'s key and sends as `no-reply@shytalk.app` in `ap-singapore-1`; dev and test sign with their own keys and send as `no-reply@dev.shytalk.app` in `uk-london-1`. `MAIL_REGION` and `MAIL_FROM` are plain vars in `workers/web/wrangler.json`, pinned by `web-config.test.ts`.
- Reasons: 400 `invalid`, 401 `not-authenticated`, 404 `sender-not-approved`, 413 `too-large`, 429 `rate-limit`, 500/503 or a network failure or a 200 that is not Oracle's answer `unavailable`, a 200 naming the recipient in `suppressedRecipients` `suppressed`, any other status `unknown`. A message failing `checkMessage` is `invalid` before any fetch.
- Only Oracle's `code` (matching `/^[A-Za-z]+$/`) and the HTTP status are kept; never Oracle's `message`, which may echo the address.
- No retry wrapper. No Oracle SDK.
- Audit rows `mail.sent` / `mail.failed` hold neither the recipient, nor the subject, nor the body (see Review Focus 1). Detail keys avoid the audit module's credential words (`code` is refused): `{messageId}` or `{reason, status?, error?}`.
- Unit tests stand in `fetch` and the clock (global rule: a unit test reaches no service and starts no process). Signing tests use a key made in-process with `node:crypto`.
- Live's `OCI_*` secrets live only in the `production` GitHub environment (Shyden's reviewer) and are put there by Shyden; dev's in `dev`, test's in `test`.
- `MailEnv` optional fields are `T | undefined` (`exactOptionalPropertyTypes`).

## Review Focus

1. **The recipient in the audit trail.** The `audit` table refuses DELETE (`migrations/0002_audit.sql`), while the privacy policy promises deletion. Expected: no mail audit row holds the address. Pinned in Task 3.
2. **A signature Oracle refuses.** The signing string must match Oracle's byte for byte: six headers in order, lower-case names, `(request-target): post /20220926/actions/submitEmail`, the body's real byte length (not its character count). Expected: the signer's output equals Node's own `crypto.sign` over the expected string, for a body with a non-ASCII character. Pinned in Task 2; proven against Oracle in Task 5.
3. **Oracle unreachable or answering junk** (network error, 5xx HTML, a 200 that is not JSON or lacks `messageId`). Expected: `unavailable`, never a throw and never `ok: true`. Pinned in Task 3.
4. **A malformed message**: two addresses in `to`, a CR/LF in `subject`, an empty text, an oversized body. Expected: `invalid` before any fetch. Pinned in Tasks 1 and 3.
5. **An error that echoes its input.** Oracle's error `message` may carry the address. Expected: only `code` (letters only) and the status are kept or logged. Pinned in Task 1.
6. **A missing or malformed key.** No `OCI_*` secret, or a PEM that is not PKCS#8: expected `unavailable` without a fetch, never a throw. Pinned in Task 3.

---

### Task 1: The shared mail module

**Files:**
- Create: `packages/mail/index.ts`, `packages/mail/README.md`
- Test: `tests/unit/mail-shared.test.ts`

**Interfaces:**
- Produces:
  - `type MailReason = 'invalid' | 'not-authenticated' | 'sender-not-approved' | 'too-large' | 'rate-limit' | 'suppressed' | 'unavailable' | 'unknown'`
  - `interface MailMessage { to: string; subject: string; text: string; html?: string }`
  - `type MailFailure = { ok: false; reason: MailReason; status?: number; error?: string }`, `type MailResult = { ok: true; messageId: string } | MailFailure`
  - `checkMessage(value: unknown): MailMessage | null` (kept from `feat/88-email-sender`)
  - `failureFor(status: number, body: unknown): MailFailure`
  - `resultFor(status: number, body: unknown, to: string): MailResult` (200 handling, then `failureFor`)
  - `MAIL_MAX_BYTES = 65536`

- [ ] **Step 1: Write the failing tests** in `tests/unit/mail-shared.test.ts`, one `it` per case:
  - `it.each` over 400, 401, 404, 413, 429, 500, 503: `failureFor(status, {code: 'X', message: 'to a@b.test'})` equals `{ok: false, reason, status, error: 'X'}` with the reasons above.
  - 418 gives `{ok: false, reason: 'unknown', status: 418, error: 'X'}`.
  - A body with no `code`, a non-object body, and a `code` that is not letters only (`'a@b.test'`) each give the reason and status with no `error` key.
  - A body whose `message` is `'to a@b.test: 123456'` yields a result whose `JSON.stringify` contains neither `a@b.test` nor `123456`.
  - `resultFor(200, {messageId: 'm', envelopeId: 'e', suppressedRecipients: []}, to)` is `{ok: true, messageId: 'm'}`; with `suppressedRecipients: [{email: to}]` (any letter case) it is `{ok: false, reason: 'suppressed', status: 200}`; a 200 with `{}`, with `messageId: ''`, or with a non-object is `{ok: false, reason: 'unavailable', status: 200}`; a 404 goes through `failureFor`.
  - `checkMessage` cases as on the reference branch: accepts `{to, subject, text}` and `{…, html}`; `null` for not an object, `to` missing / a list (`,` or `;`) / `<a@b.test>` / no `@` / 255 characters / non-ASCII; `subject` empty, 201 characters, containing `\r` or `\n`; `text` empty; `html` not a string; over `MAIL_MAX_BYTES` as JSON.
- [ ] **Step 2: Run** `npx vitest run --config vitest.unit.config.ts tests/unit/mail-shared.test.ts`. Expected: FAIL, no module.
- [ ] **Step 3: Implement.** `checkMessage` from the reference branch, adding `/^[\x21-\x7e]+$/` to the address (Oracle: `email` is ASCII only). `failureFor` reads only `body.code`. `resultFor` checks `messageId` is a non-empty string and compares suppressed emails case-insensitively.
- [ ] **Step 4: Run** the test. Expected: PASS. Mutate once: drop the CR/LF check and the letters-only guard, watch their tests go red, then restore.
- [ ] **Step 5: Commit** `feat: the shared mail check and Oracle failure reasons` (body `Refs #88`).

### Task 2: The request signer

**Files:**
- Create: `packages/mail/sign.ts`
- Modify: `packages/mail/README.md`
- Test: `tests/unit/mail-sign.test.ts`

**Interfaces:**
- Produces:
  - `interface OracleKey { tenancy: string; user: string; fingerprint: string; privateKey: CryptoKey }`
  - `importKey(pem: string): Promise<CryptoKey | null>`: PKCS#8 `-----BEGIN PRIVATE KEY-----` only; anything else (PKCS#1, junk, empty) is `null`, never a throw.
  - `SIGNED_HEADERS = ['(request-target)', 'host', 'date', 'x-content-sha256', 'content-type', 'content-length']`
  - `type SignedValues = { date; 'x-content-sha256'; 'content-type'; 'content-length' }` (all `string`; a `type`, not an `interface`, so it passes as `HeadersInit`)
  - `signingString(url: URL, values: SignedValues): string` (the six lines written out, so no fallback branch for a missing header)
  - `signRequest(url: URL, body: string, key: OracleKey, now: Date): Promise<SignedValues & { authorization: string }>`: answers `date` (`now.toUTCString()`), `x-content-sha256` (base64 SHA-256 of the UTF-8 body), `content-type: application/json`, `content-length` (UTF-8 byte length) and `authorization` (`Signature version="1",keyId="<tenancy>/<user>/<fingerprint>",algorithm="rsa-sha256",headers="<SIGNED_HEADERS joined by a space>",signature="<base64>"`).

- [ ] **Step 1: Write the failing tests** in `tests/unit/mail-sign.test.ts`. `beforeAll` makes one RSA 2048 pair with `generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}})`, and also exports its PKCS#1 form.
  - `signingString` for `https://cell0.submit.email.uk-london-1.oci.oraclecloud.com/20220926/actions/submitEmail` is exactly the six lines `(request-target): post /20220926/actions/submitEmail`, `host: cell0.submit.email.uk-london-1.oci.oraclecloud.com`, `date: …`, `x-content-sha256: …`, `content-type: application/json`, `content-length: …`, joined by `\n`, no trailing newline.
  - `signRequest` on the body `{"subject":"Olá"}` at `2026-11-08T09:30:00Z`: `date` is `Sun, 08 Nov 2026 09:30:00 GMT`; `content-length` is the byte length (18, not 17); `x-content-sha256` equals `createHash('sha256').update(body).digest('base64')`.
  - The `authorization` header parses to the five parts above, in that order, and its `signature` equals `sign('sha256', Buffer.from(expectedString), privateKeyPem).toString('base64')` (PKCS#1 v1.5 is deterministic) and verifies with the public key.
  - `importKey` answers `null` for the PKCS#1 PEM, for `''`, for a PKCS#8 frame around `not base64`, and for one around valid base64 that is no key (`AAAA`); a PEM with `\r\n` line ends imports.
- [ ] **Step 2: Run** the file. Expected: FAIL, no module. Record the `beforeAll` time from the run (the hook limit is 1 s).
- [ ] **Step 3: Implement** with `crypto.subtle` only (`importKey('pkcs8', …, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['sign'])`, `digest`, `sign`), and `btoa`/`atob` for base64, so the same code runs in workerd.
- [ ] **Step 4: Run** the file. Expected: PASS. Mutate once: count `body.length` instead of bytes, and swap two signed headers; watch the byte-length and Node-signature tests fail, then restore.
- [ ] **Step 5: Commit** `feat: sign Oracle requests with WebCrypto` (body `Refs #88`).

### Task 3: `sendMail` in the site Worker

**Files:**
- Create: `workers/web/src/mail.ts`
- Modify: `workers/web/wrangler.json` (`MAIL_REGION`, `MAIL_FROM` per environment). `WebEnv` is left alone: `sendMail` takes its own `MailEnv`, and its first caller (#133) adds the fields when it wires the route.
- Test: `tests/unit/mail.test.ts`, `tests/unit/web-config.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2; `audit()` from `workers/web/src/audit.ts`.
- Produces:
  - `mailEndpoint(region: string): URL` = `https://cell0.submit.email.<region>.oci.oraclecloud.com/20220926/actions/submitEmail`
  - `interface MailEnv extends AuditEnv { DB: AuditDatabase<unknown> & { batch(statements: unknown[]): Promise<unknown> }; MAIL_REGION?: string | undefined; MAIL_FROM?: string | undefined; OCI_TENANCY?, OCI_USER?, OCI_FINGERPRINT?, OCI_PRIVATE_KEY?, OCI_COMPARTMENT?: string | undefined }`
  - `sendMail(env: MailEnv, message: MailMessage, now: () => Date = () => new Date()): Promise<MailResult>`: `checkMessage`; any of the seven settings missing, or `importKey` answering `null`, is `unavailable` with no fetch; else POST `{sender: {senderAddress: {email: MAIL_FROM, name: 'ShyTalk'}, compartmentId: OCI_COMPARTMENT}, recipients: {to: [{email: to}]}, subject, bodyText: text, bodyHtml?: html}` with `signRequest`'s headers; `fetch` throwing or a body that is not JSON is `unavailable`; otherwise `resultFor`. Then one `env.DB.batch([audit(env, {actor: 'system', action, detail})])`; an audit write that throws is rethrown (the trail is required).

- [ ] **Step 1: Write the failing tests** in `mail.test.ts`, with a stubbed global `fetch`, a fixed clock, a recording `DB`, and a key made in `beforeAll`:
  - the POST goes to `mailEndpoint(MAIL_REGION)` once, with the exact JSON body above (no `bodyHtml` key when there is no html), the six signed headers, and an `authorization` whose `keyId` is `<tenancy>/<user>/<fingerprint>`;
  - Oracle's `{messageId, envelopeId, suppressedRecipients: []}` answers `{ok: true, messageId}` and audits `mail.sent` with `{messageId}`;
  - a 404 `{code: 'NotAuthorizedOrNotFound', message: '…a@b…'}` answers `sender-not-approved` and audits `{reason, status: 404, error: 'NotAuthorizedOrNotFound'}`;
  - `fetch` throwing, a 503 with an HTML body, and a 200 with `{}` each give `unavailable`;
  - each of the seven settings missing (one `it` each), and a PKCS#1 key, give `unavailable` with no fetch;
  - `invalid` is returned without a fetch, and is still audited as `mail.failed`;
  - `never puts the recipient, subject or body in the audit row`: none appears in any bound audit value;
  - a `console.*` spy over every case: no line holds the address, subject or text;
  - an audit batch that rejects makes `sendMail` reject.
  - In `web-config.test.ts`: prod's vars hold `MAIL_REGION: 'ap-singapore-1'` and `MAIL_FROM: 'no-reply@shytalk.app'`; test and dev hold `uk-london-1` and `no-reply@dev.shytalk.app`; no environment's vars hold an `OCI_` key.
- [ ] **Step 2: Run** both files. Expected: FAIL, no `mail.ts` and no vars.
- [ ] **Step 3: Implement** `sendMail` and the vars.
- [ ] **Step 4: Run** both files, `npm run test:coverage`, `npm run typecheck`, `npm run lint` and `npm run format:check`. Expected: PASS, with whole-repo coverage at 100% on all four measures. Then `npm run build:web` (the dry run needs `apps/web/dist`) and `npx wrangler deploy --dry-run --env prod --outdir "$TMPDIR/web-prod"` from `workers/web`: bundles with no warning. Mutate once: audit `{to: message.to}`, see the audit test fail, then restore.
- [ ] **Step 5: Commit** `feat: sendMail through Oracle Email Delivery` (body `Refs #88`).

### Task 4: Deploys put each environment's Oracle secrets

**Files:**
- Modify: `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-release.yml`
- Test: `tests/unit/deploy-dev.test.ts`, `tests/unit/deploy-release.test.ts`

**Interfaces:** the secret names `OCI_TENANCY`, `OCI_USER`, `OCI_FINGERPRINT`, `OCI_PRIVATE_KEY`, `OCI_COMPARTMENT`, held in each GitHub environment (`dev`, `test`, `production`).

- [ ] **Step 1: Write the failing tests**, mirroring each file's existing `BETTER_AUTH_SECRET` test:
  - deploy-dev passes the five secrets in the deploy step's `env:` and, after the deploy, puts each with `wrangler secret put <NAME> --env dev`, failing by name (`OCI_PRIVATE_KEY missing`) when one is empty;
  - deploy-release does the same with `--env "$TARGET"` (test on `develop`/`release/*`, prod on `main`);
  - deploy-dev's changed-areas pattern adds `packages/mail/`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement** one loop per workflow: `for name in OCI_TENANCY OCI_USER OCI_FINGERPRINT OCI_PRIVATE_KEY OCI_COMPARTMENT; do value=${!name}; [ -n "$value" ] || { echo "::error title=$name missing::…"; exit 1; }; printf '%s' "$value" | npx wrangler secret put "$name" --env …; done`.
- [ ] **Step 4: Run** both files and `npm run test:unit`. Expected: PASS.
- [ ] **Step 5: Commit** `ci: deploys put each environment's Oracle mail secrets` (body `Refs #88`). Push `feat/88-oracle-mail` and open one PR into `develop`. Before it merges, the `dev` environment's five secrets are set (Task 5 Step 1), or deploy-dev fails by name.

### Task 5: Secrets, the measured sends, and the release

Not code. Each step's result is read back and recorded on #88.

- [ ] **Step 1: dev and test secrets.** From `.superpowers/sdd/88/oracle-ids.md` and `~/.config/shyden/oci/shytalk-mail-{dev,test}.pem`, set the five secrets in the `dev` and `test` GitHub environments through the ShyTalk App (`gh secret set <NAME> --env <env> < file`); read back the names with `gh secret list --env <env>`. If the App cannot write environment secrets, give Shyden one copyable block instead.
- [ ] **Step 2: workerd probe (dev key, before the PR merges).** A scratch Worker in `.superpowers/sdd/88/probe/` imports `packages/mail` and Task 3's `sendMail` with a stand-in `DB`, run with `npx wrangler dev --local` and the dev settings in its own `.dev.vars` (git-ignored, deleted after). One request sends from `no-reply@dev.shytalk.app` to a Gmail and an Outlook inbox. Expected `{ok: true, messageId}`: this proves workerd sends the signed `date` header unchanged and Oracle accepts the signature and the narrowed policy (the spec's two unproven points).
- [ ] **Step 3: refusals measured.** With the same probe: the dev key sending as `no-reply@shytalk.app` to `ap-singapore-1`, and the dev key with a wrong fingerprint, each answer a failure; record the status, `code` and reason each produced, and fix Task 1's map in a red-first change if Oracle's answers differ from the generic table.
- [ ] **Step 4: headers (AC3, dev sender).** Read each received mail's headers in Chrome and save `Authentication-Results` (spf, dkim and dmarc each `pass`) as evidence on #88.
- [ ] **Step 5: dev deploys on the merge.** Read the deploy run: the five `secret put` lines succeeded.
- [ ] **Step 6 (Shyden): live secrets.** Shyden sets the five `production` environment secrets from `shytalk-mail-live.pem` (one copyable block). The live sender reaches prod only at the next release he approves.
- [ ] **Step 7 (live sender):** `no-reply@shytalk.app` has no caller until #133. Its Gmail and Outlook headers are read on #133's first live code, and #88 AC3's live half is ticked then. Until that read, #88 stays open (the proof rule).
- [ ] **Step 8:** two clean weeks of DMARC reports, then `p=reject` on both `_dmarc` records (a dated follow-up on #88). After the first month of live mail, read the bill (AC5).
