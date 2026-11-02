# ShyTalk plan 3: the website (design, 2026-10-30)

Draft for Shyden's approval (decision 33: he approves, I ask). Built on decisions 148-177 and 208-209 in
`decisions-2026-10-24.md`, the environments in rewrite design §4.17 (decisions 178-197), and the checks in
`plan-03-website/legal-and-token-check-2026-10-30.md`. "My call" marks what I settled; he may override.

## 1. Why

The old site (shytalk.shyden.co.uk) is broken. The public needs a working ShyTalk site to see and follow
while the app is rewritten, and Shyden needs to give people (staff, official accounts, testers) real
ShyTalk accounts before the app exists (decision 148). The site carries ShyTalk's mission: a friendly
place to learn languages and cultures, never a dating site.

## 2. Goals, non-goals, anti-goals

Goals: a public site people can read in 5 languages; a closed-testing list built lawfully; accounts that
are real ShyTalk accounts from day one, made by hand, with the Owner's power fully audited.

Non-goals (later plans): rooms (never on the website, decision 54); following, blocking, reporting
(plan 8); event pages; sign-up on the website (accounts are only created by the app, or by hand,
decisions 60, 148); the promo video itself (decision 209); role default sets and per-holder questions
(decision 208); security keys for the Owner (later story, decision 158).

Anti-goals: anything that reads like dating (no "find a partner" wording, no photos of couples); an
applicant or tester left unsure what happens to their email; any staff power without TOTP; any action
missing from the audit trail; DEV or TEST able to reach PROD's data or keys.

## 3. Release 3a: the public site (replaces the old one)

**Pages** (decision 155): Home, Roadmap, Closed testing, each its own page; shared menu (Sign in on the
right, linking to the sign-in page, live only from 3b; hidden in 3a, my call) and footer (Terms, Privacy,
Community guidelines, Contact = support@shytalk.app). Plus a 404. Address: shytalk.app; the old address
redirects there, done by the shyden.co.uk session on ShyTalk's request (decision 170).

