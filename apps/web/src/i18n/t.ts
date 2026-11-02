/**
 * The site's languages and lines (plan 3 Task 1, shyden-labs/ShyTalk#51).
 * English is at `/`, every other language under its prefix. A missing line
 * throws naming key and language, so a build never falls back to English.
 */
import en from './en.json' with { type: 'json' };
import id from './id.json' with { type: 'json' };
import th from './th.json' with { type: 'json' };
import vi from './vi.json' with { type: 'json' };
import zh from './zh.json' with { type: 'json' };

export const LOCALES = ['en', 'id', 'th', 'vi', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

const CATALOGUES: Record<Locale, unknown> = { en, id, th, vi, zh };

/** The line at a dotted key, e.g. `t('th', 'menu.home')`. */
export function t(locale: Locale, key: string): string {
  let node: unknown = CATALOGUES[locale];
  for (const part of key.split('.')) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  if (typeof node !== 'string') throw new Error(`no line "${key}" in ${locale}`);
  return node;
}

/** A site path in a language: English unprefixed, the others under `/<locale>`. */
export const localePath = (locale: Locale, path: string): string => (locale === 'en' ? path : `/${locale}${path}`);
