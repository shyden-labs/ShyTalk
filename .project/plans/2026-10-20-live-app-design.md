# The live app: the app draws, the server decides (design, 2026-10-20)

**Status:** approved by Shyden, 2026-10-20. **Revises** the server-driven UI
design of 2026-08-17 (`.project/plans/2026-08-17-server-driven-ui-design.md`,
EPIC-0011). Everything in that design stands unless a section below replaces
it; each replacement names what it replaces.

## 1. Intent

Shyden, 2026-10-20 (critical, "ASAP"):

> "updates are applied live immediately to everyone. At first launch the app
> would download resources from the server and if we changed anything it would
> automatically be applied to everyone in the app, no need for them to
> download a new version of the app and ensures users cannot use an older
> version to bypass certain things. everyone is always on the same versions of
> everything. [...] it will also help as you won't need to keep rebuilding the
> app to perform testing."

Four outcomes, in his words: changes reach **everyone, live**; **no app
download** for a change; **no bypass with an older version**; **testing
without rebuilding the app**.

## 2. Decisions (Shyden, 2026-10-20, each chosen from written options)

| # | Decision | Replaces (2026-08-17) |
|---|----------|-----------------------|
| D1 | **The app draws, the server decides.** The app keeps its built-in native parts (buttons, lists, chat, voice rooms). The server decides what shows, where, the wording, colours and which features are on. Not web pages inside the app. | Confirms C1 |
| D2 | **Old versions are locked out** once a new app version can be downloaded from **both** the App Store and Google Play; older apps show only "update to continue". The server refuses them and checks every rule itself. | Extends §6.3 `minAppVersion` |
| D3 | **Within seconds, even while the app is open.** The server tells every open app that something changed; the screen updates by itself. | §4.2 "applies on the next natural recomposition" (launch-only) |
| D4 | **Open instantly, then update.** The app opens from its last download (or the copy built into the app on the very first launch), then switches to the latest within seconds of reaching the server. | Confirms §4.2's three tiers |
| D5 | **Everyone at once by default; gradual rollout allowed too**; one action undoes a change for everyone. | §SHY-0317 "Reach 5% before you reach everyone" as the default |
| D6 | **Both parts before launch**: Part 1 (looks, menus, wording, colours, switches) first, then Part 2 (the server arranges whole screens out of the app's parts). | §1 "Phase 2 not in MVP" |
| D7 | **The EPIC-0004 wait is over**: its start-up work is Done (7 of 9 stories); SHY-0146 and SHY-0189 do not gate this. | §9 / decision 6 |
| D8 | **Top priority, ahead of everything** ("because we are not currently live anyway"), after the group-fix code (SHY-0653, SHY-0652) is merged to dev. Phone walks and the hotfix release happen when Shyden is ready. | EPIC-0011 P1 |
| D9 | **Accepted limit:** a brand-new *kind* of part the app has never had needs one app update. | (new) |
| D10 | **The store check is automatic, with a button as backup** (§4.5). | (new) |
| D11 | **A gradual rollout reaches named people first** (Shyden and the test accounts), then optionally a share, then everyone (§4.4). | SHY-0317's random 5% first |

**Why D1 and not web pages** (measured 2026-10-20 at the primary sources):
Apple 2.5.2 forbids apps that "download, install, or execute code which
introduces or changes features or functionality"; 4.2 rejects a "repackaged
website"; 4.7.2 forbids web mini-app code from using native abilities (the
microphone, for voice rooms) "without prior permission from Apple". Google Play
allows "JavaScript in a webview" but forbids an app updating itself outside
Play. No web version of the app's features exists today (the site holds only
legal pages, the roadmap, the portal and admin), so web pages also meant
rewriting every screen.

**Kept from 2026-08-17, unchanged:** the five sealed screens (§6.1: ban and
suspension, App-Lock, cohort segregation, unsafe device, account deletion);
the server as the real control (§6.2); fail-safe parsing and publish-time
validation (§6.3); publishing through git and a curated admin UI sharing one
pipeline (§7, §14.3); 20 locales (C5); API-only delivery (C3); $0 hosting with
ETag/304 (C2).

## 3. Goals, non-goals, anti-goals

