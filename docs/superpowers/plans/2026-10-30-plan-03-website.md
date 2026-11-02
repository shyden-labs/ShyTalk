# Plan 3 of 12: the ShyTalk website — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, as plans 1 and 2 ran, decision 98) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** shytalk.app becomes a working five-language public site with a lawful closed-testing list (release 3a), then gains passwordless accounts made by hand, the Owner's permissions and titles, the applicant pipeline and an append-only audit trail (release 3b).

**Architecture:** One Astro static site (one pre-built page per language) served as Workers static assets by one front-door Worker, which also answers `/api/*` from the same Worker with D1 for data and Brevo for email. Better Auth carries sign-in (email code, then TOTP for staff). PROD holds applicants; TEST holds testers' accounts and receives invites from PROD through one narrow endpoint.

**Tech Stack:** Astro 7.3.5 (`output: 'static'`, no adapter), @astrojs/svelte 9, plain CSS, Cloudflare Workers + D1 + R2 (Free plan), Better Auth (email OTP + two-factor plugins), Brevo free tier, Vitest (unit on the laptop; `@cloudflare/vitest-pool-workers` integration in CI), Playwright (CI), Google Cloud Translation (read-back only).

**Spec:** [`../specs/2026-10-30-plan-03-website-design.md`](../specs/2026-10-30-plan-03-website-design.md) (approved, decision 211), Home words `home-words-draft-2026-10-30.md` (a private working file, not in this repository) (approved English, decision 212), legal checks `legal-and-token-check-2026-10-30.md` (a private working file, not in this repository), environments in [`../specs/2026-10-24-shytalk-rewrite-design.md`](../specs/2026-10-24-shytalk-rewrite-design.md) §4.17.

**Review status:** self-reviewed on paper 2026-10-31. The plan-review passes that RUN its code wait for plan 2's repo (global rule); until then this plan is not self-approved.

## Global Constraints