**Home:** what ShyTalk is, in words I draft from the mission and show Shyden before translation
(decision 175b), and a promo video space hidden until a video file is set (decision 209). Video: Yawelo
Idle's pattern, copied as a pattern, never its file (its video is not licensed for reuse). Its session
reported these from its repo on 2026-10-30; I have not read that repo myself:
- Hosting: an R2 bucket in ShyTalk's own Cloudflare accounts (PROD and TEST+DEV), served from our own
  domain (my call: media.shytalk.app, and a dev. equivalent). Never an r2.dev address, because Indonesian
  ISPs block it (Yawelo #768), not even for DEV. No YouTube (decision 59).
- Upload: the files sit in git and Shyden uploads them by hand in the Cloudflare dashboard. No repo
  credential can write to the buckets. The deploy check downloads each file, compares it byte for byte
  with git, and checks the 206 range answers Safari needs.
- Player: a native `<video muted loop playsinline controls preload="metadata" poster=...>` with
  `aria-label`. MP4 is listed first and WebM second, because the WebM froze on its second loop on iPhone
  Safari (Yawelo #621). Autoplay runs from an external script, so the CSP allows no inline script. The
  script skips autoplay under reduced motion and leaves the poster and controls up if autoplay is refused.
  It never plays sound unasked.
- Captions: only if our video has speech (Yawelo's has none); decided when the video is made.
- Our pages only: a Sec-Fetch rule serves the media only to our own pages, plus a
  Cross-Origin-Resource-Policy header. No signed links.
- Open risk: mainland China is unmeasured. Nobody has checked whether a Cloudflare custom domain reaches
  users there reliably (decision 59); measure it before the video ships. Cost: a few MB of storage, and R2
  egress is free. Unmeasured, but within the Free plan.

**Roadmap:** joins when yawelo-idle #759 lands; 3a does not wait (decision 168). Until then the menu
item is hidden (my call).

**Closed testing form** (decisions 153-154, 174, 176):
1. Fields: email; required "I am 18 or older" box. Nothing else.
2. Before sending, the page says: sending does not grant access; if preliminarily selected you will be
   asked for more; add support@shytalk.app to your safe list; if not selected your details are removed;
   details are kept only until closed testing ends (the retention criterion GDPR Art. 13(2)(a) and UU PDP
   Pasal 21 require).
3. One email with a click-to-confirm link; only confirmed addresses join the list. The page answers the
   same way whether or not the address is already on the list (OWASP, no enumeration).
4. Stored: email, confirmed time, applied time, site language. Unconfirmed sign-ups expire by timestamp
   (my call: 48 hours), removed on the next write to the list, never by a timer (decision 176).
5. A person who asks gets a truthful answer and deletion (decision 154a; UU PDP Pasal 7-8, GDPR
   Art. 15, 17). In 3a this is by email to support@; Shyden does it by hand (my call: a handful of
   requests does not justify a tool before 3b).

**Legal pages:** Privacy policy, Terms, Community guidelines, in all 5 languages, English governs
(decision 171). The privacy policy names: who we are (Shyden Labs, Indonesia), what the form holds, why,
how long (until closed testing ends), the rights to access, copy, deletion and complaint (both laws), and
that staff can see members' data under audit (decision 157). Written by me; Shyden reads every line;
legal review is his call (not budgeted).

## 4. Release 3b: accounts

**Sign-in** (decisions 159, 169): no passwords. Email address, then a 6-digit emailed code (single use,
10 minutes, my call; rate-limited; same reply for unknown addresses). Anyone holding any staff
permission, and the Owner, then enters a TOTP code; staff tools stay shut until TOTP is set up. TOTP
seed encrypted at rest; a code works once; attempts rate-limited; printed recovery codes for the Owner
(decision 158). Every send, use, enrol and recovery goes in the audit trail.

**Accounts made by hand** (decision 173): the Owner types an email and ticks permissions and titles. A
single-use invite link valid 7 days is emailed; accepting it plus the emailed code opens the account.
Nothing ticked takes effect until accepted (staff powers also wait for TOTP). Every path that accepts
checks expiry. Owner can resend or cancel. Token: 32 random bytes, stored as SHA-256, `no-referrer`,
link built from configuration, never the Host header (OWASP; my calls on size and hash).

**Who sees what:** an account has a placed mark (date of birth and country given, in the app only,
decision 149). On the website an unplaced account sees no members (decision 151); unplaced profiles are
invisible to everyone (decision 150). In 3b no members exist yet, so this is a stored mark plus a test,
not screens.

**Own account** (decision 175a): see and edit own name, photo, description; see own titles; download
own data; delete own account; sign out.

**Owner and permissions** (decisions 156-157, 163-164, 172, 208): one Owner (Shyden, fixed); every account
holds Member (cannot be removed, hidden by default). Permissions belong to each person and are switched
by the Owner. 3b's permissions (my call, the ones 3b's screens need): manage closed-testing applicants;
make and cancel invites; manage titles; read the audit trail. Seeing ID photos, permanent bans, the
authorities queue, making moderators and under-18 work exist from the plans that build them, all off by
default. Granting a sensitive one asks the Owner's TOTP again and tells the person (my call, decision 163).

**Titles** (decision 208): the Owner keeps a list of titles (create, rename, delete); gives any person
any number; sets each shown or hidden on that person's profile. A title changes no permission.

**Applicants** (decisions 174, 176-177): Applied -> Shortlisted (emailed a short form: languages spoken
and learning, phone type and model, country, a short "why", moderated as a message) -> Details in ->
Picked (sends a TEST invite through the one-way handoff carrying only the email) or Not picked. Filters:
language, phone, country. Not-picked are deleted when the round closes; ending closed testing deletes all
applicants and every TEST account.

**Audit trail** (decision 157): append-only, server-written, one row per action: who, what, whom, when,
from where (environment). The Owner is in it. Nobody, the Owner included, edits or deletes a row.

## 5. How it is built (my calls unless cited)

- Cloudflare Workers + D1 + R2 on the Free plan (decision 28), in the environments of §4.17: PROD at
  shytalk.app; DEV and TEST at their workers.dev origins behind the dev./test.shytalk.app doors
  (decisions 190, 193, 197). Applicants live in PROD; testers' accounts in TEST (decision 177).
- Site: built the same way as Yawelo Idle's site (Shyden: "same as yawelo idle's web page"). Its session
  reported this from its repo on 2026-10-30; I have not read that repo myself.
  - Astro 7.3.5 (MIT), `output: 'static'`, with no Cloudflare adapter. Pages are served as Workers static
    assets (not Pages). Svelte islands (@astrojs/svelte 9) carry only the signed-in parts. The same versions
    as Yawelo, per the version-alignment rule.
  - `build.format: 'preserve'`, so /roadmap and each language's 404 are found. The default format hid
    Yawelo's localized 404 (Yawelo #332).
  - Astro's built-in i18n, one pre-built page per language, English unprefixed (`prefixDefaultLocale:
    false`), the others at /id/, /th/, /vi/, /zh/. Nothing switches language at runtime.
  - One front-door Worker (`run_worker_first`, `not_found_handling: '404-page'`) routes /api/* to the API in
    the same Worker and everything else to the pages.
  - Plain hand-written CSS in external files (`inlineStylesheets: 'never'`, `assetsInlineLimit: 0`), so
    the CSP allows no inline style or script and no `data:` source.
  - Not copied: Yawelo's 10-minute cron (nothing runs on a clock unasked) and its game and webhook routes.
- Sign-in: Better Auth (decision 28) with its email-code and TOTP parts; email via Brevo's free tier,
  from support@shytalk.app.
- Languages: English, Indonesian, Thai, Vietnamese, Chinese; every line read back by Google Cloud
  Translation before it is shown or committed. Accessibility WCAG 2.2 AA (decision 87).
- Tests: unit (mocked, under 1 s each) on the laptop; integration, end-to-end and the browser journeys in
  CI (global rules).

## 6. Left to the builder

Page layout and styling within the approved mockup (decision 155), table shapes, error wording (read back
like every line), and the order of tasks inside each release.

## 7. Builder check (read inline, 2026-10-30)

- Handoff to TEST (decision 177): my call, PROD calls one invite-only endpoint on TEST's workers.dev
  origin with a secret that can do nothing but send an invite; PROD holds that one TEST secret, TEST
  holds nothing of PROD's.
- Outside waits for 3a (Shyden's, his identity): Brevo account and shytalk.app's sender records; Zoho
  mailbox for support@ (decision 110); plan 2's repo and environments; the shyden.co.uk session doing
  the redirect.
- Owner losing access: printed recovery codes (decision 158); losing both TOTP and codes has no way back
  by design, stated to him (decision 156).

## 8. Still open

- APPROVED by Shyden 2026-10-30 (decision 211), with Yawelo Idle's video (§3) and site build (§5)
  folded in.
- "YeeTalk" in decision 148 means ShyTalk: confirmed (decision 210).
- Home words: my draft, for Shyden's edit before translation.
