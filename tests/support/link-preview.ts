/**
 * What the smoke suite and its iPhone copy share to check link previews
 * (shyden-labs/ShyTalk#198): the page files the site is built from, the
 * origin the build wrote into each page's addresses, and the check of a
 * preview picture, which runs inside the browser on each.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { siteOrigin, type WranglerOrigins } from '../../apps/web/src/preview.ts';

/** Every page file the site is built from, as `readdirSync(…, { recursive: true })` lists them. */
export const PAGE_FILES: string[] = readdirSync(fileURLToPath(new URL('../../apps/web/src/pages', import.meta.url)), {
  recursive: true,
  encoding: 'utf8',
});

/**
 * The origin of the environment the site was built for (`SITE_ENVIRONMENT`), as the build reads it: called when a
 * test runs, so a run naming no environment fails that test, naming why.
 */
export function builtSiteOrigin(): string {
  const wrangler = readFileSync(fileURLToPath(new URL('../../workers/web/wrangler.json', import.meta.url)), 'utf8');
  return siteOrigin(process.env.SITE_ENVIRONMENT, JSON.parse(wrangler) as WranglerOrigins);
}

/** What a preview picture shows: whether it loaded, its size, and whether it holds more than one colour. */
export interface PictureFacts {
  loaded: boolean;
  width: number;
  height: number;
  manyColours: boolean;
}

/**
 * A function's source, run in the page with the picture's path: it loads the picture and reads its pixels through a
 * canvas, answering PictureFacts. Text, as Playwright and WebDriver each send a script's text to the browser.
 */
export const PICTURE_FACTS = `async (src) => {
  const image = new Image();
  image.src = src;
  try {
    await image.decode();
  } catch {
    return { loaded: false, width: 0, height: 0, manyColours: false };
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let manyColours = false;
  for (let i = 4; i < pixels.length && !manyColours; i += 4) {
    manyColours = pixels[i] !== pixels[0] || pixels[i + 1] !== pixels[1] || pixels[i + 2] !== pixels[2];
  }
  return { loaded: true, width: image.naturalWidth, height: image.naturalHeight, manyColours };
}`;

/** A preview tag by its name, whether the page gives it as `property` (Open Graph) or `name` (X). */
export const previewTag = (key: string): string => `meta[property="${key}"], meta[name="${key}"]`;
