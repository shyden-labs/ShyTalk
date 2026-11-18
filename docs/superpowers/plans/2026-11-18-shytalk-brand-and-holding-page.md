# ShyTalk brand and holding page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put ShyTalk's new brand (icon, wordmark, colours, type) in the repository and show it on the shytalk.app holding page exactly as Shyden approved (#273).

**Architecture:** The brand lives as source (`brand/` SVGs, `apps/web/src/brand.ts` tokens) and is rendered to PNG icons by a Playwright script, as the preview pictures already are. The holding page is restyled in its Astro component with fonts bundled from Fontsource packages (served from the site, so the CSP stays `default-src 'self'`). The web Worker learns one new answer: each language's home is that language's holding page.

**Tech Stack:** Astro 5 static site, Cloudflare Worker (`workers/web`), Vitest unit suite, Playwright smoke + the Appium iPhone copy, `@fontsource/*` (OFL-1.1).

**Spec:** `docs/superpowers/specs/2026-11-18-shytalk-brand-and-holding-page-design.md`

**Deviation from the spec (builder's call, recorded in the spec by this plan's PR):** the master `brand/icon.svg` keeps its words as text in the brand fonts instead of outlines, and the favicons are PNGs (32px, plus the 180px Apple touch icon) rendered by Task 2 with the fonts loaded. Outlining would need a font-to-path library and a second copy of each glyph for one SVG favicon; a PNG favicon shows the same picture on every device.

## Global Constraints

- Colours exactly: night `#16123a`, tile `#211a52`, violet `#a78bfa`, ink-soft `#ddd8ff`, muted `#a9a2d6`, yellow `#ffb020`, pink `#ff5c8a`, teal `#20c4b0`, blue `#60a5fa`, gold `#fbbf24`, green `#34d399`; plum `#2a0614` for the pink bubble's word on the page.
- Icon bubbles: yellow "hello" text `#2a1600`, pink "你好" text `#ffffff`, teal "สวัสดี" text `#08332e`, tile `#211a52`, radius 27 on a 120 grid.
- Wordmark: "Shy" white (`#ffffff`) + "Talk" violet, Outfit 800.
- Fonts: Outfit 500/800; Noto Sans, Noto Sans SC, Noto Sans Thai 800; from `@fontsource/*` only; no request to another host.
- Hello words, never translated, each with its `lang`: hello (en), こんにちは (ja), halo (id), xin chào (vi), สวัสดี (th), 你好 (zh-Hans), hola (es). Phone width shows the first five.
- Strict TDD: a test runs red before its code; smoke changes go red in CI by name through a throwaway PR; the iPhone copy mirrors every smoke edit (`tests/phones/iphone-cases.ts`, names equal).
- Every new translated line is read back by Google (`node scripts/i18n/google-read-back.ts <locale> <key>`), table copied to `.superpowers/sdd/273/` at once, rows appended to `apps/web/src/i18n/read-back/<locale>.md`.
- Coverage stays 100% on all four; prettier, eslint and typecheck clean before every commit.

## Review Focus

1. A visitor whose Accept-Language is Thai opens `/` then picks "English" in the switch: they must land on the English page, not be sent back to Thai. The switch's English link is `/en/`, which answers English whatever the header says (Task 5 test). On dev, where nothing holds, the holding page is previewed at `/holding` and its switch links answer the normal site's 404; accepted, as only production holds.
2. `/id` without a trailing slash, `/ID/`, `/xx/`: `/id` answers like `/id/`; unknown or upper-case prefixes answer the 404 holding page in the header's language. (Task 5.)
3. Reduced motion: no bubble moves (Task 4 smoke checks the computed `animation-name` is `none` under `reducedMotion: 'reduce'`).
4. A phone at 360px wide: no horizontal scroll and every bubble inside the stage (Task 4 smoke checks `scrollWidth <= clientWidth` at 360px).
5. The Thai and Chinese pages: the tagline draws in Noto Sans Thai / SC, not a fallback box (Task 4 smoke checks `document.fonts.check('800 18px "Noto Sans Thai"', 'สวัสดี')` after load).

---

### Task 1: Brand tokens and source files

**Files:**
- Create: `apps/web/src/brand.ts`, `brand/icon.svg`, `brand/wordmark.svg`, `brand/README.md`
- Test: `tests/unit/brand.test.ts`

