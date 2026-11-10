# Email code at sign-up and for recovery: implementation plan (plan 6)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native; Shyden is asleep and review agents are refused by hook, so review is inline). Steps use `- [ ]`.

**Goal:** `POST /api/app/email/start|verify`, the recovery endpoints, and the website's sign-up and recovery pages, as the spec says.

**Architecture:** One module per concern under `workers/web/src/app/`: `email-code.ts` (pure crypto and code rules), `email-routes.ts` (start and verify), `recovery.ts` (pending, cancel, lapse). SQL is plain D1 statements written beside the code that runs them, as `closed-testing.ts` does. Pages are Astro components calling the API, as `ClosedTesting.astro` does.

**Tech stack:** Cloudflare Workers, D1, Better Auth 1.7.17, Astro, Vitest (unit with stand-ins; integration on Miniflare D1 in CI), Playwright smoke (CI) and the phone runner.

**Spec:** `docs/superpowers/specs/2026-11-11-email-code-sign-up-recovery-design.md`

## Global constraints

- Code: 6 digits, 10 minutes, single use, 5 wrong tries spend it. Tokens: 32 random bytes, base64url, SHA-256 kept. Sign-up token 30 minutes. Recovery completes 24 h after start; lapses 24 h after that.
- Per address: 3 starts in 15 minutes, 10 in 24 hours. Per IP: `SIGN_IN_LIMIT`.
- Replies: start 202 `{sent: true}` / 400 `bad_request` / 429 `slow_down` / 502 `mail_failed`; verify 200 / 400 / 401 `code_refused` / 429.
- No code, token or address in any audit row or log; audit rows in the same batch as the change they record.
- Strict TDD: each test runs red before its code; mutation-check each new test once.
- Laptop runs unit, typecheck, lint, format only; integration, smoke and phones run in CI or on the phones.
- Copy: en, id, th, vi, zh; every non-English line read back by `node scripts/i18n/google-read-back.ts <locale> <keys…>` before commit.

## Review focus

1. An address differing only in case or surrounding spaces is the same address (start and verify agree). Test in Task 1.
2. Two verifies racing with one code: exactly one succeeds. Integration test in Task 3.
3. A start for an address over its limit says 429 whether or not an account exists. Unit test in Task 2.
4. A cancel link opened twice, or after the recovery completed, answers 200 and changes nothing. Integration test in Task 4.
5. A body that is not JSON, or JSON that is not an object, gets 400 on every endpoint, never a 500. Unit tests in Tasks 2-4.

---

### Task 1: code, hash and token rules (`email-code.ts`)

**Files:** create `workers/web/src/app/email-code.ts`; test `tests/unit/email-code.test.ts`.

**Produces:**
- `normaliseAddress(raw: unknown): string | null`: trimmed, lower-cased; null unless a string ≤ 254 characters that `checkMessage` accepts as a recipient.
- `addressHash(secret: string, address: string): Promise<string>`: hex HMAC-SHA256.
- `codeHash(secret: string, addressHash: string, code: string): Promise<string>`.
- `newCode(random?: (bytes: Uint8Array) => Uint8Array): string`: 6 digits, uniform (rejection sampling on a 32-bit draw below 4,294,000,000).
- `newToken(): string` (32 bytes base64url) and `tokenHash(token: string): Promise<string>` (hex SHA-256).
- Constants `CODE_TTL_MS = 600_000`, `MAX_WRONG_TRIES = 5`, `SIGN_UP_TTL_MS = 1_800_000`, `RECOVERY_WAIT_MS = 86_400_000`, `RECOVERY_LAPSE_MS = 86_400_000`, `LIMIT_15_MIN = 3`, `LIMIT_24_H = 10`.

- [ ] Tests: `normaliseAddress(' A@Example.TEST ')` is `'a@example.test'`; 255-character, no-`@`, number and null inputs are null; two hashes of the same address under one secret match and under two secrets differ; `newCode` with a stand-in returning 4,294,967,295 then 7 answers `'000007'` (the high draw is rejected); 10,000 codes are all `/^\d{6}$/`; `newToken()` decodes to 32 bytes; `tokenHash` of `'abc'` is the known SHA-256 hex.
- [ ] Run `npx vitest run --config vitest.unit.config.ts tests/unit/email-code.test.ts`: red (module missing).
- [ ] Write the module; run: green. Mutate the rejection bound and the lower-casing once each; both tests go red; restore.
- [ ] Commit `feat: email-code rules (#133)`.

