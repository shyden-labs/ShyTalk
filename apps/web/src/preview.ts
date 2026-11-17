/**
 * Link previews (shyden-labs/ShyTalk#198): every page carries Open Graph tags
 * whose picture is a real screenshot of the top of that page, one per page and
 * language, made from the built site (apps/web/make-previews.ts) and committed
 * under `public/previews/`. Shyden's ruling 2026-11-14 (shyden-labs/shyden.co.uk#1158).
 */

/** The size Facebook, WhatsApp and X show a large preview at. */
export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 630;

/**
 * A page's name for its picture, from the path Astro gives it (`/`, `/id/`,
 * `/closed-testing.html`) or its built file (`id/index.html`): folders kept,
 * `.html` dropped, a folder page named `index`.
 */
export function previewKey(path: string): string {
  const relative = path.replace(/^\//, '');
  if (relative === '' || relative.endsWith('/')) return `${relative}index`;
  return relative.replace(/\.html$/, '');
}

/** A built page's path as Astro names it while building (`id/index.html` is `/id/`, `id/privacy.html` stays). */
export const pagePath = (builtFile: string): string => `/${builtFile.replace(/(^|\/)index\.html$/, '$1')}`;

/** The address the site serves the page at: Workers' assets answer without `.html`. */
export const pageUrl = (origin: string, path: string): string => `${origin}${path.replace(/\.html$/, '')}`;

export const previewImageUrl = (origin: string, path: string): string => `${origin}/previews/${previewKey(path)}.png`;

/** The part of workers/web/wrangler.json this reads. */
export interface WranglerOrigins {
  env: Record<string, { vars?: { SITE_ORIGIN?: string } }>;
}

/**
 * The origin of the environment the site is built for (`SITE_ENVIRONMENT`),
 * read from the Worker's own `SITE_ORIGIN`, so a preview's addresses name the
 * host that serves it. A build naming none, or one the Worker lacks, stops.
 */
export function siteOrigin(environment: string | undefined, wrangler: WranglerOrigins): string {
  if (environment === undefined || environment === '') {
    throw new Error('SITE_ENVIRONMENT is unset: name the environment the site is built for (dev, test or prod)');
  }
  const names = Object.keys(wrangler.env);
  if (!names.includes(environment)) {
    throw new Error(`SITE_ENVIRONMENT ${environment} is not one of ${names.sort().join(', ')} in workers/web/wrangler.json`);
  }
  const origin = wrangler.env[environment]?.vars?.SITE_ORIGIN;
  if (origin === undefined || origin === '') throw new Error(`workers/web/wrangler.json gives ${environment} no SITE_ORIGIN`);
  return origin;
}

export interface PreviewDeps {
  /** Every built page, as its path under the build folder (`id/index.html`). */
  pages(): string[];
  /** Screenshots the top of `url` at PREVIEW_WIDTH by PREVIEW_HEIGHT into `file`. */
  shoot(url: string, file: string): Promise<void>;
}

/** Shoots every built page, served at `server`, into `out`; answers how many. Stops at the first failure, naming the page. */
export async function makePreviews(server: string, out: string, deps: PreviewDeps): Promise<number> {
  const pages = deps.pages();
  if (pages.length === 0) throw new Error('no built pages: run npm run build:web first');
  for (const page of pages) {
    try {
      await deps.shoot(pageUrl(server, pagePath(page)), `${out}/${previewKey(page)}.png`);
    } catch (error) {
      throw new Error(`${page}: ${(error as Error).message}`, { cause: error });
    }
  }
  return pages.length;
}
