import { describe, it, expect } from 'vitest';
import { IPHONE_CASES, type SafariPage } from '../phones/iphone-cases.ts';
import { t, type Locale } from '../../apps/web/src/i18n/t.ts';

/**
 * Each case of the iPhone copy checks what its Playwright twin checks
 * (shyden-labs/ShyTalk#112): here Safari is a stand-in page that behaves as
 * the site should, and each test breaks one thing a case must catch.
 */

const LOCALE: Record<string, Locale> = { en: 'en', id: 'id', th: 'th', vi: 'vi', 'zh-Hans': 'zh' };
const PREFIX: Record<string, string> = { en: '', id: '/id', th: '/th', vi: '/vi', 'zh-Hans': '/zh' };

/** Safari showing the site as it should be, in `lang`; `broken` replaces one answer. */
function safari(lang: string, broken: Partial<SafariPage> = {}): SafariPage & { visited: string[] } {
  const locale = LOCALE[lang] ?? 'en';
  const visited: string[] = [];
  return {
    visited,
    goto: (path) => {
      visited.push(path);
      return Promise.resolve(path.endsWith('/no-such-page') ? 404 : 200);
    },
    cspRefusals: () => Promise.resolve([]),
    attribute: (selector, name) => Promise.resolve(selector === 'html' && name === 'lang' ? lang : null),
    isVisible: () => Promise.resolve(true),
    text: () => Promise.resolve(t(locale, 'home.heading')),
    visibleLinks: (name) => Promise.resolve(name === t(locale, 'home.apply') ? 1 : 0),
    links: (name) => Promise.resolve(name === t(locale, 'home.apply') ? 1 : 0),
    axeViolations: () => Promise.resolve([]),
    ...broken,
  };
}

const kind = (title: string): string => title.replace(/^[^:]+: /, '').split(' in ')[0] ?? '';
const langOf = (title: string): string => title.split(':')[0] ?? '';
const cases = (start: string) => IPHONE_CASES.filter(({ title }) => kind(title).startsWith(start));

describe('the iPhone cases', () => {
  it.each(IPHONE_CASES.map((c) => [c.title, c] as const))('%s: passes on the site as it should be', async (_, c) => {
    const page = safari(langOf(c.title));
    await expect(c.run(page)).resolves.toBeUndefined();
    expect(page.visited[0]?.startsWith(PREFIX[langOf(c.title)] ?? '?')).toBe(true);
  });

  it.each(cases('the home page answers').map((c) => [c.title, c] as const))('%s: fails on anything but 200', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { goto: () => Promise.resolve(500) }))).rejects.toThrow();
  });

  it.each(cases('an unknown page').map((c) => [c.title, c] as const))(
    '%s: fails on anything but 404, and asks for the unknown page',
    async (_, c) => {
      const page = safari(langOf(c.title));
      await c.run(page);
      expect(page.visited).toEqual([`${PREFIX[langOf(c.title)] ?? '?'}/no-such-page`]);
      await expect(c.run(safari(langOf(c.title), { goto: () => Promise.resolve(200) }))).rejects.toThrow();
    },
  );

  it.each([...cases('the home page answers'), ...cases('an unknown page')].map((c) => [c.title, c] as const))(
    '%s: fails on the wrong language, a hidden navigation or a CSP refusal',
    async (_, c) => {
      const lang = langOf(c.title);
      await expect(c.run(safari(lang, { attribute: () => Promise.resolve('fr') }))).rejects.toThrow();
      await expect(c.run(safari(lang, { isVisible: () => Promise.resolve(false) }))).rejects.toThrow();
      await expect(c.run(safari(lang, { cspRefusals: () => Promise.resolve(['Refused to load x']) }))).rejects.toThrow();
    },
  );

  it.each(cases('the home page shows').map((c) => [c.title, c] as const))(
    '%s: fails on a hidden or wrong heading, a hidden apply link or a roadmap link',
    async (_, c) => {
      const lang = langOf(c.title);
      const roadmap = t(LOCALE[lang] ?? 'en', 'home.roadmap');
      await expect(c.run(safari(lang, { isVisible: () => Promise.resolve(false) }))).rejects.toThrow();
      await expect(c.run(safari(lang, { text: () => Promise.resolve('Something else') }))).rejects.toThrow();
      await expect(c.run(safari(lang, { visibleLinks: () => Promise.resolve(0) }))).rejects.toThrow();
      await expect(c.run(safari(lang, { links: (name) => Promise.resolve(name === roadmap ? 1 : 0) }))).rejects.toThrow();
    },
  );

  it.each(cases('the home page passes axe').map((c) => [c.title, c] as const))('%s: fails on any axe violation', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { axeViolations: () => Promise.resolve(['color-contrast: 1']) }))).rejects.toThrow();
  });
});
