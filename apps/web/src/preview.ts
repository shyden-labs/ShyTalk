/**
 * Link previews (shyden-labs/ShyTalk#198): every page carries Open Graph tags whose picture is a real screenshot of
 * the top of that page, one per page and language, made from the built site by `apps/web/scripts/make-previews.ts`
 * and committed under `public/previews/`. Shyden's ruling 2026-11-14 (shyden-labs/shyden.co.uk#1158).
 */
import { LOCALES, type Locale } from './i18n/t.ts';

/** The size Facebook, WhatsApp and X show a large preview at. */
export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 630;

/** A built file's path as the site serves it: `id/index.html` is `/id/`, `id/privacy.html` stays. */
export const pagePath = (builtFile: string): string => `/${builtFile.replace(/(^|\/)index\.html$/, '$1')}`;

/** The address a page is served at on `origin`: Workers' assets answer without `.html`. */
export const pageUrl = (origin: string, path: string): string => `${origin}${path.replace(/\.html$/, '')}`;

/** A page's picture name, from its path or built file: folders kept, `.html` dropped, a folder page named `index`. */
export function previewKey(path: string): string {
  const relative = path.replace(/^\//, '');
  return relative === '' || relative.endsWith('/') ? `${relative}index` : relative.replace(/\.html$/, '');
}

export const previewImageUrl = (origin: string, path: string): string => `${origin}/previews/${previewKey(path)}.png`;

const EACH_LANGUAGE = '[locale]/';

/**
 * The pages the site builds in `locale`, as built files, from the page files under `src/pages` (as a recursive
 * `readdirSync` lists them): a `[locale]` page in every language but English, a page in a language's own folder in
 * that language only, and any other page in English.
 */
export function sitePages(files: readonly string[], locale: Locale): string[] {
  const built = files
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.astro'))
    .map((file) => file.replace(/\.astro$/, '.html'));
  if (locale === 'en') {
    return built.filter((file) => !file.startsWith(EACH_LANGUAGE) && !LOCALES.some((other) => file.startsWith(`${other}/`)));
  }
  return [
    ...built.filter((file) => file.startsWith(EACH_LANGUAGE)).map((file) => `${locale}/${file.slice(EACH_LANGUAGE.length)}`),
    ...built.filter((file) => file.startsWith(`${locale}/`)),
  ];
}

/** The part of workers/web/wrangler.json read here. */
export interface WranglerOrigins {
  env: Record<string, { vars?: { SITE_ORIGIN?: string } }>;
}

/**
 * The origin of the environment the site is built for (`SITE_ENVIRONMENT`), read from the Worker's own
 * `SITE_ORIGIN`, so a preview's addresses name the host serving it. A build naming none, or one the Worker lacks,
 * stops.
 */
export function siteOrigin(environment: string | undefined, wrangler: WranglerOrigins): string {
  if (environment === undefined || environment === '') {
    throw new Error('SITE_ENVIRONMENT is unset: name the environment the site is built for (dev, prod or test)');
  }
  const names = Object.keys(wrangler.env).toSorted((a, b) => a.localeCompare(b));
  if (!names.includes(environment)) {
    throw new Error(`SITE_ENVIRONMENT ${environment} is not one of ${names.join(', ')} in workers/web/wrangler.json`);
  }
  const origin = wrangler.env[environment]?.vars?.SITE_ORIGIN;
  if (origin === undefined || origin === '') throw new Error(`workers/web/wrangler.json gives ${environment} no SITE_ORIGIN`);
  return origin;
}

/** The environment whose `SITE_ORIGIN` an address is on: what a run against a deployed site was built for. */
export function environmentAt(address: string, wrangler: WranglerOrigins): string {
  const { origin } = new URL(address);
  const found = Object.entries(wrangler.env).find(([, settings]) => settings.vars?.SITE_ORIGIN === origin);
  if (found === undefined) throw new Error(`${origin} is the SITE_ORIGIN of no environment in workers/web/wrangler.json`);
  return found[0];
}
