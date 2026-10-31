# ShyTalk rewrite: app, server and website (design, 2026-10-24)

Status: APPROVED by Shyden, 2026-10-24 ("Approve", decision 96). Nothing is built until he approves it
(decision 33: he approves this design himself; it is never self-approved).
Every "decision N" below is recorded with Shyden's own words in
`decisions-2026-10-24.md`, a private working record that is not in this
repository. Anything marked **(my call)** was chosen by me, not him, and he
can overrule it.

Home: `docs/superpowers/specs/` in shyden-labs/ShyTalk, moved here on
2026-11-01 from the old repo's git-ignored `.superpowers/` (plan 2 Task 11).

---

## 1. Intent and why

ShyTalk is a friendly place to learn languages and cultures by talking:
voice-and-text chat rooms, with adults and under-18s kept apart. It is never a
dating app (project guardrail; SHY-0359 precedent).

The old app was never released. Its iPhone and Android versions never matched
and bugs kept coming back (decision 7), because the data layer was written
twice (31 Android-only and 60 iOS-only files) and the screens are drawn by
different engines. Shyden: "i want a re-write, not a port. basically we are
going to start again but properly this time" (decision 6). The rewrite covers
**everything**: app, server and website (decisions 4, 27).

Success: a **releasable basic chat-rooms app** (the core) that behaves the same
on every phone and screen size, runs for free, follows each country's law, and
keeps trouble-makers out after a ban. Everything else comes after (decision 7).

## 2. Goals, non-goals, anti-goals

**Goals (the core)**
- Sign in, browse rooms, join and talk by voice and text (decisions 9, 44).
- Anyone can start a room (decision 9).
- Adults and 13-17s in separate worlds: rooms, lists, following (decisions 40, 68).
- Following, profiles, blocking, reporting (decisions 37-49; Viewers removed, decision 152).
- Moderation by a team, from the app AND the website (decisions 50-53).
- The protections Shyden has needed in real life (decisions 57, 58): ban
  evasion, emulators, doxxing, threats, offensive or stolen photos.
- "Server decides": changes reach everyone live, with no app update, and old
  versions are locked out (section 4.11).
- iPhone, Android, iPhone Duo, iPads, Android tablets and foldables from day one
  (decisions 3, 8).
- 5 languages: English, Indonesian, Thai, Vietnamese, Chinese (decision 56).
- Free to run: idle cost 0; nothing on a clock unless approved (decision 75;
  global rule).

**Non-goals (later features, not in the core)**
- Picking languages, language tags on rooms (decision 44: needs its own design).
- Private messages, gifts, coins, wallet, backpack, gacha, groups, Super Shy
  badges, event pages (decisions 47, 55).
- A "hide which room I'm in" option (decision 42).
- The HarmonyOS NEXT version (decision 61).
- Pictures in chat (decision 58).

**Anti-goals (a failure even if it works)**
- Anything that reads, feels or works like dating (project guardrail).
- iPhone and Android behaving differently.
- A banned trouble-maker getting back in on a new account (decisions 57, 58, 61).
- Innocent mainland-China users being blocked (decision 59).
- Anyone but Shyden seeing an ID; any ID, selfie or face data being kept
  (decisions 11, 12, 83).
- A paid service or bill appearing (decision 75).
- Anything moving over from the old app (decisions 31, 85).

## 3. Constraints

- **Free.** Every service is on a free tier or self-hosted. Free limits fail
  rather than charge; alert before reaching them (decision 28). Anything on a
  timer that uses a quota needs Shyden's approval first. The only approved one
  is the monthly GitHub job in decision 72.
  **At a limit (my call, builder check):** Cloudflare's own daily caps stop
  the whole API when hit, so we stop short of them ourselves. At 80% of any
  daily free allowance, Shyden is alerted. At 90%, new sign-ups and new rooms
  pause with a friendly "ShyTalk is busy, try again later", while existing
  rooms carry on until the daily reset. The plan measures requests per active
  user on dev and states the resulting capacity. Moving to a paid tier is
  Shyden's decision when growth asks for it.
- **Shyden is the sole operator, in Indonesia.** Indonesian law comes first:
  the PDP Law UU 27/2022, GR 33/2026 (in force 2027-01-16) and PP Tunas
  GR 17/2025 for child safety.