**Goals**
- G1: an operator change on dev appears on a real Android phone and a real
  iPhone, both open, within seconds, with no reinstall (the epic's proof).
- G2: the same on production, after Shyden approves the publish.
- G3: an app older than the version floor cannot use any API, and shows only
  "update to continue".
- G4: every rule a screen shows is also enforced by the server or the database
  rules (the SHY-0653 lesson: a mute the app shows but the rules ignore is no
  mute).
- G5: every future ticket says what the server decides in it.

**Non-goals**
- Web pages or downloaded code of any kind inside the apps.
- Server control of the five sealed screens.
- The website consuming the document (August §14.1 stands: apps first).

**Anti-goals** (a failure even if it "works")
- A server change that blanks, crashes or traps a screen.
- A change that throws someone out of a voice room or loses what they typed.
- Two people on the same version seeing different things outside a chosen
  gradual rollout.
- A rule enforced only by the app.
- A production change published without Shyden's approval.

## 4. How it works

### 4.1 The document

One versioned document per environment (dev, prod), served by the Express API
(`GET /api/ui-manifest`, August §4.3), cohort-resolved, ETag/304.
- **Part 1** sections: navigation and menus, design tokens (colours, sizes),
  feature switches, copy in 20 locales.
- **Part 2** section `screens`: layout trees over a closed, versioned catalogue
  of the app's parts (`column`, `row`, `card`, `text`, `image`, `button`,
  `list`, `spacer`, ...) plus **native blocks** (`voiceRoom`, `chatThread`,
  `gachaReel`, ...) that place a whole native feature as one node. An unknown
  node draws nothing while its siblings still draw (August §12).
- Part 1 reserves the `screens` key and `schemaVersion` so Part 2 adds without
  rewriting.

### 4.2 Start-up (D4)

Unchanged from August §4.2: last good download → built-in copy (generated from
`manifests/` at build time) → the fresh fetch, which never blocks the first
paint. The built-in copy is regenerated every release so a first launch is never
far behind.

### 4.3 Live while open (D3)

The server announces "document version N is out" to every open app; the app
then fetches with `If-None-Match` and applies. **Builder's constraints**: one
mechanism on both phones; measured p95 from publish to on-screen at or under
10 s on dev (my call for "within seconds"); inside the free tier (the
announcement is one small message per change, never per person per minute);
no direct Firestore read of the document itself (C3). The mechanism (a push
data message, a single-document listener on a version marker, or a stream from
the API) is the builder's choice, decided by measuring cost and delay on both
phones, recorded in the plan.

**Applying on an open screen (my call):** a change applies on the next draw of
what is visible. It never closes a voice room, a call or a sheet the person is
using, never clears typed text, and never moves the screen they are on to a
different route; a removed route takes effect when they leave it.

### 4.4 Rollout and undo (D5)

Default: everyone at once. Optional per publish, in this order (Shyden, Q2):
**named people first** (Shyden and the test accounts, a list kept in the admin
panel), then optionally **a share** of everyone, bucketed stably per person
(August SHY-0317), then **everyone**. Undo republishes the
previous version to everyone, through the same pipeline. The rollback drill
(August SHY-0317) is executed on dev and recorded.

### 4.5 Version lockout (D2)

- The server holds a **version floor** per platform. A request from an app
  below it is refused by the API with one distinct status and code; the app
  shows only the update screen, drawn first from the verdict it already holds
  (SHY-0516). The database rules refuse it too, so a direct write cannot skip
  the floor (SHY-0614 PR 3's `minVersionCode` is the same mechanism and is
  folded in).
- The floor moves to a release's version once it is downloadable in both
  stores (Shyden, Q1: **automatic, with a button as backup**). The server asks
  App Store Connect and the Google Play Developer API and moves the floor by
  itself once both show the release available; an admin-panel button ("this
  release is in both stores") moves it by hand whenever a key is missing or
  Shyden wants to act first. The Apple key is the `.p8` that SHY-0151 waits
  on, so the button works first and the Apple half of the automatic check
  lands when that key exists. Each store key lives in a branch-restricted
  environment, never as a repo secret (standing rule).
- Tester builds follow the same rule against the testing channels (Firebase
  App Distribution, TestFlight) on dev (my call).

### 4.6 Making a change

Through `manifests/` in git or the curated admin forms, one pipeline (August
§7). Dev publishes on merge to `develop`. **Production publishing is a path to
production, so it needs Shyden's approval** (the standing rule: every
environment holding a production credential has ShydenMcM as required
reviewer). Every wording change is read back by Google Cloud Translation in
every locale before it is published (standing rule). Publish-time validation
refuses a document that breaks the schema, names a missing part, icon, route
or translation, or reaches a sealed screen.

