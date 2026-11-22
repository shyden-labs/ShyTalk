# The app shell: design (plan 6, epic #11)

Date: 2026-11-22. Parent design: `2026-10-24-shytalk-rewrite-design.md` (sections 4.1, 4.2, 4.7, 4.9, 4.11, 4.13, 4.16, 4.17). Status: approved by Shyden, 2026-11-22.

## 1. Intent and why

The first ShyTalk app that testers install. It ships as an update to the store app (`com.shyden.shytalk`, Android `versionCode` above 178), with the new brand (#273). A tester can agree to the data notice, create an account, sign in, and set up a profile that says who they are and which languages they speak and are learning. Every screen is drawn by the app but arranged and worded by the server (the 2026-10-20 "app draws, server decides" ruling). Rooms and talking come in plans 5 and 7.

Why this scope (Shyden, 2026-11-22, chosen from options): every later plan (rooms, people, moderation) needs a signed-in member with a profile to test against. Testers should meet ShyTalk's purpose (language exchange) on the first build, not an empty frame. And the server-drawn screens are built once, the way launch needs them, so plans 7-10 add parts instead of converting hand-coded screens.

## 2. Goals, non-goals, anti-goals

**Goals**

1. One React Native + Expo app for Android and iPhone, installable on DEV by a local build and on TEST through TestFlight and Play closed testing.
2. The consent screen (4.2 step 1, #142) before anything about the person reaches the server.
3. Sign-up and sign-in: Google, Apple, email code (sign-up and recovery only), passkey (#166), authenticator code and recovery codes as backups, opening already signed in afterwards (#134 AC5, app side).
4. Date of birth at sign-up (decision 13).
5. A profile: name, description, self-chosen country flag, age "N years old" with a hide switch, numeric user ID, the languages the member speaks and is learning, profile photo and cover image. View and edit.
6. Profile photos and covers checked automatically on the server for every age; location data stripped; a suspected image waits for Shyden's review, shown to others as "pending review" (5.5; Shyden 2026-11-22, replacing 4.9's under-18 pre-approval).
7. "Server decides" Part 1 and Part 2 (4.11): the document's wording, colours, sizes, menus and switches, plus whole screens arranged from a closed catalogue of the app's parts; start-up from the last copy; live changes within 10 s p95 (#129); rollout and undo through the existing publish path; the version floor with an "update to continue" screen.
8. The instant recovery alert on every other signed-in device (#169).
9. 5 languages, WCAG 2.2 AA, every size class and fold state (4.13).
10. Signed builds from CI (#35, #36).

**Non-goals (in later plans)**

- Rooms, the room list, voice, chat (plans 5, 7).
- Following, followers, blocking, the in-room card, notifications other than the recovery alert (plan 8).
- Parent consent, ID checks, country placement, the country rules table (plan 9).
- Reporting, moderators, the staff area beyond the photo review queue (plan 10, #310).
- The photo block list (plan 10, Shyden 2026-11-22): a person asks through the support desk (ShyDesk) for their personal photo to be blocked; staff add its fingerprint. Anyone else uploading it is refused automatically and the admins are alerted with the uploader's account. The account that asked for the block can still use the photo. Existing copies are replaced by the walk-back in 5.5, and each affected member is told their image was reset and why, never who asked for the block. Pictures removed by a moderator are fingerprinted the same way (4.9).
- SuperShy (VIP) members keeping up to 10 earlier images (5.5): no paid tier exists in the rewrite yet; designing it is #312.
- The website's member pages for profile and settings (4.12): later, with plan 8.
- HarmonyOS and maker-channel push (decision 61).

**Anti-goals (a failure even if it works)**

- Anything that reads as dating: no "looking for", no relationship status, no gender filter, no photo-first browsing of people. The profile is about languages and culture.
- The app deciding anything the server must enforce (the floor, photo approval, age side, every rule). The app's copy of the document is never trusted for a decision.
- A document change that throws someone out of what they are doing: it never clears typed text, closes a sheet, or moves them to another screen.
- A clock: no poll or heartbeat on a quota'd service while nothing changes (the 2026-10-22 rule).
- A fake fallback in any test (the 2026-10-31 rule).

## 3. Constraints

- Expo SDK 58 / React Native 0.88 (newest on 2026-11-22: `expo` 58.0.26, `react-native` 0.88.1), TypeScript, in this repo as an npm workspace beside `apps/web`.
- Cloudflare Free plan, budget up to US$10 a month for all environments (4.17). The Oracle Always Free server for anything Workers cannot run.
- The server half already on DEV: email code (#133), passkeys, authenticator codes and recovery codes (#134), sessions that never expire by age (2026-11-08 ruling), Google and Apple sign-in routes, the UI document (`packages/ui-document`, `workers/web/src/app/ui.ts`), the version floor and the `Announcer` live channel (`GET /api/app/live`).
- Accounts are created on the app and on the website (decision 60 as changed 2026-11-10).
- Global rules: strict TDD; unit tests under 1 s with no network or process; one test suite run unchanged on every phone; real input only; every translation read back by Google before it is shown; licences (no GPL/AGPL/SSPL in anything the app or server links or ships).
- Prod credentials only in the `production` environment with Shyden as reviewer; dev can never deploy prod.

## 4. Approaches

**What the first build lets a tester do** (Shyden's pick from three):

- Bare shell, no accounts (about 20 points): soonest, little to try; plan 7 would add sign-in.
- **Shell, sign-in and profile (picked):** a real member with a real profile.
- Shell and sign-in only: no profile until plan 8.

**Profile photos** (Shyden's pick from three): a text-only profile with photos later; **text profile plus photos, with the image check built here (picked)**; text without a languages field. Shyden chose photos now so testers see a complete profile, accepting that this plan builds the check service.

**How much of "server decides"** (Shyden's pick from two):

- **Part 1 and Part 2 now (picked):** the catalogue renderer comes first and every screen in this plan is server-arranged. Each screen is built once.
- Part 1 now, Part 2 later: smaller now, but every screen from plans 6-10 is converted later.

## 5. What is decided

### 5.1 The app project

- `apps/app`, an Expo SDK 58 app with a development build (not Expo Go), TypeScript strict, Hermes.
- Builds run on GitHub Actions (free runners on a public repo), not EAS Build (my call): `expo prebuild` then Gradle and Xcode. DEV builds are made on this Mac for the phone tests, from the exact commit (the 2026-10-20 ruling: no tester build carries the persona password). TEST builds go to TestFlight and Play closed testing from CI, signed with #35's and #36's keys from the `production` environment.
- The app talks to one API base per build: DEV and TEST at their `workers.dev` addresses for machines, and the people-facing doors for testers' builds (decision 197: machines skip the doors).

### 5.2 Server decides, Part 2

The document's `schemaVersion` moves to 2 and gains `screens` (reserved since plan 4):

- **A screen** is a named route (from a list in reviewed code, as `MENU_ROUTES` is) with a layout tree.
- **Layout parts** form a closed catalogue in `packages/ui-document`: `column`, `row`, `card`, `text`, `image`, `button`, `list`, `spacer`, `divider`. Each takes only design tokens and copy keys, never raw colours or raw text.
- **Native blocks** place a whole native feature as one node: for this plan `consentNotice`, `signInMethods`, `emailCodeForm`, `dateOfBirthPicker`, `passkeySetup`, `profileHeader`, `profileEditor`, `photoPicker`, `languagePicker`, `deviceList`, `recoveryPending`. A block owns its own state and calls to the server; the document says only where it goes and which of its options are on.
- **Data in parts** comes from named bindings in reviewed code (`member.name`, `member.ageText`), never expressions in the document.
- **Actions** are a closed list: open a route, open a sheet, go back, run a named block action. The server cannot invent a new behaviour.
- **An unknown part or block** (a newer document on an older app) draws nothing, and its siblings still draw.
- **Sealed screens** (ban, suspension, update to continue, App-Lock, unsafe device, delete account) are built into the app, never arranged by the document, and opened only by the server's verdict.
- **Publishing refuses** a document that breaks the schema, names a missing part, block, binding, route, token or copy key, places a sealed screen, or lacks any of the 5 languages. Every wording change is read back by Google Cloud Translation before it is published.

**Start-up:** the app opens from the last good download, or on first launch from the copy built into the app (generated from `manifests/` at build time). The fresh fetch never blocks the first paint.

**Live while open:** the app holds `/api/app/live` open while in the foreground (hibernating Durable Object, no idle charge). On `{"type":"ui","version":N}` it fetches with `If-None-Match` and applies on the next draw of what is visible. Reconnect uses the runtime's events, never a timer poll. Measured against #129's p95 of 10 s on both phones.

**Version floor:** a request below the floor gets one distinct refusal; the app shows only the update screen. Moving the floor by hand works first. The automatic store check waits for the store keys (#35 and an Android publisher key).

### 5.3 Screens in this plan

1. **Consent** (#142): each purpose on its own line, the privacy policy and terms in the member's language (Indonesian pages for `id`, English otherwise, per #56). Each consent is stored with its time, policy version and language. Refusing closes the app with nothing kept.
2. **Sign-up:** Google, Apple or email (address, then code), then date of birth, then the first sign-in method (a passkey, offered first; or an authenticator), then 10 recovery codes shown once.
3. **Sign-in:** passkey, Google, Apple, authenticator code, recovery code. Lost everything: email recovery with its 24-hour wait (#133).
4. **Home:** a welcome screen arranged by the server, with "rooms are coming" until plan 7.
5. **Profile:** view and edit (5.4).
6. **Settings:** app language, sign-in methods (add, remove, with the step-up proof of the 2026-11-16 ruling), signed-in devices (list, revoke), sign out.
7. **Recovery pending** (#169): opened from the alert; cancels exactly as #133's cancel does.
8. **Photo review queue** for images the check suspects, any age (5.5), visible only to accounts the server says may review: Shyden alone until plan 10. Its website staff module (4.8: every staff tool exists in both places) comes with plan 10's staff modules, before either reaches production (my call).
9. Sealed screens: update to continue, suspended, banned (the last two drawn from the server's verdict, filled in by plan 10).

### 5.4 Profile

- **Name** (display name, not unique), **description** with "show more", **country flag** chosen by the member, **age** "N years old" with a hide switch, **numeric user ID** given by the server at sign-up.
- **Languages:** "speaks" and "learning", each from one fixed list of languages with a level for learning (beginner, intermediate, advanced). Language names come from CLDR data shipped with the app, already translated into the 5 app languages (my call). This means the names are not hand-written translations. The read-back covers only our own words.
- **Photo and cover:** 5.5.
- Server-side limits on every field. The server alone decides what other members may see (plan 8 shows it to others; this plan shows it to its owner).

### 5.5 Photos

- The app asks the server for an upload slot, then sends the image to the Worker, which stores it in the environment's R2 bucket (`apac`).
- The server re-encodes every image (which strips location and all other metadata) and sends it to the **image check service** on the Oracle server.
- The check service is a small self-hosted image classifier (my call: a permissively licensed model and runtime, licence read from the source before use; candidates are named in the plan, not here, because none has been checked yet). It answers only "flagged" or "clear" with a score. It keeps nothing.
The rules below are Shyden's, 2026-11-22. They apply the same way to profile photos and covers, for every age.

- **What is checked:** anything against the community standards that a model can detect, such as nudity, sexual content and violence (gore, weapons pointed at people). The check answers "clear" or "suspected" with its categories and scores.
- **Clear:** shown at once. No one approves photos beforehand, under-18s included.
- **Suspected:** goes to the review queue (5.3 item 8), and Shyden reviews it then. Until he does, other members see a "pending review" placeholder in its place, never the image. The member cannot change that image (photo or cover) while it is pending.
- **Cleared on review:** shown, and the member can change it again.
- **Rejected on review:** the member's previous image comes back by the walk-back below. The member is told the image was removed and which community rule it broke. The rejected image is deleted and only its fingerprint is kept (4.9).
- **The walk-back:** restore the member's previous image, skipping any that is blocked or rejected. If none is left, show the ShyTalk stock image.
- **Earlier images kept:** only the one before the current image, for the photo and the cover each (Shyden). SuperShy (VIP) members would keep up to 10, but no such tier exists yet (non-goals). The limit is a per-member server setting, so a tier can raise it later. Earlier images are deleted with the account, and the privacy policy says so.
- Images are served through the Worker with the member's session, never from a public R2 address.

### 5.6 Date of birth

Asked at sign-up and stored on the account; it sets the age side (13-17 or 18+). Under 13 is refused (decision 66). Everything else in section 4.3 (country placement, local minimum ages, parent consent, ID triggers, turning 18) stays in plan 9. A 13-17 tester can set up a profile but nothing more, which is what decision 70 allows before consent. No build leaves closed testing before plan 9 lands, because the release (plan 12) comes after it (my call, settled in the builder check).

### 5.7 The recovery alert (#169)

- While the app is open, it hears on its own live channel (a per-member hibernating Durable Object, or the `Announcer` extended with signed-in sockets; the builder measures and picks).
- While the app is closed, Expo push (decision 61's choice) sends the alert. Android delivery goes through Firebase Cloud Messaging, using the old app's two existing Firebase projects as the push pipe only (Shyden, 2026-11-22): its dev project serves DEV and TEST, its prod project serves PROD. No Firebase database, sign-in, storage or hosting is used. Before either is repurposed, the data the old app left in it is listed, then cleared with Shyden's approval at the time (the old app never had real users, per the 2026-10-28 ruling). iPhone delivery needs an APNs key from Shyden's Apple account. Push registration is built here only for this alert; plan 8 builds the rest.
- An offline device is told when it next connects, unless the recovery has ended. Nothing runs on a clock while no recovery is pending.

### 5.8 Languages, accessibility, sizes

As 4.13: 5 languages from the first build; VoiceOver and TalkBack, the largest text size, AA contrast, 44-point targets, labels on every control, reduced motion; layouts chosen by size class (600 / 840 dp, as the spike measured), never by device, including the iPhone Duo folded and unfolded and iPad Split View.

### 5.9 Testing

- Unit: the document schema and validation, the renderer's decisions (what draws, unknown parts, bindings), the floor verdict, every block's logic with its server calls stood in.
- Integration (CI): the Worker's new routes (profile, photos, consent, push registration) against real D1 and R2, and the check service against the real model.
- Phones: one suite, run unchanged on the OnePlus and the iPhone Air by real touches, and on the simulators for the iPhone Duo and iPad. Journeys: consent then sign-up then profile; sign-in with each method; a document change appearing on both open phones (#129's measurement); first launch in flight mode; an old build refused; a recovery started from another device (#169).

## 6. Left to the builder

- The test runner for the app's unit tests (Vitest if it renders React Native components within the 1 s limit, else `jest-expo`), measured in the plan's first task.
- Navigation library (Expo Router or React Navigation) and state management.
- The phone test driver for the native app (Appium for both phones, as the iPhone Safari tests already use it, or another, licence checked).
- The image model and its runtime, after the licence read.
- The live channel for #169 (5.7).
- Libraries for Google and Apple sign-in and passkeys in React Native, each licence checked.

## 7. Risks

| Risk | What happens |
|---|---|
| Part 2's catalogue grows faster than plans 7-10 need | The catalogue holds only what this plan's screens use; each later plan adds its own parts with tests. |
| The image model is weak or too heavy for the free Oracle server | Measured in the plan on real test images; if it fails, it goes to Shyden with the measured options. |
| Push needs the repurposed Firebase projects cleared and an APNs key | The clearing waits on Shyden's approval at the time, and the APNs key on his Apple account; #169's closed-app half waits on them, the open-app half does not. |
| Native passkeys need the Play signing certificate and Apple Team ID (#166) | Outside waits on Shyden's consoles. |
| Native Google and Apple sign-in need an Android and iOS OAuth client (Google Cloud) and the Sign in with Apple capability | Outside waits on Shyden's consoles; email code and passkeys work without them. |
| #129 misses 10 s p95 on a phone | Goes to Shyden with Expo push as the measured alternative (#129 AC3). |
| Store review of server-arranged screens | The screens are built from native parts shipped in the app (no web pages, no downloaded code), which is the reason for the 2026-10-20 choice. |

## 8. Calls I made (for Shyden to check)

1. Date of birth at sign-up comes into this plan (needed for the age line and the age side).
2. The consent screen (#142) comes into this plan.
3. Builds on GitHub Actions, not EAS Build.
4. Languages spoken and learning are on the profile (not in the parent design), with CLDR names.
5. Until plan 10, Shyden alone works the photo review queue; its website staff module comes with plan 10.
6. Uploads go through the Worker, and images are served only to signed-in members.
7. The website's member pages wait for plan 8.