### Task 2: migration and `POST /api/app/email/start`

**Files:** create `migrations/0006_email_codes.sql`, `workers/web/src/app/email-routes.ts`, copy keys `email.*` in `apps/web/src/i18n/en.json`; modify `workers/web/src/app/router.ts`; tests `tests/unit/email-start.test.ts`, `tests/integration/email-code.test.ts`.

**Consumes:** Task 1; `sendMail(env, message)`; `SIGN_IN_LIMIT`; `t(locale, key)`.

**Produces:** `handleEmailStart(request: Request, env: EmailEnv, now?: () => number): Promise<Response>`; `EmailEnv = MailEnv & AuthEnv & { SIGN_IN_LIMIT: RateLimit }`; the tables `email_code`, `email_send`, `one_time_token`, `account_recovery` exactly as the spec lists them, with indexes on `email_code(address_hash, purpose)`, `email_send(address_hash, at)`, `one_time_token(expires_at)` and the partial unique index `account_recovery(user_id) WHERE state = 'pending'`.

- [ ] Unit tests (recording D1 stand-in, mail stand-in): 405 on GET; 429 when the IP limit says no; 400 for non-JSON, an array, a bad address, an unknown purpose; with 3 `email_send` rows in 15 minutes, 429 for a known and for an unknown address alike; sign-up for an unknown address mails one message whose text holds a 6-digit code and answers 202 `{sent: true}`; sign-up for a known address mails the account-exists notice with no 6-digit run in it and answers the same 202 body; recovery for an unknown address mails nothing and answers the same 202; recovery for a known address mails a code; a failed send answers 502 `mail_failed`; the batch that stores the code also deletes the older code for that address and purpose and writes the `email_send` row; no statement binds the plain address or code.
- [ ] Integration test: a start on Miniflare D1 leaves one `email_code` row and one `email_send` row; a second start leaves one `email_code` row; the migration applies on an empty database.
- [ ] Red, then write the migration, the handler and the route (`/api/app/email/start`, 503 `sign_in_unavailable` when `readyForSignIn` fails), English copy keys: `email.codeSubject`, `email.codeBody` (`{code}`, ten minutes), `email.existsSubject`, `email.existsBody`. Green; mutation pass on the limit and the same-reply branch.
- [ ] Commit `feat: email codes are sent for sign-up and recovery (#133)`.

### Task 3: `POST /api/app/email/verify`, sign-up token and recovery start

**Files:** modify `email-routes.ts`, `router.ts`, `en.json` (`email.recoverySubject`, `email.recoveryBody` with `{completesAt}` and `{cancelLink}`); tests `tests/unit/email-verify.test.ts`, extend `tests/integration/email-code.test.ts`.

**Produces:** `handleEmailVerify(request, env, auth, now?)`; answers sign-up `200 {signUpToken}`, recovery `200 {recoveryToken, completesAt}` (ISO 8601). `findRecoveryToken(db, token, now)` and `findSignUpToken(db, token, now)` returning the row or null, for #134.

- [ ] Unit tests: wrong code adds one try and answers 401 `code_refused`; the fifth wrong try deletes the row; an expired code and a missing row answer the same 401; a right code whose delete changed 0 rows answers 401; sign-up answers a token whose hash is stored with the address and a 30-minute expiry, and creates no user and no session; recovery for a member creates one pending row, mails the notice with a `/recover/cancel/#` link, audits `recovery.start` in the same batch, and answers `completesAt` = now + 24 h; a second recovery verify while pending answers a new token, spends the old one, keeps `completesAt` and mails nothing; a pending row past its lapse is marked `cancelled`, audited `recovery.lapse`, and a new one starts; expired tokens are deleted by each verify.
- [ ] Integration tests: two verifies with one code at once: one 200, one 401; after a sign-up verify, `session` and `user` counts are unchanged; a recovery verify writes `account_recovery`, `one_time_token` and one `recovery.start` audit row with no token in its detail.
- [ ] Red, write, green, mutation pass on the changed-rows check and the lapse.
- [ ] Commit `feat: an email code verifies a sign-up or starts a recovery (#133)`.

### Task 4: pending recovery and cancel (`recovery.ts`)

**Files:** create `workers/web/src/app/recovery.ts`; modify `router.ts`; tests `tests/unit/recovery.test.ts`, `tests/integration/recovery.test.ts`.

