# ShyTalk brand

The source of ShyTalk's look: the icon, the wordmark, the colours and the type. The website takes its colours from `apps/web/src/brand.ts`; the icons the site serves are made from `icon.svg` by `node apps/web/scripts/export-icons.ts`.

## Files

| File | What it is |
| --- | --- |
| `icon.svg` | The master icon: three hello bubbles ("hello", "你好", "สวัสดี") on the tile. Its words are text in the brand fonts, so render it with those fonts loaded (the export script does). |
| `icon-1024.png` | The 1024px store master, made by the export script. |
| `wordmark.svg` | The name: "Shy" in white, "Talk" in violet, Outfit 800. Shown on the night background. |

## Colours

| Token | Hex | Use |
| --- | --- | --- |
| night | `#16123a` | page background |
| tile | `#211a52` | icon tile, raised surfaces |
| violet | `#a78bfa` | "Talk", links, accents |
| ink-soft | `#ddd8ff` | body text |
| muted | `#a9a2d6` | quiet text |
| yellow | `#ffb020` | hello bubble, "Coming soon" badge |
| pink | `#ff5c8a` | hello bubble |
| teal | `#20c4b0` | hello bubble |
| blue | `#60a5fa` | hello bubble |
| gold | `#fbbf24` | hello bubble |
| green | `#34d399` | hello bubble |
| plum | `#2a0614` | the word on the pink bubble on the page (white on pink is only 2.94:1) |

Every text and background pair on a page meets WCAG AA (4.5:1). The icon keeps white on pink: a logo is exempt, and at icon size the word is a shape.

## Type

- Outfit 500 and 800: the wordmark, headings and text.
- Noto Sans, Noto Sans SC and Noto Sans Thai 800: the words in the bubbles, so each script draws in a face made for it.

All are under the SIL Open Font Licence 1.1 and are served from the site itself, from the `@fontsource` packages.

## Rules

- The hellos are never translated: each stays in its own language, marked with its `lang`.
- The icon always has three bubbles in three languages, top to bottom yellow, pink, teal.
- Below home-screen size the words blur and the icon reads as three coloured bubbles; that is expected.