- **Regions at launch** (decision 76): every country except the EU, the UK and
  mainland China. Each of those opens only when a trusted person living there
  agrees in writing to be the unpaid legal representative. The country rules
  table carries a "representative in place" flag per region, and that flag
  controls listing.
- **First release = everything here EXCEPT the China-only parts** (Shyden,
  2026-10-24, decision 91). Deferred until China opens: phone-maker
  notification channels, the China consent screen, mainland speed tests, the
  website Android download, and the Huawei HUKS and hardware-key-attestation
  checks. Until then, phones without Google sign up with the text-message
  check.
- **Every launch country gets a researched rules row before release**
  (Shyden, 2026-10-24, decision 93). That's about 190 rows, each drafted from
  the law's own text and approved by Shyden. This is a release gate.
- **China must work when it opens** (decisions 59, 61): no mainland company and
  no ICP filing. iPhone through the App Store; Android as a download from our
  website. Sign-in by Apple or email code (Google is blocked there).
  Notifications through each phone maker's channel. Speed measured from
  mainland networks before China opens.
- **The project's standing rules apply** (the global CLAUDE.md): TDD, the unit
  limits, one test running on both phones, real-phone sign-off before release,
  every translation read back by Google Cloud Translation, Swagger for every
  API, and the rest.

## 4. What is decided

### 4.1 Technology (decisions 5, 27, 28)

| Part | Choice |
|---|---|
| App | React Native + Expo SDK 58 (RN 0.88), TypeScript, a single codebase for both phones |
| Main server and website | Cloudflare Workers; **one Durable Object per room** (seats, presence, chat, every room timer as an event-driven alarm); D1 database; R2 storage; Free plan |
| Voice | Self-hosted LiveKit (Apache-2.0) on an Oracle Always Free server |
| Sign-in | Better Auth (MIT, self-hosted): Google, Apple, email codes; email sent through Brevo's free tier |
| Push | Expo push; phone makers' channels for Android phones without Google (decision 61) |
| ID check | Our own service on the Oracle server (section 4.3) |
| Number check | Users text a code to our own Android gateway phone running textbee (MIT); libphonenumber for number types (decision 77) |

**Spike first, throwaway** (decision 5, updated): prove RN 0.88 and Expo SDK 58
on the iPhone Duo, Expo App Integrity (alpha), LiveKit React Native, and the
last-minute voice buffer on both phones (section 4.8). Maker-channel push is
spiked when China opens. Decision 5's "App Check
in React Native Firebase" no longer applies, because there is no Firebase.

### 4.2 The core journey