**Produces:** `handleRecoveryPending(request, env, auth, now?)` for `GET /api/app/recovery`; `handleRecoveryCancel(request, env, auth, now?)` for `POST /api/app/recovery/cancel` (session, or body `{cancelToken}`).

- [ ] Unit tests: no session on GET answers 401 `signed_out`; GET answers `{pending: null}` or `{pending: {startedAt, completesAt}}`; a lapsed row reads as null; cancel by session or by token marks the row `cancelled`, spends the recovery token and audits `recovery.cancel` with `{by}` in one batch; cancel with nothing pending, an unknown token, or no body and no session answers 200 `{ok: true}` and writes nothing; non-JSON body with no session answers 400.
- [ ] Integration: the cancel link used twice, and after the row completed, changes nothing the second time.
- [ ] Red, write, green, mutation pass. Commit `feat: a pending recovery is shown and can be cancelled (#133)`.

### Task 5: account linking pinned

**Files:** modify `workers/web/src/auth/better-auth.ts` (`account: { accountLinking: { enabled: true } }`); test `tests/unit/app-sign-in.test.ts`.

- [ ] Unit tests (memory adapter): a Google sign-in with `email_verified: true` for an address whose user has `emailVerified` true adds an `account` to that user and makes no second user; with `email_verified: false` it makes no link (Better Auth answers an error, mapped to 401 `sign_in_refused`); the options carry no `trustedProviders`.
- [ ] Red where the behaviour is not yet pinned (the options test), write, green. Commit `test: Google and Apple link only on a verified email (#133)`.

### Task 6: copy in five languages, pages, smoke and phone cases

**Files:** create `apps/web/src/components/SignUp.astro`, `Recover.astro`, `RecoverCancel.astro`, their `pages/` and `pages/[locale]/` entries, `apps/web/src/email/answers.ts` (status → message key); modify the five `i18n/*.json`, `read-back/*.md`, `tests/smoke/fixture.ts` (`mail()` also answers `bodyText`), `tests/smoke/site.spec.ts`, `tests/phones/iphone-cases.ts`; tests `tests/unit/email-answers.test.ts`.

- [ ] Unit test: `emailMessage(status)` maps 202 → `sent`, 400 → `invalid`, 429 → `tooMany`, 502 and 0 → `sendFailed`, 401 → `codeRefused`.
- [ ] Smoke (CI, English, extend the existing journey file per the one-journey rule): sign-up by real typing: address → code from the stand-in → "address confirmed"; recovery start for that address shows "check your email" text only after 202; the cancel link from the recovery mail, opened and pressed, answers "recovery cancelled". The iPhone twin gets the same titles and steps.
- [ ] Copy: write the English lines, then id, th, vi, zh; run the read-back for each locale with the new keys; fix any line whose English drifts; tables committed.
- [ ] Unit suites for i18n keys and copy guard pass; commit `feat: the website signs up and recovers by email code (#133)`.

### Task 7: privacy policy lines

**Files:** modify the privacy policy's English and Indonesian copy (wherever `privacy.astro` reads it); read-back table.

- [ ] Add the two retention lines from the spec in English and Indonesian; read back the Indonesian by Google. Shyden's own reading of the Indonesian is required (global rule) and is parked for him; #133 stays open until he has read it.
- [ ] Commit `docs: the privacy policy says what email codes keep (#133)`.

## As built (2026-11-11, recorded while executing)

- Task 2 carries every mail line in all five languages (the site's `t()` throws on a missing line); Task 6 carries the page lines. The non-English lines wait for Google's read-back: the shared 16,000-character day was spent when they were written (15,862 used at 00:17 WIB), and Google's day turns at 15:00 WIB.
- Start answers after a 3 s floor, as closed-testing does; verify reserves a try before comparing (a security review found guesses at one moment could pass the limit).
- `findSignUpToken` / `findRecoveryToken` are left to #134, which is their only reader.
- The smoke and iPhone cases cover sign-up to "address confirmed" and the recovery pages. The recovery mail journey needs a member, which only #134 creates, so it is proven there.
- Test mail helpers: `waitForAnyMail` and `codeIn` (tests/phones/test-mailbox.ts); the smoke `mailbox` gains `anyMail()`.

## Proof before #133 is shut

CI green on each PR (unit, integration, smoke, coverage, Sonar); the phone run on both phones against dev, totals printed per phone; Shyden's reading of the Indonesian privacy lines. Goal 2's last half (no session until a method exists) is proven under #134.
