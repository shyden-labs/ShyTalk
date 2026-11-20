# Proof before changing how an account signs in (shyden-labs/ShyTalk#173)

## Intent

Sessions never end through age or disuse (#134 AC5), so a signed-in phone is a long-lived key. Someone holding a member's unlocked phone must not be able to add their own way in, remove the member's, make new recovery codes or sign the member's other devices out. Before any of those, ShyTalk asks for proof with a method the member already has. The member is told by email when a method is added or removed.

## Decided by Shyden

- Proof is an existing method: a passkey, a current authenticator code or a recovery code. A recent sign-in alone never counts (2026-11-16).
- One proof counts for **5 minutes, on that device's session only** (2026-11-20).
- The server keeps the proof against the session; nothing the client could copy carries it (approach A, 2026-11-20).
- A fresh Google or Apple confirmation of a linked account also counts as proof, so a member who signed up in the app with Google or Apple alone can still add a passkey or authenticator (2026-11-20).

## Goals

1. These five calls answer `403 {"error":"proof_needed"}` unless the calling session holds an unexpired proof:
   - adding a passkey (`POST /api/app/passkey/register/options` and `.../verify` with a session),
   - adding an authenticator (`POST /api/app/totp/setup` and `.../confirm` with a session),
   - `POST /api/app/recovery-codes`,
   - `DELETE /api/app/sign-in-methods/passkey/:id` and `/totp`,
   - `DELETE /api/app/sessions/:id` for a session other than the caller's own. Signing out yourself never needs proof.
2. A new proof route takes one of the four kinds of proof (passkey, authenticator code, recovery code, fresh Google or Apple ID token) and, on success, marks the calling session proven for 5 minutes.
3. A method added or removed mails the member's address: what kind, and when; never a secret, code or key.
4. Each proof given, each proof refused, each `proof_needed` refusal and each notice mailed is an audit row, with no secret in it.
5. The website's account page asks for proof when a call answers `proof_needed`, then repeats the call, so members can still do all five.

## Non-goals

- Sign-up and recovery flows are unchanged: they make the first method or replace them all, under their own email-code checks (#133).
- The phone app's screens (#11) are not built here; the API they will call is.
- No "remember this device" and no proof longer than 5 minutes.

## Anti-goals

- A proof that outlives its session, or that one session's proof unlocks another's.
- A recovery-code or authenticator proof that skips the wrong-try lock sign-in already has: proof must not become a way to guess codes.
- A mail or audit row carrying a code, a key or a passkey id in full.

## Approaches considered

- **A. A proof mark the server keeps for the session (chosen).** The proof route writes `proven_until`. Each guarded route reads it. Nothing travels to the client, and the mark ends with its session.
- **B. A signed 5-minute proof ticket the client sends.** No table, but a copyable token, and every client has to carry it. Rejected by Shyden.
- **C. Proof inside each guarded request.** Ruled out by the 5-minute window.

## Design

### Storage (migration `0012_session_proof.sql`)

`session_proof (session_id TEXT PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE, proven_until INTEGER NOT NULL, method TEXT NOT NULL)`. A separate table, not a column on Better Auth's `session` table, so the auth library's schema stays its own. It is still one row per session, as approach A says (builder's call; noted here). Ending a session removes its mark.

### Proof route

`POST /api/app/proof` with a session (401 `signed_out` without one):

- `{ "method": "totp", "code": "123456" }`: checked against the member's live authenticator with the same step rules as sign-in (no step used twice). Wrong tries share sign-in's per-account lock (`reserveTry` / `lockIfSpent`, kind `totp`).
- `{ "method": "recovery-code", "code": "AB12-..." }`: the member's own unused code, spent on success, as at sign-in; same lock (kind `recovery-code`).
- `POST /api/app/proof/passkey/options` then `POST /api/app/proof/passkey/verify`: a WebAuthn assertion limited to the member's own passkeys, with user verification required. The challenge is kept server-side, single-use, 5 minutes. Verified with `@simplewebauthn/server` directly (it becomes a direct dependency at the version `@better-auth/passkey` pins), because the plugin's sign-in verify makes a new session. The passkey's counter is updated as at sign-in.

- `{ "method": "google", "idToken": "..." }` or `{ "method": "apple", "idToken": "...", "nonce": "..." }`: verified exactly as app sign-in verifies it (`auth/id-token.ts`: issuer, audience, signature, Apple's nonce), and in addition its `sub` must be the account already linked to this member and its `iat` no more than 5 minutes old. A token for another account, or an old one, is refused. The app's button comes with #11; the website has no Google or Apple sign-in, so its panel does not offer it.

Success upserts `session_proof` with `proven_until = now + 300 000 ms` and answers `200 {"provenUntil": <ms>}`. Failure answers `403 {"error":"proof_refused"}`, or `429` with the lock time when locked, matching sign-in.

### Guard

One function, `requireProof(env, session, now)`, returns a `403 proof_needed` response or nothing. It is called first in each guarded handler, after the session check and before any change. A proof is not spent by use: several changes within the 5 minutes pass.

### Notices

`sendMail` to the member's address, in the locale the request names (`locale` in the body or query, defaulting to `en`, as `email/start` does). Subject and body name the method kind ("a passkey", "an authenticator app") and the time in UTC, and say what to do if it wasn't them (use recovery). New lines go in `apps/web/src/i18n` for every locale, Google read-back table first. A mail that fails to send is audited and does not undo the change (the change already passed proof); it is told to the member nowhere else.

### Audit

`proof.given` (detail: method kind), `proof.refused` (method kind, reason `wrong` / `locked`), `proof.needed` (the route's name), `notice.method_added` / `notice.method_removed` (kind, mailed yes/no). No code, key, challenge or full credential id.

### Website

`Account.astro`'s `call()` sees `proof_needed`, opens a "Confirm it's you" panel with one way per method the member has (passkey button, authenticator code box, recovery code box), sends the proof, then repeats the original call once. Copy in every locale, read back by Google.

## Tests (strict TDD; every red seen first)

- Unit: `requireProof` (no mark, expired at exactly 300 000 ms, another session's mark); each guarded route refuses before changing anything; the proof route's four kinds, including an ID token for another account or older than 5 minutes, wrong code, lock, spent recovery code, step reuse and a passkey of another member; notice text has no secret.
- Integration (CI, real D1): the mark is gone after sign-out (cascade); two sessions of one member do not share a mark; the full add-passkey-with-proof journey.
- Smoke: the account page's proof panel through real input, on every browser; the iPhone copy mirrors it (`iphone-cases.ts`).

## Left to the builder

- Exact copy wording (then Google read-back, then shown to Shyden as every translation is).
- Whether the proof route and the panel land in one PR or two (server first is fine: the account page then shows the refusal until the panel lands; it is dev only until release).