**Interfaces:**
- Produces: `export const BRAND = { night, tile, violet, inkSoft, muted, yellow, pink, teal, blue, gold, green, plum } as const` (hex strings); `export const ICON_BUBBLES: readonly { word: string; lang: string; fill: string; text: string }[]` (3 entries, top to bottom); `export const HELLOS: readonly { word: string; lang: string; fill: string; text: string }[]` (7 entries, in the Global Constraints order, fills yellow, pink, teal, violet, blue, gold, green; text colours dark on all, plum on pink).

- [ ] **Step 1: Write the failing tests** in `tests/unit/brand.test.ts`:
  - `BRAND` equals the Global Constraints colours exactly.
  - `ICON_BUBBLES` equals `[{word:'hello',lang:'en',fill:'#ffb020',text:'#2a1600'},{word:'你好',lang:'zh-Hans',fill:'#ff5c8a',text:'#ffffff'},{word:'สวัสดี',lang:'th',fill:'#20c4b0',text:'#08332e'}]`.
  - `brand/icon.svg` (read as text): `viewBox="0 0 120 120"`, a `rect` with `rx="27"` and fill `BRAND.tile`, and each `ICON_BUBBLES` fill, word and text colour appear, in that order.
  - `brand/wordmark.svg` contains "Shy" filled `#ffffff` and "Talk" filled `BRAND.violet`.
  - every `HELLOS` text/fill pair has WCAG contrast ≥ 4.5 (a `contrast(a, b)` helper in the test file).
- [ ] **Step 2: Run** `npx vitest run --config vitest.unit.config.ts tests/unit/brand.test.ts` — FAIL (module missing).
- [ ] **Step 3: Write** `brand.ts`, `icon.svg` (the approved shapes: paths from `.superpowers/brainstorm/54525-1794947624/content/holding-page.html` symbol `icon`), `wordmark.svg`, and `README.md` (colours table, type, icon rules, "never translate the hellos").
- [ ] **Step 4: Run** the test — PASS. Then coverage, prettier, eslint, typecheck.
- [ ] **Step 5: Commit** `feat: ShyTalk's brand tokens and source files (Refs #273)`.

### Task 2: Icon export script and the icons it makes

**Files:**
- Create: `apps/web/scripts/export-icons.ts`, `apps/web/public/icons/favicon-32.png`, `apps/web/public/icons/apple-touch-icon.png`, `brand/icon-1024.png`
- Test: `tests/unit/export-icons.test.ts` (loaded by an unfollowed path, as `make-previews.test.ts` is; `vi.mock` of `node:fs/promises` and `@playwright/test`)

**Interfaces:**
- Produces: `export const ICON_SIZES: readonly { file: string; size: number }[]` = `[{file:'apps/web/public/icons/favicon-32.png',size:32},{file:'apps/web/public/icons/apple-touch-icon.png',size:180},{file:'brand/icon-1024.png',size:1024}]`; `export async function main(): Promise<number>`.

- [ ] **Step 1: Failing tests:** `main()` launches Chromium, for each `ICON_SIZES` entry opens a page sized `size`×`size` with `deviceScaleFactor: 1`, sets content to `brand/icon.svg` wrapped with the brand font faces, waits for `document.fonts.ready`, screenshots to `file` with `omitBackground: true`, logs `export-icons: 3 icons`, returns 0, closes the browser even on failure (naming the file that failed).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; run `node apps/web/scripts/export-icons.ts`; check each PNG's IHDR size (32, 180, 1024).
- [ ] **Step 4: Run** tests, coverage, checks — PASS. Look at `brand/icon-1024.png` and confirm the three words draw in their scripts.
- [ ] **Step 5: Commit** `feat: the icon export script and ShyTalk's icons (Refs #273)`.

### Task 3: Fonts and new lines

**Files:**
- Modify: `package.json`, lockfile (add `@fontsource/outfit`, `@fontsource/noto-sans`, `@fontsource/noto-sans-sc`, `@fontsource/noto-sans-thai` at exact versions 5.3.0, 5.3.0, 5.3.1, 5.3.0), `apps/web/src/i18n/{en,id,th,vi,zh}.json`, `apps/web/src/i18n/read-back/{id,th,vi,zh}.md`
- Test: existing licence and i18n tests (`tests/unit/dependency-licences.test.ts`, the key-parity test)

- [ ] **Step 1:** Add keys `holding.comingSoon` and `holding.languages` to `en.json` only; run the i18n parity test — FAIL naming the four missing locales.
- [ ] **Step 2:** Write the four translations; Google read-back each; copy tables; append rows. Run the test — PASS.
- [ ] **Step 3:** `npm install --save-exact` the four packages; run the licence test — PASS (OFL-1.1 allowed).
- [ ] **Step 4: Commit** `feat: the brand fonts and the holding page's new lines (Refs #273)`.

