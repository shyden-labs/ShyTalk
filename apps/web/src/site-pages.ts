/**
 * Every page the site builds in one language (shyden-labs/ShyTalk#198), as
 * the file Astro writes (`id/closed-testing.html`, `sign-up/index.html`), from
 * the page files under `src/pages` (paths relative to it, as
 * `readdirSync(pages, { recursive: true })` lists them). A `[locale]` page is
 * built in every language but English; a page in a language's folder in that
 * language only; any other page in English.
 */
import { LOCALES, type Locale } from './i18n/t.ts';

const LOCALE_PARAM = '[locale]/';

function languageOf(file: string): Locale {
  const first = file.split('/')[0];
  return LOCALES.find((locale) => locale !== 'en' && locale === first) ?? 'en';
}

export function sitePages(files: readonly string[], locale: Locale): string[] {
  const pages: string[] = [];
  for (const raw of files) {
    const file = raw.replaceAll('\\', '/');
    if (!file.endsWith('.astro')) continue;
    const built = file.replace(/\.astro$/, '.html');
    if (built.startsWith(LOCALE_PARAM)) {
      if (locale !== 'en') pages.push(`${locale}/${built.slice(LOCALE_PARAM.length)}`);
    } else if (languageOf(built) === locale) {
      pages.push(built);
    }
  }
  return pages;
}
