import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOCALES, localePath, t, type Locale } from '../../apps/web/src/i18n/t.ts';

/**
 * The site's languages (plan 3 Task 1, shyden-labs/ShyTalk#51): English at
 * `/`, the others under their prefix. A line missing in any language fails
 * the build naming key and language; nothing falls back to English.
 */

type Lines = Record<string, unknown>;
const catalogue = (locale: Locale): Lines => JSON.parse(readFileSync(`apps/web/src/i18n/${locale}.json`, 'utf8')) as Lines;

/** Every dotted key with its value. */
function flat(node: Lines, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [name, value] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (value && typeof value === 'object' && !Array.isArray(value)) for (const [k, v] of flat(value as Lines, key)) out.set(k, v);
    else out.set(key, value);
  }
  return out;
}

const english = flat(catalogue('en'));

describe('the languages', () => {
  it('are English, Indonesian, Thai, Vietnamese and Simplified Chinese, English first', () => {
    expect(LOCALES).toEqual(['en', 'id', 'th', 'vi', 'zh']);
  });

  it('has English lines, each non-empty text', () => {
    expect(english.size).toBeGreaterThan(0);
    for (const [key, value] of english) expect(typeof value === 'string' && value.trim() !== '', key).toBe(true);
  });

  it.each(['id', 'th', 'vi', 'zh'] as const)('%s has every English line, non-empty, and no line English lacks', (locale) => {
    const lines = flat(catalogue(locale));
    for (const key of english.keys()) {
      const value = lines.get(key);
      expect(typeof value === 'string' && value.trim() !== '', `${locale} ${key}`).toBe(true);
    }
    expect([...lines.keys()].filter((key) => !english.has(key))).toEqual([]);
  });
});

describe('t', () => {
  it('gives the line in the language', () => {
    expect(t('en', 'menu.home')).toBe(english.get('menu.home'));
  });

  it('throws naming the key and language when a line is missing', () => {
    expect(() => t('th', 'missing')).toThrow('no line "missing" in th');
    expect(() => t('en', 'menu')).toThrow('no line "menu" in en');
  });

  it('throws when the key reaches past a line, rather than reading into the text', () => {
    expect(() => t('id', 'menu.home.length')).toThrow('no line "menu.home.length" in id');
  });

  it('throws when the key reaches past a missing section', () => {
    expect(() => t('vi', 'nowhere.home')).toThrow('no line "nowhere.home" in vi');
  });
});

describe('localePath', () => {
  it.each([
    ['en', '/', '/'],
    ['en', '/closed-testing', '/closed-testing'],
    ['id', '/', '/id/'],
    ['zh', '/closed-testing', '/zh/closed-testing'],
  ] as const)('%s %s is %s', (locale, path, expected) => {
    expect(localePath(locale, path)).toBe(expected);
  });
});