## 5. Testing

- Unit (commonTest): parser, fail-safe fallbacks, the decision of what to draw,
  version-floor verdicts, bucketing.
- API and rules tests: the endpoint, ETag/304, the version floor refusal on the
  API and in the rules, cohort resolution.
- Journeys (one definition, both phones): edit the dev document and watch both
  open phones change within the limit; airplane-mode first launch; an older
  build refused and shown the update screen; the rollback drill.
- Testing without rebuilding (G1) is itself an acceptance check: a dev journey
  changes a screen with no new build installed.

## 6. Every future ticket

Built, not remembered (August §11, never built: checked 2026-10-20, no trace
in the checker, the template or the code):
1. A required story section, **"Server decides"**: what in this story the
   server decides; anything kept native names its reason. Enforced by
   `scripts/check-story-frontmatter.sh` (with a planted-miss test).
2. A section in ShyTalk's CLAUDE.md stating the model. (Read 2026-10-20: the
   checkout's `CLAUDE.md` is untracked; the plan settles where the committed
   copy lives.)
3. A sweep of every Draft story that adds or changes UI, each re-scoped before
   pickup.
4. Every new rule a screen shows comes with its server or rules enforcement
   in the same story (G4).

## 7. Impact on EPIC-0011's stories

| Story | Change |
|-------|--------|
| SHY-0310 schema | Reserve `screens` and `schemaVersion` for Part 2; add the version floor fields. |
| SHY-0311 sealed set | Unchanged. |
| SHY-0312 endpoint | Unchanged, plus the version-floor refusal. |
| SHY-0313 three tiers | Plus D3 (live while open); the EPIC-0004 dependency is removed. |
| SHY-0314, 0315, 0316 | Unchanged. |
| SHY-0317 rollout | Default everyone at once; share-first optional; undo kept. |
| SHY-0318, 0319 publishing | Plus Shyden's approval on every production publish. |
| SHY-0320 spike | Unchanged; runs first (it sizes the theming work). |
| **New** | The live channel (D3); the version lockout (D2, absorbing SHY-0516 and SHY-0614 PR 3's floor); the future-ticket mechanism (§6); a new epic for Part 2 (renderer, catalogue, native blocks, its test apparatus), MVP. |

All EPIC-0011 stories and the new ones become P0 (D8). Estimates are re-scored
from measurement when the plan is written.

## 8. Questions settled in the builder check (Shyden, 2026-10-20)

- **Q1. How do we know a release is in both stores?** Automatic, with a
  button as backup (§4.5).
- **Q2. Who sees a gradual rollout first?** Named people (Shyden and the test
  accounts), then optionally a share, then everyone (§4.4).

**Calls I made (marked "my call" above), for Shyden to check:** "within
seconds" measured as p95 at or under 10 s; a change never interrupts what
someone is doing on screen; tester builds follow the same version floor on
dev; the live-channel mechanism is chosen by measurement in the plan.

## 9. Risks

| Risk | Mitigation |
|------|-----------|
| A bad change reaches everyone in seconds (D3 makes August's risk faster) | Publish-time validation; dev first; Shyden's approval on prod; undo for everyone; the rollback drill |
| Apple reads Part 2 as "changing features" | Data only, interpreted by parts shipped in the binary (the pattern Airbnb, Spotify and Lyft ship); no new kind of part without an app update (D9) |
| The live channel costs money at scale | Measured against the free tier on dev before production; one message per change |
| A floor locks out people the store has not reached | The floor moves only once the release is in both stores (D2, Q1) |
| Part 2 grows without end | The catalogue is closed and versioned; native blocks keep complex features whole |