- **Starts after plan 2** closes: the repo `shyden-labs/ShyTalk`, its board, the doors, `environments.json`, the GitHub environments `dev`/`test`/`production` and `requireDoorSecret()`/`assertEnvironmentMarkers()` from `packages/environment/` all exist. Every Worker here calls both on every request that arrives through a door.
- **Versions:** Astro 7.3.5 and @astrojs/svelte 9 exactly as Yawelo Idle pins them; read Yawelo's `package.json` at a recorded SHA (`git rev-parse` to `.superpowers/sdd/REWRITE/yawelo-sha`) in Task 1 and pin the same, per the version-alignment rule. Node as plan 2 pins it.
- **Languages:** `en` (unprefixed), `id`, `th`, `vi`, `zh` (Simplified: the old app's `values-zh` is Simplified, measured 2026-10-30, `后退`). Google target codes `id`, `th`, `vi`, `zh-CN`.
- **Every translated line** is written by me and read back by Google Cloud Translation (Task 2's client) before it is shown to Shyden or committed; Shyden sees a per-line writer/reader table. English governs legal text (decision 171).
- **No dating drift:** no "partner", "match", "date", "dating", "couple", "soulmate", "meet someone" in any language's copy; Task 3's test pins the English and the read-backs.
- **Public copy never says "rebuild"** (memory, Shyden 2026-10-30): the app is "being built".
- **Every state-changing action writes one audit row** (from Task 8 on): who, action, whom, when, environment. No route changes data without it.
- **Same answer for known and unknown emails** on every email-taking endpoint, in the same time class (OWASP).
- **CSP:** `default-src 'self'`; no inline script or style, no `data:`; `Referrer-Policy: no-referrer` on invite pages, `strict-origin-when-cross-origin` elsewhere.
- **Nothing on a clock.** Expiry is by timestamp, cleaned on the next write.
- **Laptop runs** unit, typecheck, lint, format; integration, e2e and browser journeys are CI's. A unit test reaches no D1, network or process: D1, fetch and Brevo are stood in.
- **Workflow:** one board story per task, one branch per story from fresh `origin/develop`, squash-merge on green `headRefOid`, `Refs #N` only. PROD deploys need Shyden's approval in the `production` environment.
- **Accessibility:** WCAG 2.2 AA (decision 87); Playwright + axe in CI on every page in every language.

## Review Focus

1. **The same person applies twice, or with different case or spaces.** Emails are trimmed and lower-cased before any lookup; a second apply re-sends the confirm mail at most once per 10 minutes and the page answers identically. Test in Task 5.
2. **A link or code used twice at once** (two tabs, a double click). Every single-use token is consumed by one conditional `UPDATE … WHERE used_at IS NULL` and acts only when it changed exactly one row. Tests in Tasks 5, 9, 12.
3. **Brevo is down or refuses.** The page never says "check your email" when no mail left: it says sending failed, try later, the same for every address, and the row is not kept as if mailed. Test in Task 5 (memory "failing never shows success").
4. **A language missing a line.** The build fails naming the key and language; nothing falls back to English silently. Test in Task 1.
5. **The Owner's phone clock is off by a step, or the Owner is rate-limited out.** TOTP accepts the previous and next 30 s step; the Owner's recovery codes bypass the TOTP rate limit but are audited. Test in Task 10.

---

## Release 3a: the public site

### Task 1: Site skeleton, front door and languages (estimate 5)

**Files:** `apps/web/` (Astro: `astro.config.mjs`, `src/layouts/Base.astro`, `src/components/{Menu,Footer}.astro`, `src/pages/[...]`, `src/i18n/{en,id,th,vi,zh}.json`, `src/i18n/t.ts`, `public/styles/site.css`); `workers/web/` (`src/index.ts`, `wrangler.jsonc` with `dev`, `test`, `production`); `tests/unit/web-front-door.test.ts`, `tests/unit/i18n-keys.test.ts`; `environments.json` gains the web Worker's ids.

**Interfaces:** Produces `t(locale: Locale, key: string): string` (throws on a missing key), `type Locale = 'en'|'id'|'th'|'vi'|'zh'`, `LOCALES`, `localePath(locale, path)`; the Worker's `fetch(req, env)` routing `/api/*` to `handleApi(req, env): Promise<Response>` (a 404 JSON stub here) and everything else to `env.ASSETS`.

- [ ] **Step 1:** Read Yawelo's `astro.config.mjs`, `wrangler.jsonc` and front-door Worker at `yawelo-sha`; copy the pattern (not its routes, cron or game), citing `shyden-labs/yawelo-idle#332` for `build.format: 'preserve'` (decision 201).
- [ ] **Step 2 (red):** `i18n-keys.test.ts`: every key in `en.json` exists, non-empty, in each other locale, and no locale has a key English lacks; one test per locale. `t('th','missing')` throws naming key and locale. Front door: `/api/x` reaches `handleApi`; `/`, `/id/`, `/roadmap` reach `ASSETS`; every response carries the CSP and `X-Content-Type-Options: nosniff`; a request through a door without the secret gets 403 (via `requireDoorSecret`).
- [ ] **Step 3:** Build it: `i18n.prefixDefaultLocale: false`, `build.format: 'preserve'`, `inlineStylesheets: 'never'`, `vite.build.assetsInlineLimit: 0`; `run_worker_first: true`, `not_found_handling: '404-page'`; a 404 page per language. Menu: Home, Closed testing (Roadmap and Sign in hidden by a config flag each, `SHOW_ROADMAP`, `SHOW_SIGN_IN`, both `false`). Footer: Terms, Privacy, Community guidelines, `support@shytalk.app`. Placeholder English only in this task.
- [ ] **Step 4:** Unit, typecheck, lint, format green. CI Playwright smoke: each language's home and 404 return 200/404 with the right `lang` attribute and no CSP console error. PR, green, merge; DEV deploys and answers at `dev.shytalk.app`.

### Task 2: The translation read-back client (estimate 3)

**Files:** `scripts/i18n/read-back.ts` (decisions), `scripts/i18n/google-read-back.ts` (CLI), `tests/unit/i18n-read-back.test.ts`.

**Interfaces:** Produces `DAILY_CHARACTERS = 16000`, `quotaDay(now: Date): string` (the Google day, midnight America/Los_Angeles, `YYYY-MM-DD`), `charactersLeft(ledger: Record<string, number>, day: string): number`, `toGoogleHtml(line: string): string` (each `{slot}` wrapped in `<span translate="no">`), `fromGoogleHtml(html: string): string` (entities decoded, spans removed). CLI `node scripts/i18n/google-read-back.ts <locale> [keys…]` reads `apps/web/src/i18n/<locale>.json`, sends to English, writes `.superpowers/sdd/plan-03/read-back-<locale>.md` (key | English source | my line | Google's English), and updates `~/.config/shyden/google-translate-ledger.json`. Key from `~/.config/shyden/google-translate.env`.

- [ ] **Step 1 (red, everything stood in):** `quotaDay` at 07:59Z and 08:00Z in winter and 06:59Z/07:00Z in summer; `charactersLeft` 16000 for a new day, 0 when spent; a batch that would cross 16,000 is refused before sending, naming the characters it needed; a 403 quota answer writes the day as spent (16000) and exits non-zero; `{name}` survives the round trip; `&#39;` decodes; a failed send never writes a read-back row.
- [ ] **Step 2:** Implement; port the decisions of shyden.co.uk's `src/lib/i18n/read-back.ts` by reading it (read only; that repo is another project's) and cite it as `shyden-labs/shyden.co.uk` in a comment.
- [ ] **Step 3:** Unit green; one real run on Task 1's placeholder lines shows the ledger moving by the characters sent. PR, merge.

### Task 3: Home page in five languages (estimate 3)

`blocked_by:` Tasks 1, 2.

**Files:** `apps/web/src/pages/index.astro` (and per-locale), `apps/web/src/components/PromoVideo.astro` (renders nothing unless `PROMO_VIDEO_MP4` is set), `apps/web/src/i18n/*.json`, `tests/unit/copy-guard.test.ts`.

- [ ] **Step 1 (red):** `copy-guard.test.ts`: the English lines and every committed Google read-back contain none of the dating words in Global Constraints, nor "rebuild"/"rebuilt"/"relaunch"; one test per locale. Home renders the approved English exactly (the five headings and two buttons from decision 212's file); "See the roadmap" absent while `SHOW_ROADMAP` is false.
- [ ] **Step 2:** Put the approved English in `en.json`. Write `id`, `th`, `vi`, `zh`; run Task 2's CLI per locale.
- [ ] **Step 3 (Shyden):** Send him the four writer/reader tables (key, English, my line, Google's English, my note where they differ). Fix what he marks; re-read-back each changed line; re-confirm.
- [ ] **Step 4:** Commit only approved lines. CI journey: each language's home shows its heading with `toBeVisible()` + `toHaveText()`, axe clean. PR, merge.

### Task 4: Promo video (estimate 3) — filed now, starts only when a video file exists

`blocked_by:` the video (decision 209, Shyden's); the mainland-China reach check below.

- [ ] **Step 1:** Measure whether `media.shytalk.app` (custom-domain R2) loads from mainland China (a third-party test from Beijing and Shanghai, results with times in `.superpowers/sdd/plan-03/china-reach.md`). A failure goes to Shyden before anything ships.
- [ ] **Step 2 (Shyden):** R2 buckets in PROD and Non-Prod, custom domains `media.shytalk.app` / `media.dev.shytalk.app`, never `r2.dev`; WAF rule serving media only when `Sec-Fetch-Site` is `same-origin`/`same-site`; `Cross-Origin-Resource-Policy: same-site`. He uploads MP4, WebM and poster by hand.
- [ ] **Step 3 (red):** `PromoVideo` renders `<video muted loop playsinline controls preload="metadata" poster aria-label>` with MP4 `<source>` before WebM; `public/scripts/promo-autoplay.js` does not call `play()` under `prefers-reduced-motion: reduce`, and leaves controls up when `play()` rejects. CI check downloads each media file, compares sha256 with git, and asks a `Range: bytes=0-1` request for 206.
- [ ] **Step 4:** Set `PROMO_VIDEO_MP4`; PR, merge; PROD with release 3a's next deploy.

### Task 5: Closed-testing form (estimate 8)

`blocked_by:` Task 1; Brevo account and shytalk.app sender records (Shyden).

**Files:** `migrations/0001_applicants.sql`; `workers/web/src/api/closed-testing.ts`; `workers/web/src/email/brevo.ts`; `apps/web/src/pages/closed-testing.astro` + `src/components/ApplyForm.svelte`; `tests/unit/closed-testing.test.ts`, `tests/unit/brevo.test.ts`; `tests/integration/closed-testing.test.ts`.

**Interfaces:** Table `applicants(email TEXT PRIMARY KEY, locale TEXT NOT NULL, applied_at INTEGER NOT NULL, confirmed_at INTEGER, confirm_hash TEXT, confirm_sent_at INTEGER, status TEXT NOT NULL DEFAULT 'applied')`. `POST /api/closed-testing {email, adult: true, locale}` → `202 {state:'sent'}` or `503 {state:'send_failed'}` or `400 {state:'invalid'}`. `GET /api/closed-testing/confirm?t=` → redirect to `/<locale>/closed-testing/confirmed` or `/…/link-expired`. Produces `sendMail(env, {to, template, locale, params}): Promise<void>` (throws on any non-2xx) and `hashToken(raw: string): Promise<string>` (SHA-256 hex), `newToken(): string` (32 random bytes, base64url).

- [ ] **Step 1 (red, D1 and Brevo stood in):** invalid email or `adult` not `true` → 400, nothing stored; new address → row, one mail, 202; `" Ann@X.com "` and `ann@x.com` are one row; a second apply within 10 minutes sends nothing and still answers 202; an already-confirmed address answers 202 and sends nothing; Brevo throws → 503 and the row's `confirm_sent_at` stays null; confirm with a good token sets `confirmed_at` once, a second use goes to link-expired; a token older than 48 h goes to link-expired; any write deletes rows with `confirmed_at IS NULL AND applied_at < now-48h`; only the hash is stored. Integration (CI): the same against real D1, plus 20 concurrent confirms of one token change one row.
- [ ] **Step 2:** Rate limit with the Workers rate-limiting binding (per IP, 5 per minute; 429 with the same body for everyone); read Cloudflare's docs that day for its Free-plan terms and record them.
- [ ] **Step 3:** The page shows, before the button, the four statements of design §3 item 2 (not access; may be asked for more; safe-list support@shytalk.app; removed if not selected; kept only until closed testing ends) in all five languages through Tasks 2-3's read-back loop; the confirm mail too.
- [ ] **Step 4:** Unit green; PR, green (integration, and a CI journey with Brevo replaced by a local HTTP stub that captures the mail: apply, follow the captured link, see "confirmed"), merge; DEV check by hand with a real address of Shyden's.
- [ ] **Step 5:** `docs/runbooks/applicant-requests.md`: the two `wrangler d1 execute` commands (through the `production` environment) Shyden uses to answer "do you hold my email?" and to delete it (design §3 item 5; by hand until 3b).

### Task 6: Legal pages (estimate 5)

`blocked_by:` Task 5 (the policy describes its fields).

**Files:** `apps/web/src/pages/{privacy,terms,guidelines}.astro` + locales; `apps/web/src/content/legal/<doc>.<locale>.md`.

- [ ] **Step 1:** Write the English of all three from design §3 "Legal pages" and the legal check file: who (Shyden Labs, Indonesia), what the form holds, why, how long, rights (access, copy, deletion, withdrawal, complaint; UU 27/2022 Pasal 7-9 and GDPR Art. 15, 17), staff access under audit, contact support@. The guidelines carry the mission and the not-a-dating-app rule in plain words. Each page names its version date; non-English pages say English governs.
- [ ] **Step 2 (Shyden):** he reads every English line; then the four translations go through the read-back table as in Task 3. Legal review is his call; ask once with `AskUserQuestion`.
- [ ] **Step 3:** Copy guard covers these files; journeys check each page in each language; PR, merge.

### Task 7: Release 3a to PROD (estimate 2)

`blocked_by:` Tasks 3, 5, 6; Zoho mailbox `support@shytalk.app` live (Shyden).

- [ ] **Step 1:** `release/3a` cut from `develop`; TEST deploy; the journey gauntlet runs once (last gate).
- [ ] **Step 2 (Shyden):** approve the `production` deploy; PROD D1 migration through the same environment. Read back: every page in every language 200, 404 pages 404, CSP header present, a real apply-and-confirm by Shyden lands one row.
- [ ] **Step 3:** One message to shyden.co.uk's session asking it to redirect `shytalk.shyden.co.uk/*` to `https://shytalk.app/` (decision 170); read back a 301 once it reports done.
- [ ] **Step 4:** Merge `release/3a` to `main` (Shyden), back to `develop`.

## Release 3b: accounts

### Task 8: The audit trail (estimate 3)

**Files:** `migrations/0002_audit.sql`; `workers/web/src/audit.ts`; `tests/unit/audit.test.ts`; `tests/integration/audit.test.ts`.

**Interfaces:** Table `audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT, detail TEXT, environment TEXT NOT NULL)` with triggers `BEFORE UPDATE`/`BEFORE DELETE … RAISE(ABORT,'audit is append-only')`. Produces `audit(env, {actor, action, subject?, detail?}): D1PreparedStatement` so callers batch it with their own write (`env.DB.batch([write, audit(...)])`): both land or neither.

- [ ] **Step 1 (red):** unit: the statement binds the environment from `env.ENVIRONMENT_NAME`; `detail` never contains a key named `code`, `token`, `secret` or `password` (refused with a thrown error). Integration (CI): an UPDATE and a DELETE on `audit` both fail; a batch whose first write fails leaves no audit row.
- [ ] **Step 2:** Implement; Task 5's routes switch to batching their writes with an audit row (actor `public`). PR, merge.

### Task 9: Email-code sign-in (estimate 5)

`blocked_by:` Task 8.

**Files:** `workers/web/src/auth/better-auth.ts`; `migrations/0003_auth.sql` (Better Auth's tables, generated by its CLI, committed); `apps/web/src/pages/sign-in.astro` + `SignIn.svelte`; tests `tests/unit/auth-sign-in.test.ts`, `tests/integration/auth-sign-in.test.ts`.

**Interfaces:** Produces `getAuth(env): BetterAuth` and `requireSession(req, env): Promise<Session>` (throws a 401 Response), `Session = {userId, email, isOwner, permissions: Permission[], totpVerified: boolean}`.

- [ ] **Step 1:** Read Better Auth's docs that day for the D1 adapter, the email-OTP plugin and the two-factor plugin; record the version and anything differing from this task in the PR body. Pin it exactly.
- [ ] **Step 2 (red):** sign-up through the plugin is disabled (an unknown email gets the same reply and no account, decisions 60, 148); a code is 6 digits, valid 10 minutes, single use, 5 wrong tries spend it; sending is rate-limited per address and per IP; the reply text and status are the same for known and unknown addresses; each send, success and failure writes an audit row without the code.
- [ ] **Step 3:** Implement; sign-in page in five languages through the read-back loop; `SHOW_SIGN_IN` true on DEV only.
- [ ] **Step 4:** PR, green, merge.

### Task 10: TOTP, recovery codes, staff gate (estimate 5)

`blocked_by:` Task 9.

- [ ] **Step 1 (red):** a session holding any permission, or the Owner's, has `totpVerified: false` until a TOTP code is accepted in that session; every staff route answers 403 `totp_required` before that, and `totp_setup_required` when no TOTP is enrolled; a code works once (the same code twice in its window: second refused); previous and next 30 s steps accepted; 5 wrong codes lock TOTP for 15 minutes; the seed is stored encrypted (read from D1 in the integration test: not the base32 seed); the Owner gets 10 recovery codes, each single use, each use audited and counted, and a recovery code still works while TOTP is locked; enrol, verify, failure and recovery each write an audit row.
- [ ] **Step 2:** Implement with the two-factor plugin; enrol page shows the QR as an SVG built in the Worker (no `data:` URI), and the recovery codes once with a "printed them" checkbox.
- [ ] **Step 3:** PR, merge. Tell Shyden, in the release notes for 3b: losing both TOTP and the recovery codes has no way back (decision 156).

### Task 11: Owner, permissions, titles (estimate 5)

`blocked_by:` Task 10.

**Files:** `migrations/0004_permissions.sql`; `workers/web/src/staff/{permissions,titles}.ts`; `apps/web/src/pages/staff/{people,titles}.astro` + islands; tests.

**Interfaces:** `type Permission = 'applicants.manage'|'invites.manage'|'titles.manage'|'audit.read'`; `OWNER_EMAIL` is configuration per environment (Shyden's address), never a row anyone can change. `requirePermission(session, p): void` (Owner passes all). Tables `permissions(user_id, permission, granted_at, granted_by)`, `titles(id, name UNIQUE)`, `user_titles(user_id, title_id, shown INTEGER)`.

- [ ] **Step 1 (red):** each route refuses without its permission and with `totpVerified: false`; only the Owner grants or removes permissions; the Owner cannot lose Owner; Member is implied and never stored; granting `audit.read` (the one sensitive permission in 3b) asks the Owner's TOTP again and mails the person; titles: create, rename, delete (deleting removes it from everyone), give any number, shown/hidden per person; a title changes no permission (test: a user with every title has no permission); every change audited.
- [ ] **Step 2:** Implement; staff pages in five languages via the read-back loop. PR, merge.

### Task 12: Invites (estimate 5)

`blocked_by:` Task 11.

**Interfaces:** Table `invites(id, email, token_hash, permissions TEXT, titles TEXT, created_by, created_at, expires_at, used_at, cancelled_at)`. `POST /api/staff/invites` (needs `invites.manage`), `POST /api/staff/invites/:id/{resend,cancel}`, `GET /invite?t=` (page), `POST /api/invite/accept {t}`. Link built from `env.PUBLIC_BASE_URL`, never the Host header. Reuses `newToken()`/`hashToken()` from Task 5.

- [ ] **Step 1 (red):** token is 32 bytes, only its hash stored; 7 days; accept needs the token AND a fresh email code for that address; the account opens on accept, ticked permissions apply then and staff ones stay gated by TOTP (Task 10); expired, used or cancelled → the same "link no longer works" page; resend issues a new token and kills the old; 20 concurrent accepts create one account; a Host header of `evil.example` changes nothing in the mail; the invite page sends `Referrer-Policy: no-referrer`; every step audited.
- [ ] **Step 2:** Implement; pages and mail in five languages via the read-back loop. PR, merge.

### Task 13: Own account (estimate 5)

`blocked_by:` Task 12.

- [ ] **Step 1 (red):** a member sees and edits own name (1-50 chars), photo (JPEG/PNG/WebP checked by magic bytes, ≤ 2 MB, stored in R2 under a random key, served with the checked `Content-Type` and `X-Content-Type-Options: nosniff`) and description (≤ 500 chars); sees own titles (hidden ones too, marked hidden); downloads own data as JSON (profile, titles, permissions, own audit rows); deletes own account after a fresh email code (the Owner's account refuses deletion); sign out ends the session. An account has `placed_at` null until the app places it (decision 149); a test pins that no endpoint in this plan returns another person's profile (decisions 150-151). Each change audited.
- [ ] **Step 2:** Implement; pages in five languages via the read-back loop. PR, merge.

### Task 14: Applicants pipeline and the TEST handoff (estimate 8)

`blocked_by:` Task 12, Task 7.

**Interfaces:** `applicants.status` gains `shortlisted|details_in|picked|not_picked`; table `applicant_details(email, languages_spoken, languages_learning, phone_type, phone_model, country, why, submitted_at)`. TEST exposes `POST /api/handoff/invite {email}` guarded by `HANDOFF_SECRET` (constant-time compare) that can only create an invite with no permissions, and `DELETE /api/handoff/testers` (same secret) that deletes every TEST account; PROD holds that one secret as `TEST_HANDOFF_SECRET`, TEST holds nothing of PROD's.

- [ ] **Step 1 (red):** staff with `applicants.manage` list and filter by language, phone, country; Shortlist mails the details form (single-use link, 7 days); the form stores the details and moves the row to `details_in`; Pick calls TEST's handoff with the email only and moves to `picked`; a handoff failure leaves the row unpicked and shows the error; Not picked; "Close round" deletes `not_picked` rows; "End closed testing" (Owner only, TOTP again) deletes every applicant and calls TEST's handoff `DELETE /api/handoff/testers` to delete every TEST account; every step audited (email in `subject`, details never in `detail`). The handoff endpoint refuses a missing or wrong secret (403) and any body field but `email`; `environments.test.ts` (plan 2 Task E3) still passes.
- [ ] **Step 2 (ask Shyden first):** "moderated as a message" for the `why` field has no moderation system until plan 8. Ask with `AskUserQuestion`: show `why` to applicant managers only until plan 8 (recommended), or hold the field until plan 8.
- [ ] **Step 3:** Implement; PR, merge.

### Task 15: Release 3b to PROD (estimate 2)

`blocked_by:` Tasks 8-14.

- [ ] **Step 1:** Cut `release/3b`, TEST deploy, journey gauntlet once.
- [ ] **Step 2 (Shyden):** approve `production`; set `OWNER_EMAIL`, `PUBLIC_BASE_URL`, `TEST_HANDOFF_SECRET`, Brevo key there. He signs in on PROD, enrols TOTP, prints recovery codes; read back his audit rows.
- [ ] **Step 3:** `SHOW_SIGN_IN` true on PROD; merge to `main` (Shyden); back to `develop`.

### Task 16: Close-out

- [ ] **Step 1:** The roadmap page story (plan 2 Task 4, Blocked by yawelo-idle#759) stays open; Task 4 stays open, blocked on the video. Close the plan 3 epic's other stories once each is verified; `board-progress.ts`; handover; `PushNotification`; "safe to `/clear`" with both progress lines.
