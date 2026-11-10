# Passkeys, TOTP backup and recovery codes: design (shyden-labs/ShyTalk#134)

Status: written 2026-11-09; questions answered 2026-11-10 (end of file); reworked 2026-11-11 to build on #133 as built (docs/superpowers/specs/2026-11-11-email-code-sign-up-recovery-design.md). Reviewed to zero before the plan.

## Intent

Everyday sign-in to ShyTalk is free, quick and needs no email (Shyden, 2026-11-08). A member signs in with a passkey (Face ID or fingerprint). If their device cannot hold a passkey, they use an authenticator app instead (TOTP). One-time recovery codes are the first way back. Email recovery after a 24-hour wait (#133) is the last. A session, once started, lasts until someone ends it on purpose.

## Goals (the ticket's acceptance criteria)

1. Passkeys (WebAuthn): register, then sign in, on Android and iPhone. The server keeps only the public key. Each sign-in answers a fresh one-time challenge. A replayed or wrong answer gets 401.
2. TOTP (RFC 6238, 6 digits, 30 s) for members without a passkey. The secret is stored encrypted, a code already used is refused, and tries are rate-limited.
3. Ten one-time recovery codes, shown once and stored only hashed. Making a new set ends the old one.
4. A member lists and removes passkeys and the authenticator from any signed-in device. The last sign-in method cannot be removed without adding another first.
5. Sessions never end through age or disuse. They end only by sign-out, a revoke from another device, staff, or a completed recovery (#133).
6. A member sees every signed-in device and revokes any of them. A revoked device's next request gets 401.
7. Every method added, removed or used, every recovery code used, and every session ended writes an audit row with no secret in it.

## Non-goals

- Email codes and email recovery: #133.
- The staff TOTP gate: #61. It reuses this TOTP store (see below) and is not built here.
- The app's screens and the `.well-known` app files: shyden-labs/ShyTalk#166 under the app shell (epic #11). This ticket ships the server API and the website's passkey pages.
- Passwords. ShyTalk has none and this adds none.

## Anti-goals

- Never a secret in a log, an audit row or a response after setup: no TOTP seed, recovery code or challenge.
- No member is ever locked out by this ticket alone: the last-method rule (goal 4) holds on every path.

## Constraints (measured 2026-11-09)

- The Worker runs Better Auth 1.7.17 on D1 with the `bearer` plugin. Sign-in rows go to `audit` (append-only) after the session, and the session is deleted if that write fails (decision 222, `workers/web/src/app/sign-in.ts`).
- `@better-auth/passkey@1.7.17`: MIT, built on `@simplewebauthn/server` 13 (MIT). It supports `rpID`, a list of `origin`s, and registration without a session through `requireSession: false` and `resolveUser`.
- `/api/auth/*` is not routed (`workers/web/src/web.ts`): every Better Auth call goes through a ShyTalk handler under `/api/app/`.
- The passkey plugin keeps its WebAuthn challenge in a cookie (`advanced.webAuthnChallengeCookie`, default `better-auth-passkey`). The website keeps it; the app's bearer-token flow is #166's.
- #133 as built: `POST /api/app/email/verify` answers a 30-minute `signUpToken` (the confirmed address; no user exists yet) or a `recoveryToken` (a member, usable once `completes_at` has passed). Both live in `one_time_token`, kept as SHA-256.
- Better Auth's `two-factor` plugin is a SECOND step after another sign-in, and it stores backup codes plain or encrypted, never hashed (`types.d.mts`, `backup-codes/index.d.mts`). It cannot meet goal 2 (TOTP as a sign-in method in its own right) or goal 3 (hashed codes) as shipped.
- The app is React Native + Expo (spec 2026-10-24). On Android, a passkey made by the app reports an origin of `android:apk-key-hash:<base64url SHA-256 of the signing certificate>`, and the domain must publish `/.well-known/assetlinks.json` with `delegate_permission/common.get_login_creds`. On iOS, the domain must publish `/.well-known/apple-app-site-association` with `webcredentials.apps: ["<TeamID>.com.shyden.shytalk"]`. Neither value is in this repo.

## Design

### Passkeys: Better Auth's passkey plugin (builder's call, recorded)

- `rpID` is the environment's own host (`shytalk.app`, `dev.shytalk.app`, `test.shytalk.app`), so a dev passkey never works on prod.
- `origin` is `SITE_ORIGIN` alone. The Android app origins (`ANDROID_APK_ORIGINS`) come with shyden-labs/ShyTalk#166.
- `userVerification: "required"`: the phone's biometric step or PIN is asked every time.
- `registration.requireSession: false`, with `resolveUser({ctx, context})`: a request with a session registers for its member and ignores `context`; otherwise `context` must be a live `signUpToken` (answers the token's user id, made once and kept on its `one_time_token.user_id` the first time it is used for setup, so a passkey and an authenticator started from one token name one member; the confirmed address is the name; the user row does not exist yet) or a `recoveryToken` past its `completes_at` (answers that member). Anything else is refused with 401.
- `registration.afterVerification`, before the passkey row is written: for a sign-up, creates the user (`emailVerified` 1) and spends the token; for a recovery, marks it `completed`, spends the token and ends every session of the member (the recovering device has none yet). Each writes its audit rows (`user.create`, `recovery.complete`, `method.add`) in the same batch as its change.
- ShyTalk's handlers wrap the plugin's endpoints: `POST /api/app/passkey/register/options` and `/register/verify`, `POST /api/app/passkey/sign-in/options` and `/sign-in/verify`. They pass Better Auth's `Set-Cookie` and `set-auth-token` headers through, so the website keeps a cookie session and the app a bearer token. A registration that began from a token ends with a session and the first recovery codes in the answer; if the passkey row cannot be written after a sign-up's user was created, the handler deletes that user and audits `user.create.undone`, so no member is left without a method; a sign-in writes `session.start` after the session and deletes the session if that write fails (as `handleSignIn`).
- The challenge is stored server-side, used once and expires in 300 s (the plugin's behaviour, checked by a test: replaying an answer gets 401).
- The `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` files come with shyden-labs/ShyTalk#166, not here.

### TOTP and recovery codes: ShyTalk's own endpoints (builder's call, recorded)

The two-factor plugin cannot do it (see Constraints), so the Worker has its own small module on Better Auth's adapter and session creation.

- **Table `sign_in_method`:** `id`, `user_id`, `kind` (`totp`), `secret_enc` (AES-GCM, with a key derived from a new Wrangler secret `TOTP_KEY`, separate from `BETTER_AUTH_SECRET`), `last_step` (the last 30 s step accepted, so a used code is refused), `wrong_tries`, `locked_until`, `created_at`, `confirmed_at` (null while setup is pending; a pending row is replaced by the next setup and never signs in). One TOTP per member.
- **Table `recovery_code`:** `user_id`, `set_id`, `hash` (SHA-256 of a 16-character Crockford base32 code, 80 random bits, shown as four groups of four; at 80 bits a slow hash adds nothing), `used_at`. A new set deletes the old set's rows in the same batch as its audit row.
- **Setup (`POST /api/app/totp/setup`, a session, or a `signUpToken` or ready `recoveryToken` as for passkeys):** answers the `otpauth://` URI once; a token's setup is kept against the token's user id (as for passkeys), and its confirm creates the user (sign-up) or completes the recovery exactly as the passkey path does. It stays pending until `POST /api/app/totp/confirm {code}` proves the app holds it. Then it is live, and the first setup of any method also issues the recovery codes.
- **Sign-in (`POST /api/app/sign-in/totp {email, code}`):** the previous, current and next steps are accepted, and a step at or below `last_step` is refused. Unknown email, no TOTP, wrong code: the same 401 `sign_in_refused` (no account discovery). Limits: the existing `SIGN_IN_LIMIT` per IP, plus 5 wrong codes per account lock TOTP sign-in for 15 minutes (the same numbers as #61). Each attempt reserves a try with one conditional UPDATE before its code is compared, as #133's verify does, so attempts at one moment cannot pass the limit together. The email identifies the account (builder's call: every account has a verified email, from #133 or from Google/Apple).
- **Recovery code (`POST /api/app/sign-in/recovery-code {email, code}`):** marks the code used in the same batch as the session's audit row, then starts a session. The answer tells the app how many codes are left. It has the same refusals and limits as TOTP sign-in, with its own 5-wrong-tries lock.

### Methods and devices

- `GET /api/app/sign-in-methods` lists passkeys (name and created: the plugin's `passkey` table keeps no last-used time, read 2026-11-11, so none is shown; builder's call), whether TOTP is on, and recovery codes left.
- `DELETE` on a passkey or the TOTP answers 409 `last_method` when it would leave no passkey and no TOTP. The check and the delete are one conditional DELETE (it removes the row only while another method remains), so two removals at one moment cannot both pass it. Google and Apple links count as methods. Recovery codes do not count: they are a way back, not a method.
- `GET /api/app/sessions` lists the member's sessions (device name from the user agent, created, last seen, which one is this device). `DELETE /api/app/sessions/:id` ends one using the same attempt, success and failure chain as sign-out (`handleSignOut`). The revoked device's next request gets 401 because its row is gone (no session cache is configured).

### Sessions never expire through age (builder's call, recorded)

Better Auth needs an `expiresAt`. Set `session.expiresIn` to 100 years and `session.updateAge` to 1 day, and keep `cookieCache` off. A test pins both values and pins that a session left unused for 8 simulated days still answers. Ends happen only through the paths in goal 5.

Measured limit: Better Auth also uses `expiresIn` as the website cookie's `Max-Age`, and browsers cap a cookie at 400 days (Chrome). The app's bearer token has no such cap. A website session left unused for over 400 days therefore ends in the browser, though its server row lives on. Goal 5 is about the app, so this is recorded and not worked around.

Passkey challenges last 300 s (`MAX_AGE_IN_SECONDS` in the plugin, read 2026-11-09).

### Audit

Actions: `method.add`, `method.remove`, `method.use` (detail: kind and passkey id; never the code), `recovery_code.use` (detail: codes left), `recovery_codes.new`, `session.start`, and `session.end.*` (existing). A sign-in whose audit row fails is undone, as in `handleSignIn`.

### Website

- `/sign-up/` continues after "address confirmed" (#133) with "Set up a passkey" (and "Use an authenticator app instead"), then shows the recovery codes once, then the member is signed in.
- `/sign-in/`: "Sign in with a passkey", with the authenticator app and a recovery code as the other ways in.
- `/account/`: the member's sign-in methods and devices (goals 4 and 6) and any pending recovery (#133).
- `/recover/` (#133) continues on the device that holds the `recoveryToken`: once `completes_at` has passed, the same set-up step as sign-up.

### Migration

`0007_passkeys.sql`: the plugin's `passkey` table, generated by Better Auth's own migration compiler on the options in `workers/web/src/auth/better-auth.ts`, as `0003_auth.sql` was, plus `sign_in_method` and `recovery_code`.

## Proof

- Unit: everything above with mocks (TOTP steps, the code clash, the last-method rule, hashing, the challenge used once).
- Integration (CI, real D1 via Miniflare): every endpoint's happy and refused paths.
- Real phones: a passkey registered and used on the OnePlus (Chrome) and the iPhone Air (Safari) against `dev.shytalk.app`, through the website's own passkey page, by real touches. The app's own passkey proof is shyden-labs/ShyTalk#166.

## Left to the builder

Names, file layout, the website page's look (it follows the existing `ui-document` style), the TOTP library (`@better-auth/utils/otp`, already installed with Better Auth, preferred over a new dependency).

## Questions for Shyden (parked 2026-11-09, answered 2026-11-10)

1. **Phone proof of goal 1: answered.** Shyden, 2026-11-10: ship the server and the website's passkey page now and prove passkeys on both phones' browsers against dev (the phones are free in the evening). The in-app proof is shyden-labs/ShyTalk#166 under epic #11.
2. **Android and iOS identity values** (the Play app-signing certificate's SHA-256 and the Apple Team ID): moved to shyden-labs/ShyTalk#166, the only ticket that needs them.
