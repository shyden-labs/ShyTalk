# Email code at sign-up and for account recovery: design (shyden-labs/ShyTalk#133)

Status: written 2026-11-11 while Shyden slept, on his answers of 2026-11-10 (below). Reviewed to zero and self-approved under the global rule for plans and specs; every builder's call is marked so he can check it on waking.

## Intent

An email address is confirmed once, when an account is made, and used again only if the member loses every other way in. Everyday sign-in is a passkey or an authenticator (#134), so mail stays rare: Oracle Email Delivery's free 3,000 a month (#88) covers sign-ups and recoveries, not sign-ins.

## Shyden's decisions this design rests on

- 2026-11-08: email codes are only for sign-up and recovery; passkeys daily, TOTP as backup, recovery codes first, email + 24 h last.
- 2026-11-10: #133 is built before #134, so the website can create an account and the passkey proof on the phones follows the real journey.
- 2026-11-10: **the website signs up too**, by the same API and rules as the app (replaces spec 2026-10-24's decision 60, "accounts are created only in the app").
- 2026-11-10: telling open devices at once when a recovery starts is #169 (with the app). Here, the address is emailed at once and every signed-in device sees a "recovery pending" notice on its next request.

## Goals (the ticket's acceptance criteria)

1. `POST /api/app/email/start {email, purpose}` sends a 6-digit code, valid 10 minutes, single use; 5 wrong tries spend it; sends are rate-limited per address and per IP; known and unknown addresses get the same reply and status.
2. Sign-up: verifying the code confirms the address and creates the account, which signs in only after a passkey or TOTP is set up and the recovery codes are shown (#134). A Google or Apple account with the same verified email is linked, not duplicated.
3. Recovery: verifying the code starts a recovery. The address is emailed at once; every signed-in device sees the pending recovery on its next request. The new method works only after 24 hours; the owner cancels it from any signed-in device or from the email's link.
4. Every send, success and failure, and every recovery started, cancelled or completed, writes an audit row with no code, token or address in it.
5. A send failure answers an error the app shows as a failure, never "check your email".

## Non-goals

- Registering the passkey or TOTP, and issuing recovery codes: #134. This ticket hands #134 a one-purpose token (below).
- Telling open devices instantly: #169.
- Email sign-in. There is none; email is never an everyday way in.
- Age, country and parent consent (epic #14) and the consent step (#142). Sign-up here asks only for the address; both must be in the sign-up journey before it reaches production, which only Shyden releases. Until then sign-up is exercised on dev and test only (recorded for Shyden, 2026-11-11).

## Anti-goals

- No account discovery: no reply or status tells whether an address has an account. Timing is not equalised (builder's call, recorded): a recovery start for an unknown address sends nothing and answers sooner; equalising it would mean a fake send.
- No code, token or address in a log or an audit row.
- No session from an email code alone.
- Nothing on a clock: expired rows are removed by the requests that pass them, never by a cron.

## Constraints (measured 2026-11-11)

- Better Auth 1.7.17 on D1, `bearer` plugin; `/api/auth/*` is not routed (`workers/web/src/web.ts`), so Better Auth is reached only through ShyTalk's `/api/app/*` handlers.
- Better Auth's `email-otp` plugin creates a session as soon as its code is verified (`routes.mjs` lines 319-424), which breaks goal 2. ShyTalk's own module is used instead (builder's call).
- `sendMail` (`workers/web/src/mail.ts`) already writes `mail.sent` / `mail.failed` audit rows with no address, subject or body, and answers failures by reason without throwing.
- `SIGN_IN_LIMIT` (10 a minute per IP) is the only rate-limit binding; Workers rate-limit bindings allow periods of 10 or 60 seconds only, so per-address limits over an hour are counted in D1.
- Site locales: en, id, th, vi, zh.

## Design

### Tables (migration `0006_email_codes.sql`)

- `email_code`: `id`, `address_hash` (HMAC-SHA256 of the lower-cased, trimmed address under `BETTER_AUTH_SECRET`), `purpose` (`sign-up` | `recovery`), `code_hash` (HMAC-SHA256 of code + address_hash), `expires_at`, `wrong_tries`, `created_at`. A new start for the same address and purpose deletes the older row in the same batch (one live code at a time).
- `email_send`: `address_hash`, `at`. One row per start, known address or not; the per-address limits count these. Each start deletes this address's rows older than 24 hours.
- `one_time_token`: `token_hash` (SHA-256), `purpose` (`sign-up` | `recovery`), `user_id` (recovery), `email` (sign-up: the confirmed address, needed to create the user), `expires_at`, `used_at`. Tokens are 32 random bytes, base64url; only the hash is kept. Every start and verify deletes tokens past `expires_at` (an indexed delete), so a confirmed address from an abandoned sign-up is gone within one request after 30 minutes, without a clock.
- `account_recovery`: `id`, `user_id`, `started_at`, `completes_at` (started + 24 h), `cancel_token_hash`, `state` (`pending` | `cancelled` | `completed`), `ended_at`. One pending recovery per member (a partial unique index on `user_id` where `state = 'pending'`).

### Start: `POST /api/app/email/start {email, purpose, locale?}`

1. `SIGN_IN_LIMIT` keyed by IP; over it, 429 `slow_down`.
2. Body checked (an address of at most 254 characters with one `@`; purpose one of the two; locale one of the site's, default `en`); otherwise 400.
3. Per address (known or not, so the limit says nothing): 3 starts in 15 minutes, 10 in 24 hours, counted from `email_send`; over it, 429 `slow_down` (builder's call on the numbers).
4. What is mailed:
   - sign-up, no account: a code;
   - sign-up, an account exists (it always has a method, since users are created only when one is set up): no code; a notice that an account already exists, how to sign in, and how to recover (builder's call: the reply stays the same, and the owner learns someone tried);
   - recovery, an account: a code;
   - recovery, no account: nothing is sent, and the reply is the same.
5. Reply 202 `{sent: true}` for every case above when the send succeeded or none was due; 502 `mail_failed` when a due send failed (goal 5). Recovery for an unknown address never fails, which reveals nothing useful: failures are rare and not chosen by the caller.

### Verify: `POST /api/app/email/verify {email, purpose, code}`

- Same IP limit. Wrong code: `wrong_tries` + 1, 401 `code_refused`; the 5th wrong try deletes the row. No row, expired or spent: the same 401.
- Right code: the row is deleted first, and the request goes on only if that delete changed one row, so two verifies racing with the same code succeed once.
  - **sign-up:** a `sign-up` token (30 minutes) holding the confirmed address is answered: `{signUpToken}`. No user and no session are made yet. #134's setup endpoints accept this token in place of a session; finishing setup there creates the user (`emailVerified` 1) with its first method and recovery codes in one batch, then the session (builder's call: the account is created when it can first be signed into, so an abandoned sign-up leaves no account behind; goal 2's 'creates the account' happens at that moment, recorded for Shyden). If a user with that address appeared meanwhile (a Google sign-in), setup answers 409 `account_exists`.
  - **recovery:** an `account_recovery` row is started, a `recovery` token (valid until `completes_at` + 24 h) is answered with `completesAt`, the address is emailed a notice with the cancel link, and `recovery.start` is audited, all in one batch except the mail. If a recovery is already pending, a new verify answers a new `recovery` token for it and spends the old one; the 24-hour clock is never restarted and no second notice is sent (builder's call). A recovery not completed within 24 hours of `completes_at` lapses: it is read as not pending, its token is refused, and the next verify starts a new one (the row is marked `cancelled` with `ended_at` in that same batch, audited as `recovery.lapse`).

### Linking Google and Apple (goal 2)

`account.accountLinking` keeps Better Auth 1.7.17's defaults, written out so a test pins them: `enabled: true`, no `trustedProviders` (a trusted provider links even without `email_verified`, `oauth2/link-account.mjs` line 69, read 2026-11-11), and the existing user must have `emailVerified` true (the default gate). A Google or Apple sign-in whose ID token carries a verified email that matches an existing user links to it; an email sign-up for an address that already has a Google or Apple account mails the "account exists" notice and makes no new user. A Google ID token without `email_verified` true is not linked (pinned by a test). Tests pin both directions.

### Recovery: pending, cancel, complete

- Sessions are read with Better Auth's `getSession` on the request's bearer token or cookie; no session, 401.
- `GET /api/app/recovery` (session): `{pending: null}` or `{pending: {startedAt, completesAt}}`. The website's signed-in pages and the app call it on opening (the "next request" of goal 3).
- `POST /api/app/recovery/cancel` (session) or `POST /api/app/recovery/cancel {cancelToken}` (the email link's token, matched to `cancel_token_hash`): state → `cancelled`, `recovery.cancel` audited in the same batch (detail `{by: 'session' | 'email-link'}`), the device's `recovery` token spent. Answer 200 whether or not anything was pending (no discovery).
- Completion is #134's: its setup endpoints accept a `recovery` token only after `completes_at`; finishing setup there marks the row `completed`, ends every other session of the member, and audits `recovery.complete` in the same batch. Before `completes_at` they answer 403 `recovery_waiting` with `completesAt`.

### Website

- `/{locale}/sign-up/`: email → code → hands the sign-up token to #134's setup step (until #134 lands the page stops at "address confirmed").
- `/{locale}/recover/`: email → code → shows when the recovery completes.
- `/{locale}/recover/cancel/#token`: one button that cancels (the token is in the fragment, so it never reaches a log).
- The privacy policy (English and Indonesian, global rule) gains what this keeps: the confirmed address for up to 30 minutes before an account exists, and a keyed hash of an address for 24 hours per code sent. Other locales keep their 'English only' note.
- Copy for pages and emails is in all five locales, every line read back by Google Cloud Translation before commit (global rule).

### Audit

`recovery.start`, `recovery.cancel`, `recovery.lapse`, `recovery.complete` (#134 writes the last), each with subject `user:<id>` and no token. Sends are audited by `sendMail`. #134 writes `user.create` (subject the new user, detail `{via: 'email'}`) when sign-up setup finishes.

## Proof

- Unit (mocked D1 and mail): limits, every reply's sameness, code and token hashing, tries, expiry, supersession, the account-exists branch, linking options.
- Integration (CI, Miniflare D1): each endpoint's happy and refused paths; no session row after a sign-up verify; a concurrent double verify spends the code once.
- Smoke (CI, the mail stand-in) and real phones (OnePlus Chrome, iPhone Air Safari, against dev, the real test mailbox over IMAP): sign-up to "address confirmed", recovery start, cancel by the email link. The full sign-up journey to a passkey is proven under #134.

## Left to the builder

File layout, names, the pages' look (the existing `ui-document` style), email wording within the rules above.
