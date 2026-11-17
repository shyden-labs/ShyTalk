import { describe, it, expect } from 'vitest';
import { sitePages } from '../../apps/web/src/site-pages.ts';

/**
 * Every page the site builds, by language (shyden-labs/ShyTalk#198), from the
 * page files Astro reads, so each test of every page sees a new page at once.
 */

describe('sitePages', () => {
  it('builds an English page at the top level, named as Astro writes it', () => {
    expect(sitePages(['index.astro', 'privacy.astro', 'sign-up/index.astro'], 'en')).toEqual([
      'index.html',
      'privacy.html',
      'sign-up/index.html',
    ]);
  });

  it('builds a [locale] page once in each other language, never in English', () => {
    const files = ['[locale]/index.astro', '[locale]/closed-testing/confirm.astro'];
    expect(sitePages(files, 'en')).toEqual([]);
    expect(sitePages(files, 'th')).toEqual(['th/index.html', 'th/closed-testing/confirm.html']);
    expect(sitePages(files, 'zh')).toEqual(['zh/index.html', 'zh/closed-testing/confirm.html']);
  });

  it('builds a page in a language folder in that language only', () => {
    const files = ['id/privacy.astro', 'privacy.astro'];
    expect(sitePages(files, 'id')).toEqual(['id/privacy.html']);
    expect(sitePages(files, 'en')).toEqual(['privacy.html']);
    expect(sitePages(files, 'vi')).toEqual([]);
  });

  it('leaves out anything that is not a page file', () => {
    expect(sitePages(['index.astro', 'notes.md', 'id', 'sign-up', 'feed.ts'], 'en')).toEqual(['index.html']);
  });

  it('reads Windows-style separators as folders', () => {
    expect(sitePages(['[locale]\\sign-in\\index.astro'], 'vi')).toEqual(['vi/sign-in/index.html']);
  });
});
