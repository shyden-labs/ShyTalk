# Plan 4 of 12: server foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, as plans 1-3 ran, decision 98) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the app has a server to rest on: each environment's database, app sign-in (Google, Apple, email code) with server-held sessions, a version floor that locks out old apps, and the "server decides" document delivered with ETag, rolled out to named people, a share or everyone, undone in one action, and announced to every open app within seconds.

**Architecture:** One Worker per environment (`workers/web`, already serving the site) answers the app too: `/api/app/*` sits beside plan 3's `/api/*` in the same `handleApi` router, with the same D1 and the same Better Auth instance, so staff and app users are one `user` table. The app sends `X-ShyTalk-Platform` and `X-ShyTalk-Version` on every call; a floor check runs before any app route. The UI document lives in D1, versioned, validated at publish; one Durable Object (`Announcer`, hibernating WebSockets) tells open apps "version N is out", costing nothing while idle.

**Tech Stack:** Cloudflare Workers + D1 + Durable Objects (Free plan; SQLite-backed DOs as plan 1's echo spike proved), Better Auth (social sign-in with native ID tokens, email OTP; pinned as plan 3 Task 9 pins it), Valibot for the document schema (MIT, small; my call), Vitest (unit on the laptop; `@cloudflare/vitest-pool-workers` integration in CI).

**Spec:** [`../specs/2026-10-24-shytalk-rewrite-design.md`](../specs/2026-10-24-shytalk-rewrite-design.md) §4.1, §4.11, §4.17; the live-app design `ShyTalk-legacy/.superpowers/sdd/EPIC-0011/live-app-design.md` (Shyden's D1-D11 and Q1-Q2, 2026-10-20), whose Express and Firestore specifics become Workers and D1.

**Review status:** self-approved 2026-11-02 after four passes (Review log). Tasks 1-2 were run in a scratch worktree; Tasks 3-8 are run as each story starts, because they need Task 2's database.

## Open questions (Shyden's; asked before any story is filed)

**Answered by Shyden 2026-11-02 13:00 (AskUserQuestion):** 1 = one shared LiveKit with separate keys per environment; 3 = option A, plan 4 sets up Better Auth; 2 = the ID-check service is decided in plan 9. All three answered.

1. **Voice for DEV and TEST** (spec §4.17 says "asked in plan 4"): one LiveKit server shared by DEV and TEST, or one each. Shared costs nothing extra on Oracle's free tier but puts testers' real voice traffic on the same box as DEV experiments; one each needs a second Always Free VM (whether it fits Oracle's free allowance is read from Oracle's free-tier page when this is asked; not yet measured). My recommendation: shared, with separate LiveKit API keys per environment, because voice holds no stored data and the free tier is the budget line.
2. **The ID check service** (same note in §4.17): decide its hosting now or in plan 9 (age and ID, epic #14). My recommendation: plan 9, because nothing in plans 4-8 calls it, and deciding early would be guessing at plan 9's needs.
3. **Who sets up Better Auth first.** Plan 3 Task 9 (#60) creates `getAuth(env)`, but it sits behind #55, which waits on Brevo (#42). Plan 4's Google and Apple sign-in need no Brevo. Option A: plan 4 Task 2 creates Better Auth (core + social) and plan 3 Task 9 later only adds the email-OTP plugin and the site page. Option B: plan 4 waits for #60. My recommendation: A, because it unblocks the app server now and changes only who writes `better-auth.ts` first; plan 3 Task 9's tests stay as written.
4. **Accounts only Shyden can make** (no question, a list): a Google Cloud OAuth client per platform (Android with the upload key's SHA-256, iOS, web) under the ShyTalk login; an Apple Sign in with Apple key and Services ID (the developer account the store app already uses); creating D1 databases `shytalk-dev`, `shytalk-test` (Non-Prod) and `shytalk-prod` (PROD), because the CI tokens hold "Workers Admin" (decision 214, #30), which grants no D1 permission (read 2026-11-02, developers.cloudflare.com/workers/authorization/workers/: "Product-level Workers roles do not grant access to other Developer Platform products such as R2, D1, KV ..."; the API token list has separate account permissions "D1 Read" and "D1 Edit"). **Answered 2026-11-02 (decision 219):** each environment's token gains "D1 Edit"; CI creates the databases and applies migrations. Steps go in `.superpowers/sdd/plan-04/shyden-steps.md` once 1-3 are answered.

## Global Constraints

- **Starts after** plan 3 Task 1 (#51; its code merged in PR #69: `handle`, `handleApi`, `WebEnv` in `workers/web/src/web.ts`) and plan 3 Task 8 (`audit(env, …)`: every state change writes one audit row in the same `env.DB.batch`). Task 1 here may land before Task 8 only if it changes no data.
- **Migration numbers:** plan 3 reserves 0001-0004 and its invites task needs one more, so each plan 4 migration (`NNNN` below) takes the next free number when its branch is cut from `origin/develop`; Task 2 adds a unit test refusing two migration files with one number, or a name not `NNNN_words.sql`.
- **Same Worker, same D1, same Better Auth** as the site (Architecture). No second API Worker.
- **Every request through a door** calls `requireDoorSecret()` and the marker guard from `packages/environment/`, as plan 3 does; machines call `workers.dev` directly (decision 197).
- **The server decides, and enforces** (live-app D1, D2): the floor and every rule are checked on the server; the app's copy of the document is never trusted for a decision.
- **Version floor status:** HTTP 426 with body `{"error":"update_required","floor":"<semver>"}` on every app route, one status and one code (live-app §4.5).
- **Nothing on a clock** (memory "nothing on a clock without asking"): the store check runs when staff open the floor page or press the button, not on a schedule; expiry by timestamp, cleaned on the next write. Any schedule is asked first with its daily cost.
- **Production publishing of the document needs Shyden's approval** (the `production` environment, ShydenMcM as required reviewer).
- **Every wording line** in the document is read back by Google Cloud Translation in every locale before it is published (global rule); publish-time validation refuses a document missing a line in any locale.
- **Languages:** the five of plan 3 (`en`, `id`, `th`, `vi`, `zh`) until the app's locale list is decided in plan 6.
- **Mutation testing while a test is written, never after** (Shyden, 2026-11-02, global): each new test is seen to fail once against a deliberate break of the code it covers, recorded in the PR body; no repeat mutation runs, CI jobs or schedules.
- **Laptop runs** unit, typecheck, lint, format only. A unit test reaches no D1, DO, network or process.
- **Workflow:** one story per task, one branch per story from fresh `origin/develop`, squash-merge on green `headRefOid`, `Refs #N` only.
- **Not a dating app:** no field, switch or copy key in the document schema names pairing, matching or partners in the romantic sense (CLAUDE.md guardrail); Task 5's schema test lists the refused words.

## Review Focus

1. **An app with no or malformed version headers.** Treated as below the floor (426), never as "latest". Test in Task 4.
2. **A publish while an app is mid-download.** ETag is the version number; an app fetching N while N+1 publishes gets N complete, then the announcement for N+1. Never a mixed document. Test in Task 6 (two reads around a publish return whole bodies).
3. **The same Google or Apple person signs in with email too.** One `user` row per verified email; a social sign-in with an email already held by an email-code account links to it only when the provider says the email is verified. Test in Task 3.
4. **Undo pressed twice, or during a rollout.** Undo republishes the previous version to everyone as a new version number (never rewinds the counter), and a second undo republishes the one before that. Test in Task 7.
5. **The Announcer holds thousands of idle sockets.** Hibernation means no duration charge while idle; a broadcast is one message per socket per change. Measured on DEV in Task 8, against Cloudflare's Free-plan limits read that day.

---

### Task 1: The app's API door and its contract (estimate 2)

**Files:** Modify `workers/web/src/web.ts` (route `/api/app/*`; its `json` moves out); create `workers/web/src/http.ts`, `workers/web/src/app/router.ts`; `tests/unit/app-router.test.ts`.

**Interfaces:**
- Consumes: `handleApi` and `WebEnv` from `workers/web/src/web.ts`.
- Produces: `handleAppApi(request: Request, env: WebEnv): Promise<Response>`; `json(status: number, body: unknown, etag?: string): Response`, which is `web.ts`'s existing private `json` moved to `workers/web/src/http.ts` and exported (one helper, review pass 1), now also setting `Cache-Control: no-store` unless a caller passes an ETag.

- [ ] **Step 1 (red):** `/api/app/unknown` → 404 `{"error":"not_found"}`; `/api/app/health` → 200 `{"ok":true,"environment":"<ENVIRONMENT_NAME>"}`; every `/api/app/*` response carries the site's CSP and `nosniff`; `/api/other` still reaches plan 3's `handleApi`.
- [ ] **Step 2:** implement; unit green; PR; merge on green.

### Task 2: The D1 databases and their migrations (estimate 5)

`blocked_by:` Shyden's step 1 (D1 Edit on the three deploy tokens, `.superpowers/sdd/plan-04/shyden-steps.md`); #51's DEV deploy of `workers/web` (deploy-dev today deploys only `workers/echo`, read 2026-11-02). Decision 219. Also unblocks the D1 half of plan 3's #55.

**Measured 2026-11-02 in the installed Wrangler 4.156.0 (`node_modules/wrangler/wrangler-dist/cli.js`, `provisionBindings`):** `wrangler deploy` provisions a D1 binding that has no `database_id` by itself (`experimental-provision`, hidden, default true), and in CI keeps working without the id written back. A token without D1 access does not fail the deploy: the binding is skipped and only warned about (`isPermissionDeniedAPIError` → `trackSkippedProvisioning`). So this task names databases by `database_name`, creates them explicitly before migrating, and fails on its own when D1 cannot be reached.

**Files:** `workers/web/wrangler.json` (`d1_databases` inside each `env`: `binding: "DB"`, `database_name: "shytalk-<env>"`, `migrations_dir: "../../migrations"`, no `database_id`); `environments.json` (`"d1": ["shytalk-prod"]`, `["shytalk-test"]`, `["shytalk-dev"]`); `tests/unit/environments.ts` (the D1 keys checked gain `database_name`); `.github/workflows/deploy-dev.yml` (D1 lines); `tests/unit/migrations.ts` (`migrationProblems(files: string[]): string[]`) and `tests/unit/migrations.test.ts`; `tests/unit/environments.test.ts`, `tests/unit/deploy-dev.test.ts` (new cases).

**Interfaces:**
- Produces: binding `DB: D1Database` on `WebEnv` in every environment (plan 3's tasks and Tasks 3-8 here use it); `migrations/` at the repo root, files `NNNN_words.sql`; `workers/web/src/web.ts` calls `createMarkerGuard(env.ENVIRONMENT_NAME, { databases: { DB: env.DB }, buckets: {} })` (one guard per `DB` binding, kept in a `WeakMap` so per isolate, made on its first request; a module-level guard would carry one unit test's pass into the next) after the door check on every request, PROD included, replacing the "checks no environment marker yet" comment (plan 3 Task 5, #55, no longer wires it; noted on #55 when filed).

- [ ] **Step 1 (red):** environments guard: `env.dev` binding `database_name: "shytalk-prod"` is refused naming both environments; the real tree lists each environment's own name. Migrations test: two files `0003_a.sql` and `0003_b.sql` are refused naming both; `3_auth.sql` is refused; an empty `migrations/` passes. deploy-dev test: when `migrations/` or `workers/web/` changed, the step runs, in this order and from `workers/web` with `--env dev` (outside that config Wrangler prints a different not-found message, `getDatabaseByNameOrBinding`, cli.js read 2026-11-02 in review pass 1), `wrangler d1 info shytalk-dev` (create with `wrangler d1 create shytalk-dev --location apac` (decision 220) only when info's error is Wrangler 4.156.0's `Couldn't find a D1 DB named 'shytalk-dev'` (cli.js, read 2026-11-02); any other error stops the job naming it, no retry), then `wrangler d1 migrations apply DB --remote --env dev` (its confirm prompt answers yes in CI, `confirm2` fallback, read the same day), then the environment marker (`packages/environment/README.md`; a shared migration cannot hold a per-environment name, review pass 1): `wrangler d1 execute DB --remote --env dev --command "CREATE TABLE IF NOT EXISTS environment_marker (name TEXT NOT NULL); INSERT INTO environment_marker (name) SELECT 'dev' WHERE NOT EXISTS (SELECT 1 FROM environment_marker);"` and a read-back `SELECT name FROM environment_marker` that stops the job unless it prints exactly one row `dev`, then `wrangler deploy --env dev`; a rehearsal runs none of them with a credential. Front-door test (`tests/unit/web-front-door.test.ts`, D1 mocked): a DEV request whose `DB` marker reads `prod`, or has no row, gets 503 and assets are never fetched; a matching marker serves; the marker is read once per guard. Each watched failing once against a deliberate break.
- [ ] **Step 2:** implement; unit, typecheck, lint, format green; PR; merge on green `headRefOid`.
- [ ] **Step 3 (DEV, measured):** the first develop run creates `shytalk-dev` and applies the migrations present. Read back with the dev token: `wrangler d1 info shytalk-dev` and `wrangler d1 migrations list DB --remote --env dev` show every file applied. `wrangler d1 execute DB --remote --env dev --command "SELECT name FROM environment_marker"` prints `dev`. Decision 219's open point (does D1 Edit cover remote migrations and `d1 execute`?) is answered by this run and written into the decision; if Cloudflare refuses, stop and tell Shyden the permission it names.
- [ ] **Step 4:** TEST and PROD get the same D1 lines (info or create, migrations, marker write and read-back, each with its own environment's name) before the Worker deploys, since a Worker whose marker is missing answers 503 everywhere, in their release deploys (plan 3 Task 7, #57): TEST with the test token, PROD only through `production` with Shyden's approval. Recorded on #57, not built twice.

### Task 3: App sign-in with Google and Apple (estimate 5)

`blocked_by:` Task 2 (the D1 databases); Shyden's OAuth clients and Apple key (`.superpowers/sdd/plan-04/shyden-steps.md` steps 2-3). Question 3 is answered (option A).

**Files:** `workers/web/src/auth/better-auth.ts` (created here under option A); `migrations/0003_auth.sql` (Better Auth's tables from its CLI, committed; the number plan 3 reserved); `workers/web/src/app/session.ts`; `tests/unit/app-sign-in.test.ts`; `tests/integration/app-sign-in.test.ts`.

**Interfaces:**
- Produces: `getAuth(env: WebEnv): BetterAuth` (plan 3 Task 9's name and type); `requireAppSession(request: Request, env: WebEnv): Promise<AppSession>` (throws a 401 Response `{"error":"signed_out"}`); `AppSession = { userId: string; email: string; createdAt: number }`. Routes `POST /api/app/sign-in/google {idToken}`, `POST /api/app/sign-in/apple {idToken, nonce}`, `POST /api/app/sign-out`. Bearer session tokens (the app stores them in the platform keychain, plan 6).

- [ ] **Step 1:** read Better Auth's docs that day for the D1 dialect, social sign-in with a native ID token, Apple's nonce, and its Expo client; record the version and every difference from this task in the PR body; pin exactly.
- [ ] **Step 2 (red):** a Google token whose `aud` is not one of our three client IDs → 401; an expired token → 401; an Apple token whose nonce hash does not match → 401; a good token creates one `user` and one `session` row and answers `{token, userId}`; the same person again reuses the `user`; an email-code `user` with the same verified email is linked, an unverified one is not (Review Focus 3); sign-out deletes the session row, and the old token then gets 401; every sign-in and sign-out writes one audit row in the same batch. Integration (CI): the same against real D1 with provider keys stood in by a local JWKS.
- [ ] **Step 3:** rate limit sign-in with the Workers rate-limiting binding (per IP, 10 per minute; 429 `{"error":"slow_down"}`); read its Free-plan terms that day.
- [ ] **Step 4:** unit green; PR, green; merge; DEV check by hand on both phones with Shyden (one test, both phones).

### Task 4: The version floor (estimate 3)

**Files:** `migrations/NNNN_app_floor.sql`; `workers/web/src/app/floor.ts`; `apps/web/src/pages/staff/floor.astro` + island; `tests/unit/app-floor.test.ts`; `tests/integration/app-floor.test.ts`.

**Interfaces:**
- Produces: table `app_floor(platform TEXT PRIMARY KEY CHECK (platform IN ('android','ios')), min_version TEXT NOT NULL, set_at INTEGER NOT NULL, set_by TEXT NOT NULL)`; `checkFloor(request: Request, env: WebEnv): Promise<Response | null>` (null = allowed), called by `handleAppApi` before every route except `/api/app/health`; `POST /api/staff/floor {platform, version}` needing permission `floor.manage` (added to plan 3's `Permission` union).

- [ ] **Step 1 (red):** missing header, unknown platform, or a version that is not `MAJOR.MINOR.PATCH` → 426 (Review Focus 1); `1.9.0` under floor `1.10.0` → 426 (numeric, not string, compare); equal → allowed; no row for a platform → allowed; the staff route without `floor.manage` → 403; a floor set lower than the current one is refused 409 unless `force: true`, and both write an audit row.
- [ ] **Step 2:** implement; unit green; PR, green; merge.
- [ ] **Step 3 (later story, blocked by #35 and #36):** the automatic store check (live-app Q1): opening the floor page asks App Store Connect and the Play Developer API whether a version is live in both, and offers the move. Filed as its own story with those blockers.

### Task 5: The UI document's schema (estimate 3)

**Files:** `packages/ui-document/{index.ts,schema.ts}`; `manifests/ui.json` (version 1: menus, colours, sizes, switches, copy); `tests/unit/ui-document.test.ts`.

**Interfaces:**
- Produces: `type UiDocument = { schemaVersion: 1; navigation: NavItem[]; tokens: Record<string, string | number>; switches: Record<string, boolean>; copy: Record<Locale, Record<string, string>>; screens?: never }` (`screens` reserved for Part 2, live-app D6); `validateUiDocument(input: unknown): { ok: true; doc: UiDocument } | { ok: false; errors: string[] }`.

- [ ] **Step 1 (red):** a document missing a copy key in any of the five locales fails naming key and locale; an unknown top-level key fails; `screens` present fails until Part 2; a `navigation` item naming a sealed route (ban and suspension, App-Lock, cohort segregation, unsafe device, account deletion) fails; a refused-word key or value (Global Constraints) fails; `manifests/ui.json` passes.
- [ ] **Step 2:** implement with Valibot; unit green; PR; merge.

### Task 6: Serving and publishing the document (estimate 5)

**Files:** `migrations/NNNN_ui_documents.sql`; `workers/web/src/app/ui.ts`; `scripts/publish-ui.ts`; `.github/workflows/deploy-dev.yml` (publish step); `tests/unit/app-ui.test.ts`; `tests/integration/app-ui.test.ts`.

**Interfaces:**
- Consumes: `validateUiDocument` (Task 5), `requireAppSession` (Task 3), `audit` (plan 3 Task 8).
- Produces: table `ui_documents(version INTEGER PRIMARY KEY, body TEXT NOT NULL, audience TEXT NOT NULL, share INTEGER, published_at INTEGER NOT NULL, published_by TEXT NOT NULL)`; `GET /api/app/ui` → 200 with `ETag: "<version>"` or 304 on `If-None-Match`; `publishUi(env, doc, {audience, share?, by}): Promise<number>` (new version number).

- [ ] **Step 1 (red):** an invalid document is refused and nothing is stored; a valid one gets the next version; `If-None-Match` with the current version → 304, empty body; two reads around a publish each return one whole body matching its ETag (Review Focus 2); signed-out callers get the `everyone` version only.
- [ ] **Step 2:** DEV publishes `manifests/ui.json` on every merge that changes it (deploy-dev's changed-areas list gains `manifests/`); PROD publishes only through a `production` workflow run Shyden approves.
- [ ] **Step 3:** unit green; PR, green; merge; read the DEV document back.

### Task 7: Rollout and undo (estimate 3)

**Files:** `workers/web/src/app/rollout.ts`; `migrations/NNNN_rollout_people.sql`; `apps/web/src/pages/staff/rollout.astro` + island; tests.

**Interfaces:**
- Produces: `audience ∈ 'named' | 'share' | 'everyone'`; table `rollout_people(user_id TEXT PRIMARY KEY, added_by, added_at)`; `bucket(userId: string): number` (0-99, first two bytes of SHA-256 of `userId` mod 100, stable); `resolveVersion(env, session | null): Promise<number>`; `POST /api/staff/ui/{promote,undo}` needing `ui.publish`.

- [ ] **Step 1 (red):** a named person sees the newest `named` version, others the newest `everyone`; a share of 20 reaches exactly the users with `bucket < 20` and the same user always lands in the same bucket; promote moves a version to the next audience; undo republishes the previous `everyone` body as a new version, twice in a row walks back two (Review Focus 4); each writes an audit row.
- [ ] **Step 2:** rollback drill on DEV, recorded with times; PR, green; merge.

### Task 8: The live announcement (estimate 5)

**Files:** `workers/web/src/app/announcer.ts` (Durable Object `Announcer`, exported from `workers/web/src/index.ts` with the handler only, per `tests/unit/worker-entry-exports.test.ts`); `workers/web/wrangler.json` (DO binding + migration); tests.

**Interfaces:**
- Produces: `GET /api/app/live` (WebSocket upgrade, session optional) → messages `{"type":"ui","version":N}`; `announce(env, version): Promise<void>` called by `publishUi` and undo.

- [ ] **Step 1 (red, DO stood in for unit):** a publish sends one message to each connected socket; a socket that reconnects gets the current version at once; a closed socket is dropped; the Announcer uses `acceptWebSocket` (hibernation API), never `addEventListener('message')` on a held socket.
- [ ] **Step 2:** integration in CI with real DOs; then DEV measurement: publish → on-screen p95 at or under 10 s on both phones (live-app §4.3), 20 publishes, recorded with times in `.superpowers/sdd/plan-04/live-measure.md`; Free-plan DO limits read that day and the cost of 1,000 idle sockets for a day written down (Review Focus 5). If the p95 or the cost fails, stop and take it to Shyden with Expo push as the measured alternative.
- [ ] **Step 3:** PR, green; merge.

### Task 9: Close-out (estimate 1)

- [ ] Every story closed with evidence; design §4.17's two open lines updated with Shyden's answers; handover and board current; plan moved into `docs/superpowers/plans/` with its first PR.

## Calls I made (for Shyden to check)

- The app's API lives in the site's Worker (one user table, one Better Auth), not a second Worker.
- 426 with `update_required` is the floor's one status and code.
- Valibot for the schema (small, MIT); Zod would also do.
- A hibernating Durable Object for "within seconds", measured before it is kept; Expo push is the fallback.
- The automatic store check runs when staff open the page, never on a clock.
- D1 databases are named, not pinned by id, because Wrangler resolves them by name and the ids would only be pasted from a CI run; the environments guard checks names instead.
- Estimates total 32 points (epic guess was 40; Task 2 went 3 → 5 in review pass 1 for the marker); measured from the tasks, not the epic.

## Review log

**Pass 1 (2026-11-02), Tasks 1-2 run in a scratch worktree off `origin/develop`:**
- Ran `wrangler deploy --dry-run --env dev` with name-only D1 bindings: bundles, `env.DB` = `shytalk-dev`. `wrangler d1 migrations list DB --local --env dev` resolves the binding by name and lists `0001_probe.sql`.
- Fixed: `d1 info`'s not-found text depends on running inside the config (`getDatabaseByNameOrBinding`); Step 1 now says "from `workers/web` with `--env dev`".
- Fixed (gap): Task 2 brought D1 but nothing wrote the per-environment marker or called the marker guard. Added an idempotent marker write plus read-back in deploy-dev, and the guard wiring in `web.ts` (one guard per `DB` binding via a WeakMap, so tests do not share a cached pass); estimate 3 → 5.
- Fixed: Task 1 would have added a second `json` helper; it now moves `web.ts`'s into `http.ts`.
- Added `tests/unit/migrations.ts` to Task 2's files.
- Not run: the deploy-dev D1 lines, because they extend #51's `workers/web` deploy step, which does not exist yet (Task 2 is `blocked_by` it).
- Scratch code run: first run red (my fixture's type; a planted `shytalk-prod` left by the earlier guard run; wrangler.json format), fixed; re-run green: typecheck, lint, format, unit 67/67 in 4 files. Each new test watched failing against a break, all 7 caught: guard ignoring `database_name`; duplicate numbers; any digit count; marker result ignored (2 tests); guard not kept; health route gone; `no-store` dropped.

**Pass 2 (2026-11-02):** re-read Tasks 1-2 against the pass 1 code. One fix: Step 4 named "three lines"; now the four D1 steps, and why the marker must come before the Worker deploys. Nothing else new.

**Pass 3 (2026-11-02):** re-read Tasks 1-2 in full. Two fixes: the guard line now says one per `DB` binding (as the pass 1 code does); Step 3 also reads the marker back and asks whether D1 Edit covers `d1 execute`.

**Pass 4 (2026-11-02):** re-read the two edited lines against the code; nothing new. Tasks 3-8 are reviewed by running when each story starts (they build on Task 2's database, which does not exist until Shyden's step 1 and #51).
