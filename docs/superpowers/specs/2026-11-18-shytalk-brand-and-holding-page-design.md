# ShyTalk brand and holding page

Date: 2026-11-18. Status: approved by Shyden in brainstorming (visual companion), written up for approval.

## Intent

shytalk.app is about to go live with a holding page (#261). The first version was plain text on white, and Shyden judged it "very bland and boring, unlike Yawelo Idle. This is a page that needs to go live and bring hype about the new product." He asked for a new brand: "Make a new brand and colour scheme. That means making your own attractive logo, this logo needs to be appropriate for the app icon." ShyTalk is educational and social: people learning languages and cultures by talking, in live voice rooms. The brand has to say "many languages, many people, friendly" at a glance, and the holding page has to make a visitor want the app.

This replaces the old store apps' logo. The name ShyTalk and the store ids (`com.shyden.shytalk`) stay; the rewrite is still an update to the existing store apps.

## What Shyden chose (rounds 1 to 4, 2026-11-18)

- Round 1 (24 directions): liked 03 world in a bubble, 04 four writing systems, 11 eight seats, 16 hello in several languages. Thread: many languages and people, lots of colour.
- Round 2: liked A scripts in a bubble, C seats with scripts, G hello pills on violet, H two-way hello. Thread: real words in the logo, violet.
- Round 3: liked 2 (A and あ), 3 (hello exchange), 5 (eight seats).
- In use: liked B (hello exchange) and C (eight seats). He then said: "I like the white Shy and violet Talk part of the ShyTalk name. In the banner I like the different coloured bubbles with different languages texts in them."
- Icon: "keep the bubbles in #2 and put language text inside them. Say hello in English, Chinese, Thai." Of three takes he chose 1: text coloured to suit each bubble.
- Holding page mockup (computer and phone): "This looks good for now."

## The brand

### Icon (app icon and site mark)

A rounded tile in deep night blue with three speech bubbles stacked, tails alternating left, right, left:

| Bubble | Colour | Word | Language | Text colour |
| --- | --- | --- | --- | --- |
| Top, tail left | yellow `#ffb020` | hello | English | `#2a1600` |
| Middle, tail right | pink `#ff5c8a` | 你好 | Chinese (Simplified) | `#ffffff` |
| Bottom, tail left | teal `#20c4b0` | สวัสดี | Thai | `#08332e` |

Tile `#211a52` (one step lighter than the page so it stands out on it), corner radius 27 on a 120 grid. Below home-screen size the words blur; the icon then reads as three coloured bubbles, which was shown to Shyden and accepted. The master is an SVG whose words are text in the brand fonts (changed while building, #273: outlining needed a font-to-path library for one file); every picture of it, favicons included, is a PNG rendered with the fonts loaded, so no device needs the fonts.

### Wordmark

"Shy" in white, "Talk" in violet `#a78bfa`, set in Outfit ExtraBold (800), on night blue. On a light background "Shy" becomes night blue `#16123a` and "Talk" keeps violet (darkened to `#6d4ee0` where contrast needs it).

### Colours

| Token | Value | Use |
| --- | --- | --- |
| night | `#16123a` | page background |
| tile | `#211a52` | icon tile, raised surfaces |
| violet | `#a78bfa` | "Talk", accents, links |
| ink-soft | `#ddd8ff` | body text on night |
| muted | `#a9a2d6` | small print on night |
| yellow | `#ffb020` | "Coming soon" badge, bubble |
| pink | `#ff5c8a` | bubble |
| teal | `#20c4b0` | bubble |
| blue | `#60a5fa` | bubble |
| gold | `#fbbf24` | bubble |
| green | `#34d399` | bubble |

Every text/background pair on the page meets WCAG AA, measured 2026-11-18: violet on night 6.53:1, ink-soft on night 12.98, muted on night 7.47, dark text on yellow 9.46, on teal 6.29, on blue 6.23, on gold 10.37, on green 8.23. White on pink is only 2.94:1, so on the page the pink bubble's word is deep plum `#2a0614` (6.3:1). The icon keeps white on pink as chosen: logos are exempt from the contrast rule, and at icon size the word is a shape, not text to read. axe on the page proves the page's pairs.

### Type

Outfit (500 and 800) for the wordmark, headings and text; Noto Sans, Noto Sans SC and Noto Sans Thai (800) for the words in the bubbles, so each script draws in a face made for it. All are SIL Open Font Licence. They are served from the site itself (the site's content security policy allows only its own address, and no visitor request goes to a third party), as WOFF2 subsets holding only the glyphs used.

## The holding page

Matches Yawelo Idle's holding page, top to bottom (see `.superpowers/brainstorm/54525-1794947624/content/holding-page.html` for the approved mockup):

1. A small icon at top left; a language switch at top right offering English, Bahasa Indonesia, ไทย, Tiếng Việt and 中文, each linking to that language's holding page.
2. The icon, large.
3. The wordmark.
4. A yellow "Coming soon" badge.
5. The tagline (`site.tagline`, already in five languages).
6. The banner: coloured bubbles saying hello in seven languages (hello, こんにちは, halo, xin chào, สวัสดี, 你好, hola), floating gently; still for visitors with reduced motion. Five bubbles on a phone, seven on a computer. Each word carries its own `lang` attribute so screen readers pronounce it in its language; the hello words are never translated.
7. The support address at the bottom.

What #261 already built stays: the Worker answers the holding page by the visitor's language, www sends a 301 to the bare address, nothing behind the page is reached. One change: the language switch needs each language's holding page reachable, so `/{locale}/` (for example `/id/`) answers 200 with that language's holding page, as `/` does by Accept-Language. Every other address still answers the holding page as a 404.

The page's link preview (#198) shows its new look: its preview picture is remade by the script.

### Copy

New lines, read back by Google in id, th, vi and zh before commit: "Coming soon" (badge) and the language switch's label. The language names are written in their own language and not translated. The tagline, the "ShyTalk is on its way" and "being built" lines from #261 stay available; whether the page shows them under the tagline is the builder's call, keeping the mockup's simplicity.

## Approaches considered

1. **Brand as source files in the repository (chosen).** A `brand/` folder holds the master icon SVG (outlined), the wordmark SVG and a README with the colours and type; the site's CSS takes the colours as tokens; a script exports every icon size the site needs (a 32px PNG favicon, the 192px icon the page shows, the 180px Apple touch icon) and the 1024px store master; the Apple and store icons are square and opaque, as their platforms round them and the App Store refuses transparency. The site has no web manifest, so no manifest sizes are made. One place, versioned, testable, reused by the app later.
2. A Design System artifact on claude.ai as the brand's home, with the repository copying from it. More ceremony and a second source of truth for one icon and eleven colours; not worth it now.
3. A raster logo made in an outside design tool. No such tool is in use here, and an SVG master scales to every size the stores and site need.

## Goals

- shytalk.app's holding page as approved, on every browser and phone the suite runs, passing axe and the CSP with no refusal.
- The icon as the site's favicon and Apple touch icon, and the 1024 store master ready for the app.
- The brand's files and tokens in the repository for the app and the full site to reuse.

## Non-goals

- Restyling the rest of the website (sign-in, account, closed testing, legal pages): its own ticket, later.
- The promo video (#54). When it exists it joins the page under or in place of the bubbles.
- The app's icons in the app projects and the store listings: the app shell's tickets take the 1024 master.

## Anti-goals

- Anything that reads as a dating app (no hearts, couples or pairing imagery).
- A third-party request from the page (fonts, analytics, video hosts).
- Words in the icon that only one language's speakers can read as the whole message: the three hellos stay three languages.

## Constraints

- Strict TDD: every behaviour has a test that ran red first; the smoke and its iPhone copy check the page in every language on every browser, with one journey per language.
- Production goes live only through a release cut and Shyden's approval. The cut staged on 2026-11-18 (`release/2026-11-18-holding`, the plain page) is superseded: it is deleted, and a new cut is staged once this lands.
- Fonts and pictures are committed files; the font licences go in the repository's licence notes.

## Left to the builder

- Exact bubble positions and float timing, within the mockup's look.
- Whether "ShyTalk is on its way" and "being built" appear under the tagline.
- The WOFF2 subsetting tool (open-source, licence allowed by the supply-chain rules).
- How the language switch shows the current language.