### Task 4: The holding page, restyled (smoke + iPhone copy first)

**Files:**
- Modify: `apps/web/src/components/Holding.astro`, `apps/web/src/layouts/Base.astro` (favicon + apple-touch links in `<head>`, all pages), `apps/web/public/styles/site.css` (a `.holding` section using the tokens), `tests/smoke/site.spec.ts`, `tests/phones/iphone-cases.ts`, `tests/unit/iphone-cases.test.ts`
- Create: `apps/web/src/components/Hellos.astro` (renders `HELLOS` as `<ul class="hellos" aria-label=…>` of `<li lang=…>`)

**Interfaces:**
- Consumes: `BRAND`, `HELLOS` (Task 1); `holding.comingSoon`, `holding.languages` (Task 3); fonts via `import '@fontsource/outfit/500.css'` etc. in `Holding.astro`.
- Produces: page markup the tests read: `header nav[aria-label=t(holding.languages)]` with five `a[hreflang]` (`/en/`, `/id/`, `/th/`, `/vi/`, `/zh/`, current one `aria-current="page"`); `img.brand-icon[alt=""]` (icon, decorative; the wordmark is the name); `h1.wordmark` text "ShyTalk" with "Talk" in `span`; `p.badge` = `holding.comingSoon`; `p.tagline` = `site.tagline`; `ul.hellos` of 7 `li[lang]`; the support link.

- [ ] **Step 1: Rewrite the smoke's holding test** (same journey, one per language): 200, `html[lang]`, nav with five links in this order and the current one marked, h1 text "ShyTalk", badge, tagline, seven hellos each with its `lang` and word, support link, `img.brand-icon` loaded with natural size > 0, axe clean, no CSP refusal; then the Review Focus checks 3, 4 and 5 in the same journey (reduced motion via `page.emulateMedia({ reducedMotion: 'reduce' })`, width 360 set and reloaded, `document.fonts.check`). Mirror every check in `iphone-cases.ts` (`softly`), update `CI_ASSERTIONS` to the new count, and the iPhone unit tests' fake page.
- [ ] **Step 2: Red:** unit iPhone tests FAIL locally; push develop + these test edits + Task 3's lines (no page change) as a throwaway draft PR; read web-smoke by name: the holding test fails in 5 languages × 3 browsers, everything else passes. Close it, keep the log in `.superpowers/sdd/273/`.
- [ ] **Step 3: Implement** the component, `Hellos.astro`, CSS (bubble float `@keyframes` disabled under `prefers-reduced-motion`), favicon links.
- [ ] **Step 4: Green:** unit, coverage, checks; build and look at `/holding` and `/th/holding` at 1280 and 360.
- [ ] **Step 5: Commit** `feat: the holding page wears ShyTalk's new brand (Refs #273)`.

### Task 5: Each language's home answers its holding page

**Files:**
- Modify: `workers/web/src/web.ts` (`holding()`), `tests/unit/web-holding.test.ts`

**Interfaces:**
- Produces: `export function holdingAnswer(pathname: string, languages: string | null): { page: string; status: 200 | 404 }`.

- [ ] **Step 1: Failing tests** (`holdingAnswer`): `/` → header's page, 200; `/en/` → `/holding`, 200, whatever the header; `/id/` and `/id` → `/id/holding`, 200; `/th/`, `/vi/`, `/zh/` likewise; `/ID/`, `/xx/`, `/id/sign-in/` → header's page, 404. The Worker test: `GET /th/` with `accept-language: en` serves `/th/holding` with 200 and `vary: accept-language`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `holdingAnswer`, use it in `holding()`.
- [ ] **Step 4: Run** — PASS; coverage; checks.
- [ ] **Step 5: Commit** `feat: each language's home answers its holding page (Refs #273)`.

### Task 6: Pictures, PR and release staging

- [ ] **Step 1:** `SITE_ENVIRONMENT=dev npm run build:web && node apps/web/scripts/make-previews.ts`; commit the changed holding pictures; the smoke's preview test covers them.
- [ ] **Step 2:** Push, open the PR, read every check by name (web-smoke totals equal the iPhone table), Sonar gate; merge when green.
- [ ] **Step 3:** Dev: curl `https://dev.shytalk.app/holding` and `/th/holding` (200, new markup) and the icons (200, image/png); evidence on #273.
- [ ] **Step 4:** Push a new cut `release/<date>-holding` from develop; put the compare link in HANDOVER's Morning list (opening the PR into `main` is Shyden's).
