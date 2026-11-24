/**
 * The one language menu every page carries (shyden-labs/ShyTalk#332), as on shyden.co.uk: a flag and the language's
 * name, opening a list of every language, each leading to the same page in that language.
 */
import { LEGAL_DOCS, legalPath } from '../legal/legal.ts';
import { LOCALES, localePath, type Locale } from './t.ts';

/** Each language's name as the menu's button shows it on a narrow screen. */
export const SHORT_NAMES: Record<Locale, string> = { en: 'EN', id: 'ID', th: 'ไทย', vi: 'VI', zh: '中文' };

/** Below this width the button shows the short name; from it up, the full name (kept in step with site.css). */
export const FULL_NAME_WIDTH = 720;

const PREFIX = new RegExp(`^/(${LOCALES.join('|')})(?=/)`);

/**
 * Where the entry for `other` leads from the page at `path` (`Astro.url.pathname`): the holding page to each
 * language's own prefixed home (the bare address is the holding page itself while production holds), the not-found
 * page to each language's home, a legal page to its text in that language, any other page to itself in that language.
 */
export function menuHref(path: string, other: Locale): string {
  const unprefixed = path.replace(PREFIX, '').replace(/\.html$/, '');
  if (unprefixed === '/holding') return `/${other}/`;
  if (unprefixed === '/404') return localePath(other, '/');
  const doc = LEGAL_DOCS.find((name) => unprefixed === `/${name}`);
  return doc === undefined ? localePath(other, unprefixed) : legalPath(other, doc);
}
