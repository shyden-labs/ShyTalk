/**
 * What the smoke suite and its iPhone copy share to check link previews (shyden-labs/ShyTalk#198): the page files the
 * site is built from, the origin the build wrote into each page's addresses, and one check, run inside the browser,
 * that reads a page the way Facebook, WhatsApp and X do (its HTML as served, no scripts run) and loads its picture.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { t, type Locale } from '../../apps/web/src/i18n/t.ts';
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, previewImageUrl, sharedUrl, siteOrigin, type WranglerOrigins } from '../../apps/web/src/preview.ts';

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

/** The tags a link preview is read from. */
export const PREVIEW_TAGS = [
  'og:title',
  'og:description',
  'og:image',
  'og:image:width',
  'og:image:height',
  'og:image:alt',
  'og:url',
  'og:type',
  'twitter:card',
] as const;

/** A page as a link preview reads it: its language, its title, each preview tag's content, and its picture. */
export interface PreviewFacts {
  lang: string | null;
  title: string;
  tags: Record<string, string | null>;
  /** Whether the picture loaded, its size, and whether it holds more than one colour. */
  picture: { loaded: boolean; width: number; height: number; manyColours: boolean };
}

/**
 * A function's source, run in the browser with a page's path: it fetches the page's HTML as served, reads it with
 * DOMParser (which runs no scripts, as a preview fetcher runs none), then loads the picture its `og:image` names from
 * this same server, whatever origin the address names, and reads its pixels through a canvas. Text, as Playwright and
 * WebDriver each send a script's text to the browser; written for every browser the suite runs in.
 */
export const PREVIEW_FACTS = `async (path, keys) => {
  const answer = await fetch(path, { credentials: 'omit' });
  const html = new DOMParser().parseFromString(await answer.text(), 'text/html');
  const tags = {};
  for (const key of keys) {
    const tag = html.querySelector('meta[property="' + key + '"], meta[name="' + key + '"]');
    tags[key] = tag === null ? null : tag.getAttribute('content');
  }
  const picture = { loaded: false, width: 0, height: 0, manyColours: false };
  if (tags['og:image'] !== null) {
    const image = new Image();
    image.src = new URL(tags['og:image'], location.href).pathname;
    try {
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      picture.loaded = true;
      picture.width = image.naturalWidth;
      picture.height = image.naturalHeight;
      for (let i = 4; i < pixels.length && !picture.manyColours; i += 4) {
        picture.manyColours = pixels[i] !== pixels[0] || pixels[i + 1] !== pixels[1] || pixels[i + 2] !== pixels[2];
      }
    } catch (error) {
      picture.loaded = false;
    }
  }
  return { lang: html.documentElement.getAttribute('lang'), title: html.title, tags, picture };
}`;

/**
 * What a page's preview should read, for the page at `path` in `locale`, built for `origin`: `title` is the page's
 * own title, which `og:title` repeats.
 */
export function wantedPreview(origin: string, locale: Locale, lang: string, path: string, title: string): PreviewFacts {
  return {
    lang,
    title,
    tags: {
      'og:title': title,
      'og:description': t(locale, 'site.tagline'),
      'og:image': previewImageUrl(origin, path),
      'og:image:width': String(PREVIEW_WIDTH),
      'og:image:height': String(PREVIEW_HEIGHT),
      'og:image:alt': t(locale, 'site.previewAlt'),
      'og:url': sharedUrl(origin, path),
      'og:type': 'website',
      'twitter:card': 'summary_large_image',
    },
    picture: { loaded: true, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, manyColours: true },
  };
}