1. **Consent screen before anything else** (decision 78, my call). In plain
   words, it says the person's data is handled on Cloudflare's worldwide
   network and stored mainly in the Asia-Pacific region, outside their
   country, and gives the reason and the risks
   (GR 33/2026's duty to inform). Mainland China gets its own separate consent
   (PIPL Art. 39). Nothing about the person reaches our servers until they
   agree. Refusing means the app can't be used, and nothing is kept.
2. **Sign in** with Google, Apple or an email code (decision 10). The app opens
   already signed in after the first time. **Accounts are created only in the
   app on a phone** (decision 60). The website only signs in existing accounts.
3. **Genuine-phone check and age/country placement** (sections 4.3, 4.4).
4. **Browse rooms, join, talk** (sections 4.5, 4.6).

### 4.3 Age, country, parent consent, ID

- **Minimum age 13 worldwide; local law wins** (decision 66). ShyTalk counts as
  social media. Under-18 side = 13-17, one side, no split by band (decision 68).
- **Country:** the store the app came from. If that's unknown, the SIM card's
  country. If that's unknown too, the app asks for location access with a plain
  explanation (decisions 66, 73). If location is refused, the strictest rules
  of any country apply, with a note that allowing location may relax them
  (decision 67).
- **Country rules table** (decision 72), kept by us and edited only by Shyden
  in the staff tools. Each row holds the law's name, a source link and the date
  last checked. A country with no row gets the strictest rules. A monthly
  GitHub job opens an issue listing rows not checked in 6 months, and also
  watches whether Indonesia has published its adequacy list or standard clauses
  (decision 78). A release is blocked while any row is past its check date. We
  lean on Apple's and Google's own regional handling, so the table covers only
  what the stores don't.
- **Date of birth at sign-up places everyone** (decision 13). An ID is asked for
  only when a trigger makes it necessary (decision 14):
  - a date-of-birth change, especially from under 18 to adult
  - an adult account signing up on a device that had an under-18 account
  - an adult-side member reported as "Seems to be under 18"
  - many reports, or a moderator flag
  - the typed date of birth disagreeing with the store's age band (decision 73)
  - a strict-law country with no store age band (decision 71)

  No selfie age estimate, ever (decision 14).
- **Suspected adult on the under-18 side** (decision 15): the first report
  suspends the account at once; an admin releases it after the ID verifies.
  Later reports of the same person go to an admin, with no automatic
  suspension. If the ID shows an adult (decision 16): a permanent ban plus a
  device ban, and the case goes to the authorities queue with its evidence
  preserved (decision 17; NCMEC CyberTipline plus the child's local body;
  Shyden files the report himself).
- **Parent consent, layered** (decision 69):
  1. The phone's family controls when they exist: Apple Declared Age Range +
     PermissionKit, or Google Play Age Signals.
  2. Otherwise the parent confirms by email or text, with a follow-up.
  3. Where the law demands verified consent, the parent also passes our own ID
     + selfie check.

  Until consent arrives, the teen can set up their profile but can't browse
  rooms, talk or follow anyone (decision 70).
- **Turning 18 (my call, builder check):** on their 18th birthday (by the date
  of birth they gave), a member moves to the adult side automatically, with no
  ID asked. An in-app notice a week before tells them, and says their follows
  with under-18s will end. On the day, those follows end (decision 40's rule),
  photo pre-approval stops, and consent records are kept only as long as the
  law requires. One alarm per teen, set when the date of birth is saved.
- **Our own ID check** (decisions 11, 12, 83):
  - The date of birth is read from the ID's government-signed chip, or from the
    printed machine-readable code.
  - The selfie is compared with the ID photo automatically. Clear passes are
    approved automatically.
  - Unclear cases go to **Shyden alone**, in the app or on the website. The
    server refuses every other account.
  - An unclear case's images are held encrypted only until he decides, then
    deleted. Nothing else is ever kept.
  - The face-matching model must have a commercial-use licence. InsightFace's
    models don't qualify. Candidates: Idswyft (MIT), OpenBiometrics, IDVKit.

### 4.4 Genuine phones and ban evasion (decisions 58, 62, 63, 65, 77)

- **Genuine-phone proof at sign-up and on every session.** The proof can be any
  of:
  - Apple App Attest + DeviceCheck
  - Google Play Integrity + device recall
  - Android hardware key attestation from an allow-listed root with a locked
    bootloader (with Google's revoked-key list checked)
  - Huawei HUKS attestation

  Emulators, simulators and modified phones are refused. At first release,
  only Apple's and Google's proofs are built. The hardware-key and HUKS routes
  come when China opens (decision 91), and until then those phones take the
  number check.
- **A phone that can prove nothing** confirms a mobile number by texting a code
  to our gateway phone. VoIP/virtual numbers and known "receive a text"
  numbers are refused. One account per number, ever. A ban bans the number.
- **One account per device and per hardware key.** Every ban sets Apple's and
  Google's device marks.
- **VPNs are allowed.** Bans hold through the phone and the number. A VPN is
  only a warning sign: for example, a new account on a VPN keeps the
  new-account limits longer. The VPN, Tor and data-centre lists are
  self-hosted and used only as that warning sign.
- Disposable email addresses are refused. New accounts can't open a room
  during their first day.
- **The gateway phone is something we rely on**: if it goes quiet, an alert
  fires, triggered by the event and not by a timer (global rule).

### 4.5 Room list (decisions 34, 35, 36, 43)

- **Card, the same as the old app:** a 140-high card filled with the seated
  people's photos (owner's seat first; a person icon when there's no photo),
  with a dark fade. Over it: the room name (one line), "seats taken / total",
  "N in room" and up to 6 country flags. The owner's own card has a "Your
  room" outline and label. Big screens show two columns. The "Owner away"
  countdown appears only inside the room, never on the card.
- **What's listed:** only open and owner-away rooms, only the viewer's own age
  side, and never a room whose owner the viewer blocked or who blocked them.
  The server also refuses a join into such a room.
- **Order:** the server builds one list per age side: busiest first, but a room
  opened in the last **5 minutes** is lifted near the top (the 5 minutes is my
  call for "a few minutes"). The app then reorders it for each viewer: their
  own room at the very top, then rooms holding people they follow.

### 4.6 Rooms (decisions 18-26, 32)

- **Voice and text** in every room. **8 seats.** People ask for a seat, and the
  owner or a host accepts.
- **Owner:** kick, mute, ban from the room, make or remove hosts, Close room,
  text chat on or off, mute someone's texting.
- **Hosts:** the same, except making or removing hosts. Hosts take a seat
  without asking. Host powers last for that room session only.
- **Back, browsing elsewhere, minimising or a phone call is not leaving.** The
  person stays in the room. During a call or alarm the mic is paused.
- **Owner timers:**
  - The connection drops (app swiped away, phone dies, signed out, suspended or
    banned): "disconnected" for **1 minute**, with nothing shown.
  - Then "away": the owner's icon is dimmed, and a **5-minute** countdown and a
    message (suggesting people start their own room) are shown in the room.
  - If the owner returns, everything is back to normal.
  - While away, the owner may visit other rooms, but the countdown continues.
- **Member on a seat:** actually leaving frees the seat at once. A dropped
  connection gives **5 seconds** disconnected, then **30 seconds** away (icon
  dimmed), then they count as gone.
- **A room closes only when:**
  - the owner taps Close room
  - the away timer ends
  - the room becomes empty (the last person leaving while the owner is away
    gets a "this will close the room" confirmation)
  - staff close it for safety
  - the owner deletes their account
- Every timer is a Durable Object alarm. Nothing polls.
- **Room invite** (decision 82): an Invite button, usable only between two
  people who follow each other, on the same age side.

### 4.7 People: following, profiles, blocking (decisions 37-48)

- **Following** stays within one age side. If someone moves side, their follows
  across the split end (my call). Followers can be removed; anyone can
  unfollow. Followers see which room the person they follow is in.
- **In-room preview card** (tap a person): name, photo, country flag,
  Follow/Unfollow, Block/Unblock, Report, plus the owner's and hosts' actions.
- **Profile page:** name, profile photo, cover image, description (with "show
  more"), followings and followers. No Viewers list and no record of who
  looked at a profile (removed, decision 152). It also shows:
  - age "N years old", which the owner can hide
  - the numeric user ID
  - a self-chosen country flag
  - photos that open full screen
  - Edit profile (name, description, photo, cover, country)
  - a "suspended" label and the blocked states

### 4.8 Reporting and moderation (decisions 46, 49-53, 58)

- **Report** appears in four places: the preview card, each message, the room
  and the profile page.
- **Report reasons:** Spam, Harassment, Inappropriate content, Other (with a
  text box), Threat to hurt someone, Sharing someone's private info or photos,
  Seems to be under 18 (adult side only), and Seems to be an adult (under-18
  side only). Threat words lift a report to the top of the queue.
- **Moderators:** work the report queue, warn, mute, suspend for a set time,
  close rooms, and approve under-18 photos.
- **Shyden alone:** ID reviews, permanent bans, the authorities queue, and
  making or removing moderators.
- **Every staff tool exists in both the app's staff area and the website's
  staff modules.** Neither may lag the other.
- Room text is kept on the server for moderators for **30 days** (my call for
  "a while"), except cases preserved for the authorities. Staff can export an
  evidence pack.
- **Voice evidence: the last minute, on the phone** (Shyden, 2026-10-24,
  decision 92). Each phone in a room keeps only the last 60 seconds of room
  audio in memory, constantly overwritten and never saved. When someone
  reports, that minute is sent with the report. Every room shows "the last
  minute of audio can be attached to a report". The audio is kept like other
  report evidence and is covered in the privacy policy. Nothing is recorded on
  the server. Spike it on both phones first.
- Warnings, suspensions and bans tell the person which rule they broke (and,
  for a suspension, how long it lasts), and never who reported them. When a
  suspension ends, everything it removed returns (carried from the old
  project's rule).

### 4.9 Content protections (decisions 58, 84)

- **Pictures** appear only as the profile photo and cover. Every upload is
  checked on our server by a free, self-hosted model (licence checked first),
  and its location data is stripped.
  - **Adults:** a flagged photo is refused, and the rest appear at once.
  - **Under-18s:** every new photo waits for a moderator's approval, and the
    old photo stays up meanwhile.
  - Removed pictures are fingerprinted and blocked from being uploaded again.
- **Chat** blocks phone numbers, addresses, emails, links and social handles.
  This is strict on the under-18 side and lighter for adults. A swear filter
  masks words as `****` in all 5 languages.
- Network addresses are never shown. The only location shown anywhere is the
  self-chosen country flag.

### 4.10 Notifications (decisions 38, 39, 79-83)

Each notification is sent only when its event happens (nothing polls) and has
its own on/off switch. All wording comes from the server, in 5 languages.

| Who | When | Text |
|---|---|---|
| Followers | someone they follow **opens** a room | "{Name} opened a room. Join them now!" (switch for all, and per person) |
| Owner | their room enters the away countdown | "Your room closes in {minutes} minutes. Come back to keep it open." |
| Teen | their parent approves | "Your parent said yes. You can join rooms now." |
| Reporter | their report is handled | "Thanks, we've dealt with your report" |
| Account holder | sign-in on a new phone | "Your account was signed in on a new phone. Not you? Tap to secure it." |
| Followed person | someone follows them | "{Name} followed you" |
| Member | a suspension ends (one alarm set when it's given) | "Your suspension has ended. Welcome back, and please follow the community rules." |
| Member | suspended | the rule broken + the length |
| Member | warned | "You've received a warning for {rule}. Please follow the community rules." |
| Member | banned | "Your account has been banned for {rule}." |
| Member | data download ready | "Your ShyTalk data is ready to download." |
| Member | room invite | "{Name} invited you to their room." |
| Staff | report of a threat or doxxing | urgent report |
| Shyden only | the automatic ID check can't decide | an ID check needs a person |

Deliberately left out: "someone blocked you" and "someone viewed your profile".

### 4.11 Server decides (the approved 2026-10-20 live-app design, carried over)

The app draws, and the server decides what it shows. One versioned document per
environment holds menus, colours and sizes, feature switches and all wording.
Later it also holds whole screens built from a closed catalogue of the app's
own parts. Behaviour carried over:
- **Start-up:** the app opens instantly from the last download (or the copy
  built into the app), then applies the latest version.
- **While the app is open:** changes arrive within seconds (p95 of 10 s or
  less) and never interrupt what someone is doing.
- **Rollout:** named people first, then optionally a share of users, then
  everyone. Undo is available.
- **Version floor:** the server enforces a minimum version. It moves
  automatically once a release is in both stores, with a button as backup.
  Older apps see only an "update to continue" screen, and the server enforces
  every rule itself.
- **Production publishing needs Shyden's approval.**

Source: `.superpowers/sdd/EPIC-0011/live-app-design.md`. Its Express and
Firestore specifics are replaced by Workers and D1.

### 4.12 Website (decisions 52-55)

- **Signed out:** home (describes ShyTalk, with store links once released),
  terms, privacy, do-not-sell, community guidelines, cyber-bullying, roadmap,
  sign-in and 404. No event pages.
- **Members:** everything the app offers members (profile, following,
  blocking, reporting, settings, account, data download) **except anything to
  do with rooms**.
- **Staff modules:** appear according to the signed-in person's role, and match
  the app's staff area exactly.

### 4.13 Languages, accessibility, screen sizes

- **Languages:** 5 at launch (decision 56). Every line is read back by Google
  Cloud Translation before it is shown or committed.
  Every screen and page, legal text included, ships in all 5 from its first
  release, on the app and the website; legal pages say the English version
  governs where translations differ (decision 171).
- **Accessibility:** WCAG 2.2 AA on the app and the website (decision 87, my
  call). That means:
  - it works with VoiceOver and TalkBack
  - it follows the phone's text size up to the largest setting
  - colour contrast meets AA
  - tap targets are at least 44 points
  - nothing is shown by colour alone
  - every control has a label
  - reduced motion is respected
- **Screen sizes:** every screen is designed for every size class and fold
  state, by size class and never by device (decisions 3, 8). This includes the
  iPhone Duo's 7.6" inner and 5.4" outer screens and Split View.

### 4.14 Data, privacy, legal pages (decisions 78, 82, 86)

- **Where data lives (corrected after the builder check, my call):** a D1
  database has one primary location, so "near each user" holds only for
  reads and live rooms, not for storage. Accounts, bans, reports and the rules
  table live in one D1 database placed in Asia-Pacific (location hint `apac`,
  nearest the expected audience), with read replicas near users. Each room's
  Durable Object starts near the person who opens it, and R2 is also `apac`.
  One database keeps "one account per device/number, ever" and bans global
  and simple. The consent text (section 4.2) says exactly this. Oracle hosts
  voice and the ID check.
- **Download my data:** built in the background, then a notification
  (decision 82). This meets the right of access under UU 27/2022 (and GDPR).
- **Legal pages:** I write them, without a lawyer, in plain words and 5
  languages. Indonesian law comes first, then PIPL, GDPR/UK (for when those
  regions open), COPPA and Australia's rules. They must cover:
  - biometric matching and Shyden's hand review, with images held until he
    decides and then deleted
  - teen accounts and parent consent
  - consent to data leaving the user's country
  - warnings, suspensions and bans with reasons
  - data download
  - notifications
  - room-text retention
  - the last-minute voice clip attached to reports

### 4.15 Project set-up (decisions 30, 31, 85, 88, 89)

- **A brand-new repository** for the app, server and website. The old repo is
  renamed and archived, so the new one keeps the name `shyden-labs/ShyTalk`.
  Shyden does or approves the renaming and archiving.
- **Set up exactly like Yawelo Idle** (decision 89): tickets as GitHub issues on
  its five-part form, the same board fields, the same live roadmap model, and
  the same CI and testing set-up. **repo-template is brought into line** by a
  ticket in that repo, never edited from here.
- **A fresh board.** Before archiving, every one of the old board's ~394 open
  tickets is closed as "not planned: replaced by the rewrite". The open pull
  requests #2281, #2489 and #2539 close unmerged, and the unpushed story files
  are dropped. The old board is archived.
- The live roadmap is reconnected to the new board. In the same change,
  everything that names board #1 is updated: `app_manifest.py`, the progress
  command, the global CLAUDE.md line, and the roadmap-boundary hook.
- **Nothing carries over:** no data, no store pages. Before archiving, list
  everything the old repo runs or deploys, so its stopping is known and not
  silent.
- Each step that touches production waits for Shyden's approval at the time.

### 4.16 Testing and release (global rules; my call to restate them here)

- Strict TDD.
- Every phone test is one test, run on Android and iPhone in parallel.
- The device set includes the iPhone Duo (folded and unfolded), an iPad, an
  Android tablet or foldable, plus a phone without Google. Shyden has all of
  them (decision 94).
- Real phones are signed off by Shyden before any release.
- Release goes through the frozen `release/*` cut.

### 4.17 Environments: DEV, TEST, PROD (decisions 178-196; global model, reference-supply-chain.md)

- **Three environments, two Cloudflare accounts, one ShyTalk login** (decisions
  180, 193, 194, 196). The ShyTalk login (its own new Gmail, its own two factors
  and backup codes) owns:
  - **"shytalk" (PROD):** shytalk.app alone, the PROD Workers, D1 and R2, and
    the two front doors below. It holds no TEST or DEV keys, data or code.
  - **"ShyTalk Non-Prod":** TEST and DEV as separate Workers, each with its own
    D1 and R2, served at the account's `workers.dev` addresses with preview
    URLs off (decision 189).
- **Addresses** (decision 190): people see only `shytalk.app`,
  `test.shytalk.app` and `dev.shytalk.app`. The last two are small forwarding
  Workers ("front doors") in PROD's zone. Each passes every request, WebSocket
  upgrades included, to its environment's `workers.dev` address. A door has no
  bindings, and a guard test pins that.
- **Door secret:** each TEST and DEV origin accepts only requests carrying its
  own door secret, held only by that environment, its door and CI.
- **Machines skip the doors** (decision 197, amending 192): every door
  request counts against PROD's 100,000 free daily requests, refused or not,
  so CI and every automated test call TEST and DEV at their `workers.dev`
  addresses directly, and a CI guard refuses any test or workflow naming a
  door address. Only people use the doors. Cloudflare's one free rate-limiting
  rule (per visitor, 10 seconds) covers both doors to stop a runaway device,
  and a daily check reports each door's request count to Shyden.
- **What travels where** (decisions 180, 181): every merge to `develop` deploys
  to DEV; each frozen `release/*` cut goes to TEST first (closed testers,
  staff, Shyden's device sign-off), then the same cut goes to PROD after his
  approval. TEST stays after launch as the pre-release stop. Phone apps: local
  builds for DEV, TestFlight and Play closed testing for TEST, the stores for
  PROD.
- **Data:** DEV holds fake personas only. TEST holds testers' real data under
  the privacy policy, wiped of testers when a closed test ends (decision 176).
  PROD holds everyone's.
- **Keys and guards, all built before any deploy key exists** (decision 187's
  mechanisms, kept after 188-193):
  - one deploy key per Worker (Cloudflare's per-Worker Editor role), so DEV's
    key reaches only DEV's Worker;
  - the PROD key only in a GitHub environment with ShydenMcM as required
    reviewer, never a repo secret;
  - a CI guard that refuses any Worker bound to another environment's D1, R2
    or KV (DEV bound to TEST included, since testers' data is real), and pins
    each door to forwarding only;
  - a local hook that refuses PROD deploys and direct PROD database commands
    from this Mac;
  - a check at run time that each Worker's resources belong to its own
    environment, failing closed.
- **Budget:** up to US$10 a month for all three before real users, LiveKit on
  Oracle's free tier not counted (decision 186).
- **Unproven, spiked before testers arrive:** a voice-room WebSocket through a
  door (connect, hold, alarms, reconnect). Also unproven: reaching shytalk.app
  from mainland China.
- **Not yet decided:** how DEV and TEST get voice (one LiveKit server shared,
  or one each) and the ID check service. Both are asked in plan 4.

## 5. Lessons from the old system that become requirements (decision 29)

- A room can be created only by the server, for the signed-in owner. A forged
  room create is refused (old SHY-0708).
- Gift messages exist only in the sender's own room. Gifts are not in the core,
  but the rule is carried into their later design (old SHY-0709).
- Presence and "owner left" never race: one Durable Object owns each room's
  truth (old SHY-0710 / SHY-0692).
- Members never write moderation data. Mutes and bans are written only by staff
  through the server (old rule).

## 6. Left to the builder

- The schema, the API shapes and the Swagger spec.
- How the live channel reaches open apps (measured for cost and delay).
- Choosing the photo model and the face model (the licence must allow
  commercial use).
- The exact swear and contact-detail filter lists per language.
- Push through the phone makers' channels (Huawei, Xiaomi, OPPO, vivo),
  including whether each needs a Chinese company. Must be checked before China
  opens.
- Whether Sign in with Apple works in mainland China. Not verified.
- Whether Cloudflare's EU jurisdiction is on the Free plan. Only matters when
  the EU opens.
- Rate limits and free-tier alarms.
- Whether D1 read replication is on the Free plan (unconfirmed, decision 95); if not, reads go to the Asia-Pacific primary and rooms are unaffected. Check it in the spike.
- Report counts that escalate to an ID check or a moderator; the exact
  new-account limits; how the single Oracle server (voice, ID check, photo
  model) reports its own failure.
- Staff tools are built for many moderators (decision 50), whoever helps at
  launch.
- The website Android download exists only for mainland China (decision 61),
  so it is not offered at launch (decision 76); a build without a store takes
  its country from the SIM, then location.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Legal pages written without a lawyer (decision 86) | Written from the laws' own texts, Indonesia first; the riskiest corner of "free", accepted by Shyden |
| Consent is the only legal transfer route under GR 33/2026 until the agency exists | The monthly rules-table job watches for the adequacy list and standard clauses |
| The gateway phone is a single point of failure for no-proof sign-ups | An outcome alert, triggered by the event |
| Mainland reach and maker push are unmeasured | China opens only after a rep exists AND the measurements pass |
| Expo App Integrity is alpha; RN 0.88 is new | Throwaway spike first |
| Free limits are reached | They fail without charging; alerts fire before the limit |

## 8. Calls I made (for Shyden to check)

1. Data is kept near each user with a consent screen before sign-in, and
   refusing means the app can't be used (decision 78).
2. A new room is lifted near the top of the list for its first 5 minutes.
3. Room text is kept for 30 days, except cases preserved for the authorities.
4. Follows across the age split end when someone moves side.
5. WCAG 2.2 AA accessibility.
6. Warnings and suspensions name the rule broken, never the reporter.
7. This file lives in `.superpowers/` until the new repo exists.
8. Data is stored mainly in Asia-Pacific in one database (corrects call 1's
   "near each user", which D1 cannot do for storage).
9. Self-imposed pauses at 90% of a daily free limit; alerts at 80%.
10. Moving to the adult side automatically at 18, with a week's notice.
