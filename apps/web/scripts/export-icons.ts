/**
 * Renders ShyTalk's icons from the master `brand/icon.svg` (shyden-labs/ShyTalk#273): the 32px favicon, the 192px
 * icon the pages show (an <img> SVG cannot use the page's fonts), the 180px Apple touch icon and the 1024px store master, to be committed.
 *
 *   node apps/web/scripts/export-icons.ts
 *
 * The icon's words are text in the brand fonts, so Chromium draws it with those fonts loaded: the page asks a made-up
 * origin for the @fontsource stylesheets, and Playwright's own request routing answers from node_modules. The favicon
 * keeps the tile's round corners on a clear background; the Apple and store icons are square and opaque, as their
 * platforms round the corners themselves and the App Store refuses an icon with transparency.
 */
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { runIfEntry } from '../../../scripts/cli.ts';

/** The origin the icon page asks its fonts from; `.invalid` never resolves, so every request is answered here. */
export const ICON_ORIGIN = 'https://icons.shytalk.invalid';

/** Each icon made, relative to the repository root. */
export const ICON_SIZES = [
  { file: 'apps/web/public/icons/favicon-32.png', size: 32, square: false },
  { file: 'apps/web/public/icons/icon-192.png', size: 192, square: false },
  { file: 'apps/web/public/icons/apple-touch-icon.png', size: 180, square: true },
  { file: 'brand/icon-1024.png', size: 1024, square: true },
] as const;

/** The fonts of the icon's three words, and each word in its font (brand/icon.svg). */
const FONTS = ['noto-sans', 'noto-sans-sc', 'noto-sans-thai'];
const WORDS: [font: string, text: string][] = [
  ['800 16px "Noto Sans"', 'hello'],
  ['800 16px "Noto Sans SC"', '你好'],
  ['800 16px "Noto Sans Thai"', 'สวัสดี'],
];

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MODULES = join(ROOT, 'node_modules');

/** A page showing the icon full size with its fonts; `square` takes the round corners off the tile. */
export function iconPage(svg: string, square: boolean): string {
  const links = FONTS.map((font) => `<link rel="stylesheet" href="${ICON_ORIGIN}/@fontsource/${font}/800.css">`).join('');
  const icon = square ? svg.replace('rx="27"', 'rx="0"') : svg;
  return `<!doctype html><html><head><meta charset="utf-8">${links}<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style></head><body>${icon}</body></html>`;
}

/** The file under `modules`/@fontsource that a request for `pathname` gets; undefined for anything else. */
export function fontFile(modules: string, pathname: string): string | undefined {
  // An absolute path normalises to one inside the root, so `..` never leaves the fonts.
  const path = normalize(`/${decodeURIComponent(pathname)}`);
  return path.startsWith('/@fontsource/') ? join(modules, path) : undefined;
}

export async function main(): Promise<number> {
  const svg = await readFile(join(ROOT, 'brand/icon.svg'), 'utf8');
  const browser = await chromium.launch();
  try {
    for (const { file, size, square } of ICON_SIZES) {
      try {
        const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        await page.route(`${ICON_ORIGIN}/**`, async (route) => {
          const path = fontFile(MODULES, new URL(route.request().url()).pathname);
          await route.fulfill(path === undefined ? { status: 404 } : { path });
        });
        await page.setContent(iconPage(svg, square), { waitUntil: 'networkidle' });
        // A font missing would draw the word in a fallback face, or as boxes: each word must find its own face.
        const loaded = await page.evaluate(async (words) => {
          const found = await Promise.all(words.map(([font, text]) => document.fonts.load(font, text)));
          return found.every((faces) => faces.length > 0);
        }, WORDS);
        if (!loaded) throw new Error('the bubble fonts did not load');
        await page.screenshot({ path: join(ROOT, file), omitBackground: !square });
      } catch (error) {
        throw new Error(`${file}: ${(error as Error).message}`, { cause: error });
      }
    }
    console.log(`export-icons: ${String(ICON_SIZES.length)} icons`);
    return 0;
  } finally {
    await browser.close();
  }
}

await runIfEntry(import.meta.url, main);
