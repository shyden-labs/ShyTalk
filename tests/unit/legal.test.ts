import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { LEGAL_DOCS, englishOnlyNoteLocale, legalBlocks, legalLines, legalPath } from '../../apps/web/src/legal/legal.ts';
import { LOCALES, t } from '../../apps/web/src/i18n/t.ts';

/**
 * The legal pages (plan 3 Task 6, shyden-labs/ShyTalk#56): English and
 * Indonesian only (Shyden 2026-11-08; PP 17/2025 Art. 11, PP 71/2019 Art.
 * 47(1), UU 27/2022 Art. 22). Every other language links to the English page,
 * which says so in one line of the visitor's language.
 */

type Lines = Record<string, unknown>;
const catalogue = (path: string): Lines => JSON.parse(readFileSync(path, 'utf8')) as Lines;

describe('legalPath', () => {
  it.each(LEGAL_DOCS)('gives English the unprefixed %s', (doc) => {
    expect(legalPath('en', doc)).toBe(`/${doc}`);
  });

  it.each(LEGAL_DOCS)('gives Indonesian its own %s', (doc) => {
    expect(legalPath('id', doc)).toBe(`/id/${doc}`);
  });

  it.each(['th', 'vi', 'zh'] as const)('sends %s to the English page, saying where from', (locale) => {
    expect(legalPath(locale, 'privacy')).toBe(`/privacy?from=${locale}`);
  });
});

describe('englishOnlyNoteLocale', () => {
  it.each(['th', 'vi', 'zh'])('shows the note to a visitor from %s', (locale) => {
    expect(englishOnlyNoteLocale(`?from=${locale}`)).toBe(locale);
  });

  it.each(['', '?from=en', '?from=id', '?from=fr', '?from=constructor', '?other=th'])('shows no note for "%s"', (search) => {
    expect(englishOnlyNoteLocale(search)).toBeNull();
  });
});

describe('legalBlocks', () => {
  it('turns a document’s keys into its heading, sections, paragraphs and lists, in order', () => {
    const doc = { title: 'T', aH: 'A', a: 'para', a1: 'one', a2: 'two', b: 'after', cH: 'C', c1: 'three' };
    expect(legalBlocks(doc)).toEqual([
      { kind: 'title', text: 'T' },
      { kind: 'heading', text: 'A' },
      { kind: 'paragraph', text: 'para' },
      { kind: 'list', items: ['one', 'two'] },
      { kind: 'paragraph', text: 'after' },
      { kind: 'heading', text: 'C' },
      { kind: 'list', items: ['three'] },
    ]);
  });
});

describe('the legal text', () => {
  it.each(LEGAL_DOCS)('%s has one title in each language', (doc) => {
    for (const locale of ['en', 'id'] as const) {
      const titles = legalBlocks(legalLines(locale)[doc]).filter(({ kind }) => kind === 'title');
      expect(titles).toHaveLength(1);
    }
  });

  it('holds the same keys, in the same order, in English and Indonesian', () => {
    expect(JSON.stringify(legalLines('id'), (_key, value: unknown) => (typeof value === 'string' ? '' : value))).toBe(
      JSON.stringify(legalLines('en'), (_key, value: unknown) => (typeof value === 'string' ? '' : value)),
    );
  });

  it('says which text governs for whom, in both languages', () => {
    expect(legalLines('en').common.governs).toContain('Indonesia');
    expect(legalLines('id').common.governs).toContain('Indonesia');
  });

  it('exists in English and Indonesian only', () => {
    expect(
      readdirSync('apps/web/src/legal')
        .filter((name) => name.endsWith('.json'))
        .sort(),
    ).toEqual(['en.json', 'id.json']);
  });

  it.each(LOCALES)('is not in the %s site catalogue', (locale) => {
    const lines = catalogue(`apps/web/src/i18n/${locale}.json`);
    for (const doc of LEGAL_DOCS) expect(lines[doc], doc).toBeUndefined();
  });

  it('has no route under the other languages', () => {
    for (const doc of LEGAL_DOCS) {
      expect(existsSync(`apps/web/src/pages/[locale]/${doc}.astro`), doc).toBe(false);
      expect(existsSync(`apps/web/src/pages/${doc}.astro`), doc).toBe(true);
      expect(existsSync(`apps/web/src/pages/id/${doc}.astro`), doc).toBe(true);
    }
  });

  it('has every Indonesian line in the read-back table', () => {
    const table = readFileSync('apps/web/src/legal/read-back-id.md', 'utf8');
    const walk = (node: unknown): string[] => (typeof node === 'string' ? [node] : Object.values(node as Lines).flatMap(walk));
    for (const line of walk(legalLines('id'))) expect(table, line).toContain(line);
  });
});

describe('the note line', () => {
  it.each(['th', 'vi', 'zh'] as const)('exists in %s, in that language', (locale) => {
    expect(t(locale, 'footer.englishOnly')).not.toBe(t('en', 'footer.englishOnly'));
  });
});
