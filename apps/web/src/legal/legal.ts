/**
 * The legal pages (plan 3 Task 6, shyden-labs/ShyTalk#56): English at
 * `/<doc>`, Indonesian at `/id/<doc>`, and no other language (Shyden
 * 2026-11-08). Every other language links to the English page with `?from=`,
 * which shows one line in the visitor's language saying it is English only.
 */
import en from './en.json' with { type: 'json' };
import id from './id.json' with { type: 'json' };
import type { Locale } from '../i18n/t.ts';

export const LEGAL_DOCS = ['privacy', 'terms', 'guidelines'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

/** The languages the note line appears for: those with no legal text of their own. */
export const ENGLISH_ONLY_LOCALES = ['th', 'vi', 'zh'] as const;
type EnglishOnlyLocale = (typeof ENGLISH_ONLY_LOCALES)[number];

/** The date each page names; a release that changes the text moves it. */
export const LEGAL_VERSION = '2026-11-09';

export type LegalLocale = 'en' | 'id';

/** The language a visitor from `locale` reads the legal pages in. */
export const legalLocale = (locale: Locale): LegalLocale => (locale === 'id' ? 'id' : 'en');

export function legalLines(locale: LegalLocale): typeof en {
  return locale === 'id' ? id : en;
}

/** Where `locale`'s footer sends a visitor for `doc`. */
export function legalPath(locale: Locale, doc: LegalDoc): string {
  if (locale === 'en') return `/${doc}`;
  if (locale === 'id') return `/id/${doc}`;
  return `/${doc}?from=${locale}`;
}

/** Which language's note a page opened with this query shows, if any. */
export function englishOnlyNoteLocale(search: string): EnglishOnlyLocale | null {
  const from = new URLSearchParams(search).get('from');
  return ENGLISH_ONLY_LOCALES.find((locale) => locale === from) ?? null;
}

export type LegalBlock = { kind: 'title' | 'heading' | 'paragraph'; text: string } | { kind: 'list'; items: string[] };

/**
 * A document's keys as what they show, in order: `title`; `<name>H`, a section
 * heading; `<name><number>`, a list item, with those in a row one list; anything
 * else a paragraph.
 */
export function legalBlocks(doc: Record<string, string>): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  for (const [key, text] of Object.entries(doc)) {
    const last = blocks.at(-1);
    if (key === 'title') blocks.push({ kind: 'title', text });
    else if (key.endsWith('H')) blocks.push({ kind: 'heading', text });
    else if (!/\d$/.test(key)) blocks.push({ kind: 'paragraph', text });
    else if (last?.kind === 'list') last.items.push(text);
    else blocks.push({ kind: 'list', items: [text] });
  }
  return blocks;
}
