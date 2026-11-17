/**
 * Makes every page's link-preview picture (shyden-labs/ShyTalk#198 AC2): a real screenshot of the top of each built
 * page, one per page and language, 1200 by 630, into `apps/web/public/previews/`, to be committed. Shyden's ruling
 * 2026-11-14 (shyden-labs/shyden.co.uk#1158).
 *
 *   SITE_ENVIRONMENT=dev npm run build:web && node apps/web/scripts/make-previews.ts
 *
 * Chromium asks for each page on a made-up origin, and Playwright's own request routing answers from
 * `apps/web/dist` as Workers' assets would (`/x` is `x` or `x.html`, `/x/` is `x/index.html`): no web server runs.
 * The pictures land in `public/`, so the next build carries them.
 */
import { readdirSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { runIfEntry } from '../../../scripts/cli.ts';
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, pagePath, pageUrl, previewKey } from '../src/preview.ts';

/** The origin Chromium asks the built pages from; `.invalid` never resolves, so every request is answered here. */
export const SHOT_ORIGIN = 'https://previews.shytalk.invalid';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const OUT = fileURLToPath(new URL('../public/previews', import.meta.url));

/** The built file under `dist` that a request for `path` gets, as Workers' assets find it; undefined for none. */
export async function builtFileFor(dist: string, path: string, isFile: (file: string) => Promise<boolean>): Promise<string | undefined> {
  // An absolute path normalises to one inside the root, so `..` never leaves `dist`.
  const relative = normalize(`/${decodeURIComponent(path)}`).replace(/^\/+/, '');
  const candidates = relative === '' || relative.endsWith('/') ? [`${relative}index.html`] : [relative, `${relative}.html`];
  for (const candidate of candidates) {
    if (await isFile(join(dist, candidate))) return join(dist, candidate);
  }
  return undefined;
}

/**
 * Shoots each built page, in turn, at its address on SHOT_ORIGIN into its picture under `out`; answers how many.
 * Stops at the first failure, naming the page.
 */
export async function makePreviews(pages: string[], out: string, shoot: (url: string, file: string) => Promise<void>): Promise<number> {
  if (pages.length === 0) throw new Error('no built pages: run npm run build:web first');
  for (const page of pages) {
    try {
      // One page, shot in order: the screenshots share one browser tab.
      await shoot(pageUrl(SHOT_ORIGIN, pagePath(page)), `${out}/${previewKey(page)}.png`); // NOSONAR: in turn by design, one tab
    } catch (error) {
      throw new Error(`${page}: ${(error as Error).message}`, { cause: error });
    }
  }
  return pages.length;
}

const isFile = async (file: string): Promise<boolean> => (await stat(file).catch(() => undefined))?.isFile() ?? false;

export async function main(): Promise<number> {
  const pages = readdirSync(DIST, { recursive: true, encoding: 'utf8' })
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.html'))
    .toSorted((a, b) => a.localeCompare(b));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }, deviceScaleFactor: 1 });
    await page.route(`${SHOT_ORIGIN}/**`, async (route) => {
      const { pathname } = new URL(route.request().url());
      // The site's API answers as it does a signed-out visitor, so each picture shows what opening the link shows.
      if (pathname.startsWith('/api/')) {
        await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
        return;
      }
      const file = await builtFileFor(DIST, pathname, isFile);
      await route.fulfill(file === undefined ? { status: 404 } : { path: file });
    });
    const count = await makePreviews(pages, OUT, async (url, file) => {
      // Quiet network: the page has asked whether it is signed in, and gone where the answer sends it.
      const answer = await page.goto(url, { waitUntil: 'networkidle' });
      if (answer === null) throw new Error('no answer');
      if (answer.status() !== 200) throw new Error(`answered ${String(answer.status())}, not 200`);
      await mkdir(dirname(file), { recursive: true });
      await page.screenshot({ path: file });
    });
    console.log(`make-previews: ${String(count)} pictures in ${OUT}`);
    return 0;
  } finally {
    await browser.close();
  }
}

await runIfEntry(import.meta.url, main);
