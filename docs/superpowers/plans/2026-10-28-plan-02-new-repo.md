# Plan 2 of 12: the new repository and its fresh board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, as plan 1 ran, decision 98) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public `shyden-labs/ShyTalk` repository started from repo-template's slim starter kit, with green CI on `develop`, rulesets, a fresh "ShyTalk Stories" board with the remaining plans filed on it, and the environment foundations (Cloudflare accounts, doors, keys), so plan 3 starts on a clean canvas.

**Rewritten 2026-10-30 (decisions 203-207):** Shyden's "keep it simple" and "value test before every decision" rulings. Everything this plan used to copy or build for checking checks (Yawelo's mutation runner, floors and their record/fold step, the one-test-per-case and floorless-searches meta-guards, compiler-free splits for load limits, planted-form corpora, the board-orphans reader App, the local PROD-deploy hook) is gone. The previous text is `2026-10-28-plan-02-new-repo.md.bak-keep-simple-2026-10-30`; its review log keeps the measurements, several of which (Task 0's block, F29, F32-F36, E2's door design) still hold.

**Tech Stack:** Node 26 (pinned by the template's one Dockerfile), TypeScript, Vitest + coverage-v8 (one overall percentage), ESLint, Prettier, GitHub Actions, GitHub Projects (v2), SonarCloud, Cloudflare Workers.

**Spec:** [`../specs/2026-10-24-shytalk-rewrite-design.md`](../specs/2026-10-24-shytalk-rewrite-design.md) §4.15 and §4.17, decisions in `decisions-2026-10-24.md` (a private working record, not in this repository) (30, 31, 85, 89, 97, 100, 101, 104, 124-134, 178-197, 201, 203-207).

## Global Constraints

- **Sources, read only:** repo-template `origin/develop` (at or after repo-template#149) and, where named, yawelo-idle `origin/develop`, each SHA written to a file by `git rev-parse` and cited from it. Nothing is written in either repo.
- **Act as the ShyTalk App** through the gh router. Shyden's steps are one block each, in **his own Terminal**, ending in a read-back whose expected output the step states.
- **Ids carried over (decision 101):** Android and iOS `com.shyden.shytalk`, Android builds above `versionCode 178`. They go into CLAUDE.md for plan 6.
- **Nothing on a clock** except decision 72's monthly job (plan 9) and decision 197's daily door count (Task E6).
- **No production login on the Mac (decision 207):** wrangler here is signed into the Non-Prod account or nothing. Every PROD step goes through the GitHub `production` environment with Shyden's approval at the time.
- **Guards before keys (decision 187):** no Cloudflare deploy key exists until Tasks E2 and E3 are merged and green.
- **Laptop runs** unit, typecheck, lint and format only; everything else is CI's.
- **Workflow after Task 1:** one branch per ticket from fresh `origin/develop`, squash-merged once CI is green on the PR's `headRefOid`, `Refs #N` only, docs PRs one commit.
- **Licences:** code Apache-2.0; `TRADEMARKS.md` reserves "ShyTalk" and its logo for Shyden Labs; no content licence. Nothing names Shyden Ltd.
- **Copied files (decision 201):** a file copied from another repo cites that repo's issues in full (`owner/repo#N`) in its comments and docs; strings are left alone. Done by hand at copy time and read in review. No tool, no guard. Task 1 copies the whole template: 171 lines with a bare `#N` across about 30 files (measured pass 4), most in comments and Markdown, some in test strings, which stay.
- **Reference code (pass 4):** `.superpowers/sdd/REWRITE/plan-02-pass4.patch`, against repo-template `7c441343adc699b1e97ed3ff8a78c82824a74f1c` (`plan-02-pass4-template-sha`), is Tasks 1, 2 Step 1, 2b, 6, E2 and E3 as run green in pass 6 (848 unit tests, coverage 100%, `scripts/npm-ci.ts` warning-free, the door's dry-run bundle). Each task's PR may start from its part of it; the template SHA read at Task 1 may be newer, so re-run everything.
- **Private stays private:** `.superpowers/`, `HANDOVER.md`, `.claude/settings.local.json`, `*.jks` and `local.properties` are git-ignored before the first commit.

## Review Focus

1. **A push from the old checkout lands in the new repo.** Task 0 re-points the old checkout's `origin` to `ShyTalk-legacy.git` and reads it back before the repo is created.
2. **A required check that never reports, or a job that is not required.** Check names come from Task 1's real run, never the YAML; each ruleset change is read back.
3. **Two boards titled "ShyTalk Stories".** Every board write resolves by node id and asserts the title; Task 3 renames the old board.
4. **A private working record published.** Task 11 copies only the design and plans, grep-checked first.
5. **A key that reaches the wrong environment.** Task E3's tests and E2's run-time marker check land before Task E4 creates any key.
6. **Machines through a door** (decision 197): nothing automated calls a door address.

---

### Task 0: The repository exists and the folders are swapped (Shyden; decisions 132, 133)

- [ ] **Step 1:** Write `HANDOVER.md` (resume at Task 1, in the new folder) and record the keystore's sha256 prefix (`44f5ec43cb71ac8a`, measured 2026-10-28).
- [ ] **Step 2:** Give Shyden this block for his own Terminal, from `~/Developer/Repos`. Ask him to quit this Claude session first, because its folder moves.

```sh
set -e
cd ~/Developer/Repos
git -C ShyTalk remote set-url origin https://github.com/shyden-labs/ShyTalk-legacy.git
git -C ShyTalk remote get-url origin            # expect .../ShyTalk-legacy.git
mv ShyTalk ShyTalk-legacy
# paths absolute: -C makes relative ones resolve inside ShyTalk-legacy (dry-run 2026-10-28)
git -C ShyTalk-legacy worktree repair "$PWD"/ShyTalk-0146 "$PWD"/ShyTalk-shy0227 "$PWD"/ShyTalk-shy0525 \
  "$PWD"/ShyTalk-wt-0625 "$PWD"/ShyTalk-wt-0657 "$PWD"/ShyTalk-wt-0657-proof "$PWD"/ShyTalk-wt-0692 \
  "$PWD"/ShyTalk-wt-0708 "$PWD"/ShyTalk-wt-0709
git -C ShyTalk-legacy worktree list --porcelain | awk '/^prunable/{n++} END{print "prunable", n+0}'   # expect: prunable 0
shasum -a 256 ShyTalk-legacy/keystore.jks | cut -c1-16    # expect 44f5ec43cb71ac8a
gh repo create shyden-labs/ShyTalk --public --disable-wiki \
  --description "ShyTalk: learn languages and cultures by talking. App, server and website."
git clone https://github.com/shyden-labs/ShyTalk.git ShyTalk     # "cloned an empty repository"
mkdir -p ShyTalk/.superpowers/sdd ShyTalk/.claude
cp -R ShyTalk-legacy/.superpowers/sdd/REWRITE ShyTalk/.superpowers/sdd/
cp ShyTalk-legacy/HANDOVER.md ShyTalk/
[ -f ShyTalk-legacy/.claude/settings.local.json ] && cp ShyTalk-legacy/.claude/settings.local.json ShyTalk/.claude/
gh api repos/shyden-labs/ShyTalk --jq '[.visibility,.size,.archived]|@tsv'   # expect: public 0 false
```

- [ ] **Step 3:** Click path to add the repo to the ShyTalk agent App: github.com/organizations/shyden-labs/settings/installations > shytalk-agent > Configure > Repository access > add `ShyTalk` > Save. He starts a new Claude session in `~/Developer/Repos/ShyTalk`.
- [ ] **Step 4 (new session):** As the App, `gh api repos/shyden-labs/ShyTalk --jq .full_name` prints `shyden-labs/ShyTalk`; a 404 means the App is not installed yet: stop and ask.

### Task 1: First commit, from the slim template

`blocked_by: shyden-labs/repo-template#149` (decision 206; read its state first).

**Files:** the template tree; `package.json` (`name` `shytalk`, `private` true, `"license": "Apache-2.0"`), `README.md` (ShyTalk introduction above the template's set-up section), `.gitignore`; new `NOTICE`, `TRADEMARKS.md`, `CLAUDE.md` (the not-a-dating-app guardrail and mission from the old untracked CLAUDE.md, saying Shyden Labs; the ids; the branch form `<type>/<issue>-<slug>`; the board section left for Task 5). Keep the template's `deploy-dev.yml` stub as it ships.

- [ ] **Step 1:** `git -C ../repo-template fetch origin && git -C ../repo-template rev-parse origin/develop > .superpowers/sdd/REWRITE/template-sha`.
- [ ] **Step 2:** `git switch -c develop`, then `git -C ../repo-template archive "$(cat .superpowers/sdd/REWRITE/template-sha)" | tar -x -C .`. Add the private paths to `.gitignore` first and confirm with `git check-ignore -v --no-index .superpowers/ HANDOVER.md .claude/settings.local.json` (name `.superpowers/` with its slash, F36).
- [ ] **Step 3:** Make the edits, rewriting each bare `#N` in a comment or Markdown file to `shyden-labs/repo-template#N`. After renaming the package, `npm install --package-lock-only` (otherwise the lockfile keeps the name `repo-template`, measured pass 4). Then `npm ci && npm run typecheck && npm run lint && npm run format:check && npm run test:unit`. A red that pins the template's own name is re-pinned to ShyTalk's; any other red is fixed. List them in the commit body.
- [ ] **Step 4:** One commit, "chore: start ShyTalk from repo-template develop", citing `template-sha`. `git push -u origin develop`; read back `default_branch` is `develop`. Wait on the run in the background; write the job names exactly as reported to `.superpowers/sdd/REWRITE/check-names`.

### Task 2: Rulesets, security and environments (Shyden)

- [ ] **Step 1:** Read the template's `scripts/branch-rules-setup.ts` at `template-sha`. If it does not pin each required context to GitHub Actions (`integration_id: 15368`, `release-cut` on `main` included, F13), add that with a red-first unit test; PR, green, merge. (Pass 4: the template at `8018a7e0` has no pin. `desiredRuleset` pins every context, `auditBranchRules` names an unpinned one, and five existing fixtures gain the id.)
- [ ] **Step 2:** Shyden's block, from the new checkout: `node scripts/branch-rules-setup.ts shyden-labs/ShyTalk <each name in check-names>`; secret scanning and push protection on (`gh api -X PATCH repos/shyden-labs/ShyTalk --input -` with `{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}`); Dependabot alerts and security updates (`gh api -X PUT .../vulnerability-alerts`, `.../automated-security-fixes`). It ends by printing `.security_and_analysis` (each of the three `enabled`) and the rulesets.
- [ ] **Step 3:** As the App, read the rulesets back: `develop` and `main` each name their own branch, required checks equal `check-names`, strict on `develop` only (F17), each pinned to app 15368.

### Task 2b: The docs-only fast path (global rule)

Only if the slim template has none (read `ci.yml` at `template-sha`; `8018a7e0` has none). `scripts/change-scope.ts` writes `scope=docs-only|code`: docs-only when every changed path (`git diff --name-only HEAD^1 HEAD`, checkout `fetch-depth: 2`) is Markdown or under `docs/`; a push, an empty diff or a classifier error is "code". It runs as a step in **each** job (`build-and-test` and `coverage`), because a job skipped through `needs:` reports "skipped", which a required check takes as a pass. Typecheck, lint, unit tests and the coverage run are skipped. The install (`node scripts/npm-ci.ts` since repo-template#153) and the format check always run, since Prettier checks non-Markdown files under `docs/`. Tests never read docs prose (Shyden 2026-10-31: no value): Task 1 drops the template's `describe('docs/release-cut.md')` block (7 tests pinning sentences) unless the template has already dropped it. Skips are per step, never per job, so every required check reports. The template's `static-checks.test.ts` step list gains the classify step.

- [ ] **Step 1:** Classifier with red-first unit tests (docs change, code change, mixed, push, empty diff, a file merely named docs, git failure, unset event, no `GITHUB_OUTPUT`).
- [ ] **Step 2:** PR, green, merge; a one-commit docs PR shows the fast path, every required check reporting.

### Task 3: The fresh board (App)

- [ ] **Step 1:** Read the org node id, `createProjectV2(input:{ownerId, title:"ShyTalk Stories", repositoryId})`, write the node id and number to `board-node` and `board-number`, read back `title number closed`. A refusal: ask Shyden to create it, then continue from the read-back.
- [ ] **Step 2:** `node scripts/board-setup.ts "$(cat board-node)" "ShyTalk Stories"`; read back Status, Estimate (NUMBER), Priority (P0-P5). If the template's script lacks something ShyTalk needs here, copy that one script from Yawelo at a recorded SHA (decision 201 for its comments) rather than patching around it.
- [ ] **Step 3:** Labels `waiting-on-shyden` and `post-launch`, read back.
- [ ] **Step 4:** Rename the old board (`PVT_kwDOEOcG584BZ_lN`, asserting "ShyTalk Stories" and `closed: true` first) to "ShyTalk Stories (legacy)"; read both back.

### Task 4: File the work on the board

Each story: ACs, Estimate, Priority, Blocked by (search first).

- [ ] **Step 1:** Epic "Plan 2: the new repository and its fresh board", one story per task; Tasks 0-3 close at once with their read-backs as evidence (E1 too, if done). The rest stay open, P1, in plan order.
- [ ] **Step 2:** Epics for plans 3-12 in decision 148's order (website is plan 3), each citing its design sections with a labelled points guess; no Estimate on epics.
- [ ] **Step 3:** Stories known now: plan 6, the iOS distribution certificate, profile and App Store Connect key (decision 124) and the Android upload key as a `production` environment secret (decisions 101, 127); plan 8, the `support@shytalk.app` mailbox (decisions 108-110), `waiting-on-shyden`; plan 3, the live roadmap on this board, Blocked by yawelo-idle#759.
- [ ] **Step 4:** `board-next.ts` names the next story and `board-progress.ts` prints both lines.

### Task 5: Record the board

- [ ] **Step 1:** Repo PR: `CLAUDE.md` gains the board node id, number, title and the `board-next`/`board-progress` commands. One commit, `Refs #<story>`, green, squash-merge, close by hand.
- [ ] **Step 2:** The global layer (`app_manifest.py` board ids, the roadmap hook's node id, the global CLAUDE.md board line, memory `reference-shytalk-progress-command.md`) is not mine to edit (2026-10-30): send the exact changes to repo-template-af's list for Shyden to approve. Until it lands, any board write the router refuses is asked of Shyden.

### Task 6: Licence check

- [ ] **Step 1:** `tests/unit/dependency-licences.test.ts`, red first: read `package-lock.json`; shipped packages permissive only; build and test tools may also be LGPL or MPL; GPL, AGPL, SSPL, unknown or missing are red, each named. Licences are SPDX expressions: allowed when one `OR` choice has every `AND` part allowed; an expression with brackets is refused (wrangler is `MIT OR Apache-2.0`; sharp's builds are `Apache-2.0 AND LGPL-3.0-or-later`, measured pass 4). Watch it fail once on a fake GPL entry, then remove it.
- [ ] **Step 2:** PR, green, merge.

### Task 7: SonarCloud gate

- [ ] **Step 1:** Read whether key `shyden-labs_ShyTalk` exists (Keychain token `shytalk-sonarcloud-token`); if it does, ask Shyden whether to delete the legacy project or use another key.
- [ ] **Step 2:** Shyden follows the template's `docs/sonarcloud.md` (project, Automatic Analysis off, new code, token), `SONAR_TOKEN` as an Actions and a Dependabot secret.
- [ ] **Step 3:** PR: the scan ran and the gate is `OK`. Merge, require it, read it back.

### Task E1: The ShyTalk Cloudflare login and its two accounts (Shyden; decisions 193, 194, 196)

Started 2026-10-29: the main login holds shyden.co.uk's account, "Shyden Labs Dev" and "shytalk" (shytalk.app). Every step is his.

- [ ] **Step 1:** A new free Gmail for ShyTalk, its own 2FA (the login's recovery route, so not on shytalk.app).
- [ ] **Step 2:** Sign up the ShyTalk Cloudflare login with it (email and password, not the Google button), two factors on, backup codes in Bitwarden.
- [ ] **Step 3:** Rename the login's own sign-up account "ShyTalk Non-Prod".
- [ ] **Step 4:** As the main login: "shytalk" > Members > Invite > the ShyTalk Gmail, entire account, Super Administrator. Accept as the ShyTalk login; the main login then leaves "shytalk".
- [ ] **Step 5:** Read back: the ShyTalk login lists exactly "shytalk" and "ShyTalk Non-Prod"; the main login no longer lists "shytalk"; the zone is Active. Account ids go to the git-ignored `.superpowers/sdd/REWRITE/cf-accounts`.

### Task E2: The door Worker, the door secret and the environment marker (repo; design §4.17)

**Files:** `workers/door/` (`src/index.ts`; `wrangler.jsonc` with environments `test` and `dev`), `packages/environment/index.ts` (`requireDoorSecret()`, `assertEnvironmentMarkers()`), unit tests under `tests/unit/`. Both are written against the standard `Request`/`Response`/`fetch`/`crypto.subtle` (global in Node 26 and in Workers) plus small `D1Like`/`R2Like` interfaces, so the root tsconfig checks them as they are: no second tsconfig, no `wrangler types`, no generated file (pass 4). `wrangler` and `jsonc-parser` as exact dev dependencies. `allowScripts` declines `esbuild` and `workerd` (their postinstalls only check the platform binary npm already installed; `wrangler deploy --dry-run` bundles the door without them, measured pass 4), and the template's `supply-chain.test.ts` pin of `allowScripts` is re-pinned to the three. `.wrangler/` is git-ignored. `vitest.unit.config.ts` coverage widens to `workers/*/src/**` and `packages/**`, since the template measures `scripts/` only. Each door's `ORIGIN` is its environment's Non-Prod `workers.dev` address, unknown until E1: a placeholder here, filled in Task E4.

- [ ] **Step 1 (door, red first):** with `fetch` stood in: method, path, query, headers and body reach `ORIGIN` unchanged; redirects come back unfollowed; a WebSocket upgrade keeps `Upgrade`/`Connection` and the origin's response is returned as is (the real upgrade is proven in E6 Step 3); the door sets `x-shytalk-door-secret`, overwriting any caller copy; a plain 502 when the origin is unreachable; the Worker's entry sends through the runtime's `fetch`. Its config allows keys by name (top level: name, main, date, `workers_dev`, env; each environment: name, routes, `vars` holding `ORIGIN` alone), so it can hold no binding. Its tests use a neutral host.
- [ ] **Step 2 (door secret, red first):** `requireDoorSecret` answers 403 when the header is missing, empty, a prefix or different, or no secret is configured; compared in constant time over SHA-256 digests.
- [ ] **Step 3 (marker, red first):** each D1 holds a one-row `environment_marker` table and each R2 bucket a `.environment` object (create commands in `packages/environment/README.md`). `assertEnvironmentMarkers(expected, stores)` fails closed (503, logged) on missing or mismatched; a pass is kept for the isolate's life, a failure is checked again on the next request. Tests: match (read once), missing table, empty table, missing object, wrong name, read error, a failure then a pass.
- [ ] **Step 4:** Unit, typecheck, lint; PR, green, merge.

### Task E3: The environment checks (repo)

`blocked_by:` Task E2.

**Files:** `environments.json` (each environment's D1/R2/KV ids; not secrets) and `tests/unit/environments.test.ts`, reading every `wrangler.*` config with a real parser. The configs are found by walking the tree in-process (skipping `node_modules`, `.git`, `coverage`, `.wrangler`), never with `git ls-files`: a unit test starts no process.

- [ ] **Step 1 (red first):** (a) no environment binds an id listed under another (preview ids count); (b) no file under `tests/`, `scripts/` or `.github/` names a door host. The hosts come from the door's routes and are never written in a test, or the test names them itself (it did, pass 4). That a door binds nothing is E2 Step 1's key allow-list. Watch each fail once (DEV bound to PROD's D1 by a fixture; a door host planted in a script), then remove the plant.
- [ ] **Step 2:** PR, green, merge.

### Task E4: Deploy keys and GitHub environments (Shyden; after E2 and E3)

`blocked_by:` Task E1, Task E3.

- [ ] **Step 1:** Read that E2 and E3 are merged and green on `develop`; if not, stop.
- [ ] **Step 2:** Re-read Cloudflare's per-Worker role and token docs that day and write the steps from them. One token per Worker: DEV and TEST (Non-Prod account, that Worker only), PROD (shytalk account, PROD Workers and both doors). Wider D1/R2 rights are listed and asked first.
- [ ] **Step 3:** His block creates GitHub environments `dev` (`develop` only), `test` (`release/*` only) and `production` (`main` only, reviewer ShydenMcM), each token set there, never as a repo secret, and lists each environment back.
- [ ] **Step 3b:** PR: each door's `ORIGIN` in `workers/door/wrangler.jsonc` set to its Non-Prod `workers.dev` address (the subdomain read from the Non-Prod account, `cf-accounts`); green, merge.
- [ ] **Step 4:** He creates each door secret with `wrangler secret put` (signed in to Non-Prod for DEV/TEST; the PROD doors' secrets through the `production` environment, decision 207); values to Bitwarden only.

### Task E6: The doors go live, the door spike, the WAF rule and the daily door count (PROD steps need his approval)

`blocked_by:` Task E4. (E5 was dropped by decision 207.)

- [ ] **Step 1:** Deploy a throwaway DEV echo Worker with one Durable Object (WebSocket accept, an alarm every 30 s, echo) behind `requireDoorSecret` and `assertEnvironmentMarkers`, through the `dev` environment.
- [ ] **Step 2 (PROD, his approval):** Deploy both doors through `production`, add routes `test.shytalk.app/*` and `dev.shytalk.app/*` with DNS. Read back each answers through its door and the bare `workers.dev` origin refuses a request without the secret (403).
- [ ] **Step 3 (spike):** through `dev.shytalk.app`: WebSocket connect, a 30-minute hold, alarms arriving, a dropped and resumed connection; results with times in `.superpowers/sdd/REWRITE/door-spike.md`. A failure stops the plan and goes to Shyden.
- [ ] **Step 4 (PROD, his approval):** the zone's free rate-limiting rule over both door hosts (per IP, 10 s), threshold from Step 3's measured rate. Measure whether a blocked request counts as a door invocation; record it under decision 197.
- [ ] **Step 5:** The daily door count (decision 197): a scheduled workflow in a `prod-cron` environment (`main` only, read-only Account Analytics token), dispatched `--ref main`, writes each door's past-day requests to the job summary and opens an issue for ShydenMcM when TEST passes 20,000, DEV 10,000, or the read fails.
- [ ] **Step 6:** Delete the echo Worker and its Durable Object; read back both gone.

### Task 11: The design and plans move into the repo

- [ ] **Step 1:** Copy the design to `docs/superpowers/specs/` and plans 1 and 2 to `docs/superpowers/plans/`; edit the design's "Home" line; mark links to the decisions file as a private working record.
- [ ] **Step 2:** Grep the copies for IPv4 addresses, 32-hex account ids, colon-separated fingerprints, 10-character Apple key ids and e-mail addresses; remove or justify each in the PR body.
- [ ] **Step 3:** Docs PR, one commit, docs-only fast path, merge.

### Task 12: Tell repo-template what ShyTalk needed

- [ ] **Step 1:** Never write to repo-template. If any task above had to add something the slim template lacks (Task 2 Step 1's context pin, Task 2b's fast path, Task 6's licence check, Task 3's board script; pass 4 found the first three missing at `8018a7e0`), and that its own files cite their issues as bare `#N`, so every copy has to rewrite them (decision 201), send ONE labelled message to repo-template's session listing them, so it files them on its own board. Nothing to send: skip.

### Task 13: Close-out

- [ ] **Step 1:** Close the plan 2 epic once every story is closed and verified. Run `board-progress.ts`, write the handover, `PushNotification`, "safe to `/clear`" with both progress lines.
