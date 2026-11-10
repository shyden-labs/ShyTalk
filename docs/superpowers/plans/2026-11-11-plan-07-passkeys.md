# Passkeys, authenticator app and recovery codes: implementation plan (plan 7)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native; review agents are refused by hook, so review is inline). Steps use `- [ ]`.

**Goal:** shyden-labs/ShyTalk#134's server API and website pages, on #133's tokens.

**Architecture:** Better Auth's passkey plugin, wrapped by ShyTalk handlers under `/api/app/passkey/*`; ShyTalk's own modules for the authenticator app (`totp.ts`), recovery codes (`recovery-codes.ts`), methods and devices (`methods.ts`); a token-or-session resolver shared by both setup paths (`setup-identity.ts`). Website pages are Astro components on the same API.

**Tech stack:** Workers, D1, Better Auth 1.7.17, `@better-auth/passkey` 1.7.17 (MIT, on `@simplewebauthn/server` 13, MIT), `@better-auth/utils/otp`, Astro, Vitest, Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-11-09-passkeys-totp-recovery-design.md` (reworked 2026-11-11, PR #172), on `docs/superpowers/specs/2026-11-11-email-code-sign-up-recovery-design.md`.

## Global constraints

- Sessions: `expiresIn` 100 years (3,155,760,000 s), `updateAge` 1 day (86,400 s), no `cookieCache`.
- Passkeys: `rpID` = host of `SITE_ORIGIN`; `origin` = `SITE_ORIGIN`; `userVerification: 'required'`; challenge 300 s.
- TOTP: RFC 6238, 6 digits, 30 s, steps −1/0/+1, `last_step` refuses reuse; secret AES-GCM under `TOTP_KEY` (Wrangler secret); 5 wrong codes lock 15 minutes; each attempt reserves a try first.
- Recovery codes: 10 per set, 16 Crockford base32 characters (80 bits) shown as 4 × 4, SHA-256 kept; a new set replaces the old in one batch with its audit row.
- 401 `sign_in_refused` for every refused sign-in, whatever the cause; 409 `last_method`; 403 `recovery_waiting` with `completesAt`.
- Audit: `method.add|remove|use`, `recovery_code.use`, `recovery_codes.new`, `user.create`, `user.create.undone`, `recovery.complete`, `session.start`, `session.end.*`; never a secret, code, token or challenge.
- Strict TDD and one mutation pass per new test; laptop runs unit, typecheck, lint, format only.
- Copy: five locales, read back by Google before commit.

## Review focus

1. A sign-up token used twice at one moment (two tabs): one member, not two. Integration test in Task 5.
2. A recovery token before `completes_at`: 403 with the time, nothing written. Unit test in Task 2.
3. Removing the last two methods at one moment: one succeeds, one gets 409. Integration test in Task 6.
4. A TOTP code reused within its 90-second window: refused. Unit test in Task 4.
5. A website session cookie and an app bearer token both reach `/api/app/sessions` and see the same member. Unit test in Task 6.

---

### Task 1: sessions never end by age

**Files:** modify `workers/web/src/auth/better-auth.ts`; test `tests/unit/app-sign-in.test.ts`.

- [ ] Tests: `auth.options.session` equals `{ expiresIn: 3_155_760_000, updateAge: 86_400 }` with no `cookieCache`; a session made, then the clock moved 8 days, still answers `appSession`.
- [ ] Red, set the options, green, mutation pass (7-day default restored goes red). Commit `feat: a session never ends through age or disuse (#134)`.

### Task 2: who is setting up (`setup-identity.ts`)

**Files:** create `workers/web/src/app/setup-identity.ts`; test `tests/unit/setup-identity.test.ts`.

**Produces:** `setupIdentity(request, env, sessionOf, token: string | null, now): Promise<SetupIdentity | Response>` where `SetupIdentity = { kind: 'session', userId } | { kind: 'sign-up', userId, email, tokenHash } | { kind: 'recovery', userId, recoveryId, tokenHash }`. A sign-up token's `user_id` is set once (`UPDATE ... WHERE user_id IS NULL`, then read back) so two setups from one token name one member.

- [ ] Tests: a session wins over a token; a live sign-up token answers its address and a stable user id (two calls, one id); an expired or used token answers 401 `sign_in_refused`; a recovery token before `completes_at` answers 403 `recovery_waiting` with the time; after it, the member; a sign-up token whose address now has a user answers 409 `account_exists`.
- [ ] Red, write, green, mutation pass. Commit.

### Task 3: recovery codes (`recovery-codes.ts`) and migration 0007

**Files:** create `workers/web/src/app/recovery-codes.ts`, `migrations/0007_passkeys.sql` (passkey table compiled by Better Auth's migration compiler with the passkey plugin added, then `sign_in_method` and `recovery_code` as the spec lists); install `@better-auth/passkey@1.7.17` exactly; tests `tests/unit/recovery-codes.test.ts`, extend `tests/unit/migrations.test.ts` only if its rules need it.

**Produces:** `newRecoveryCodes(): string[]` (10, `XXXX-XXXX-XXXX-XXXX`), `recoveryCodeHash(code)`, `replaceRecoveryCodes(env, userId, actor, now): Promise<{ statements, codes }>` (statements for the caller's batch), `useRecoveryCode(env, email, code, now)` with the reserve-a-try lock.

- [ ] Tests: 10 distinct codes of the pinned shape; dashes and case ignored on use; a used code refused; the 5-try lock; `replaceRecoveryCodes` deletes the old set and audits `recovery_codes.new` in the same statements; no plain code in any statement.
- [ ] Red, write, green, mutation pass. Commit.

### Task 4: authenticator app (`totp.ts`)

**Files:** create `workers/web/src/app/totp.ts`; route `/api/app/totp/setup`, `/api/app/totp/confirm`, `/api/app/sign-in/totp`; tests `tests/unit/totp.test.ts`, `tests/integration/totp.test.ts`.

- [ ] Tests: setup answers an `otpauth://totp/ShyTalk:<email>?secret=…&issuer=ShyTalk&digits=6&period=30` URI and stores only ciphertext; confirm with the current code makes it live (and, for a token setup, creates the user or completes the recovery, with recovery codes in the answer); sign-in accepts steps −1, 0, +1, refuses a step at or below `last_step`, refuses every other case with the same 401, locks after 5 wrong; each attempt reserves a try before comparing.
- [ ] Red, write, green, mutation pass. Commit.

### Task 5: passkey handlers

**Files:** modify `workers/web/src/auth/better-auth.ts` (plugin options), create `workers/web/src/app/passkey.ts`, route the four endpoints; tests `tests/unit/passkey.test.ts`, `tests/integration/passkey.test.ts`.

- [ ] Tests (WebAuthn responses made by a software authenticator in the test support folder): registration from a sign-up token creates one user, one passkey, a session and 10 codes; from a session adds a passkey; from a waiting recovery token, 403; sign-in with a fresh assertion starts a session and writes `session.start`; a replayed assertion gets 401; a failed audit write deletes the session; a passkey row that cannot be written undoes the user.
- [ ] Red, write, green, mutation pass. Commit.

### Task 6: methods and devices

**Files:** create `workers/web/src/app/methods.ts`; route `/api/app/sign-in-methods`, `/api/app/sign-in-methods/:kind/:id`, `/api/app/sessions`, `/api/app/sessions/:id`; tests `tests/unit/methods.test.ts`, `tests/integration/methods.test.ts`.

- [ ] Tests: the list; 409 `last_method` on the last method, Google and Apple counting; the conditional delete under two removals at once; sessions listed with this device marked; a revoke uses `handleSignOut`'s chain and the revoked bearer's next request gets 401.
- [ ] Red, write, green, mutation pass. Commit.

### Task 7: website pages, smoke and phones

**Files:** sign-up continuation, `/sign-in/`, `/account/` components and pages; copy in five locales; smoke and iPhone cases; tests `tests/unit/*-answers.test.ts` for any new status mapping.

- [ ] Smoke (CI, Chromium's virtual authenticator through CDP; the phones use their real biometric step): sign up → passkey → codes shown → signed in → sign out → sign in with the passkey → account page lists one passkey and this device.
- [ ] Copy read back; red in CI first, then pages; commit.

## As built, 2026-11-11 night (Tasks 1-6 done on `feat/134-passkeys`; Task 7 waits)

- Task 1: the cookie keeps Better Auth's 400-day ceiling (it refuses more); rows last 100 years through a session-create hook.
- Tasks 3-4: `sign_in_lock` on the address's keyed hash, lock doubling to 16 hours; `totp_pending` tied to its flow; a setup's token spent first, alone; a recovery removes the old passkeys and authenticator; `prepareSetup` / `finishSetup` with the method's own statements in the finish batch. Each from a security review of the commits.
- Task 5: `passkey-hooks.ts` (token hash as the plugin's context; a token only sets up its own member), `passkey.ts` (four routes, cookie pass-through, sign-up undone if its passkey is not written), `tests/support/webauthn.ts` (software authenticator), `types/webauthn-globals.d.ts`.
- Task 6: `methods.ts` (methods, devices, `POST /api/app/recovery-codes`).
- Sessions ShyTalk starts set Better Auth's signed cookie for the website (`sessionCookie`).
- Deploys put `TOTP_KEY`, failing by name without it: the dev, test and production GitHub environments each need a `TOTP_KEY` secret before the next deploy (production is Shyden's; dev and test can be set by the App or by him).
- Task 7: the joining journey (smoke and iPhone twin) is written and committed, red until the pages exist: it must be seen red in CI first, then the pages are written new. Its copy needs Google's read-back (from 15:00 WIB 2026-11-11).

## Proof before #134 is shut

CI green; the phone run on both phones against dev (real Face ID and fingerprint), totals per phone; every acceptance criterion ticked with its evidence.
