import { describe, it, expect } from 'vitest';
import { IPHONE_CASES, type SafariPage } from '../phones/iphone-cases.ts';
import { t, type Locale } from '../../apps/web/src/i18n/t.ts';
import { legalLines, legalLocale } from '../../apps/web/src/legal/legal.ts';

/**
 * Each case of the iPhone copy checks what its Playwright twin checks
 * (shyden-labs/ShyTalk#112): here Safari is a stand-in page that behaves as
 * the site should, and each test breaks one thing a case must catch.
 */

const LOCALE: Record<string, Locale> = { en: 'en', id: 'id', th: 'th', vi: 'vi', 'zh-Hans': 'zh' };
const PREFIX: Record<string, string> = { en: '', id: '/id', th: '/th', vi: '/vi', 'zh-Hans': '/zh' };

/** What each selector holds on the site as it should be. */
function selectorText(locale: Locale, selector: string): string {
  const line = /data-line="(\w+)"/.exec(selector)?.[1];
  if (line !== undefined) return t(locale, `closedTesting.${line}`);
  if (selector === 'label[for="apply-email"]') return t(locale, 'closedTesting.emailLabel');
  if (selector === 'label[for="apply-adult"]') return t(locale, 'closedTesting.adultLabel');
  if (selector === '#apply-submit') return t(locale, 'closedTesting.submit');
  if (selector === '#confirm-button') return t(locale, 'closedTesting.confirmButton');
  if (selector === '[data-governs]') return legalLines(legalLocale(locale)).common.governs;
  if (selector.startsWith('[data-english-only')) return t(locale, 'footer.englishOnly');
  return t(locale, 'home.heading');
}

/** Safari showing the site as it should be, in `lang`; `broken` replaces one answer. */
function safari(lang: string, broken: Partial<SafariPage> = {}): SafariPage & { visited: string[] } {
  const locale = LOCALE[lang] ?? 'en';
  const visited: string[] = [];
  let onLegalPage = false;
  return {
    visited,
    goto: (path) => {
      visited.push(path);
      return Promise.resolve(path.endsWith('/no-such-page') ? 404 : 200);
    },
    cspRefusals: () => Promise.resolve([]),
    attribute: (selector, name) =>
      Promise.resolve(selector === 'html' && name === 'lang' ? (onLegalPage ? legalLocale(locale) : lang) : null),
    isVisible: (selector) => Promise.resolve(selector !== '[data-english-only]:not([hidden])'),
    text: (selector) => Promise.resolve(selectorText(locale, selector)),
    tap: () => {
      onLegalPage = true;
      return Promise.resolve();
    },
    waitForText: () => Promise.resolve(),
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

  it.each(cases('the home page answers').map((c) => [c.title, c] as const))(
    '%s: fails on a hidden or wrong heading, a hidden apply link or a roadmap link',
    async (_, c) => {
      const lang = langOf(c.title);
      const roadmap = t(LOCALE[lang] ?? 'en', 'home.roadmap');
      await expect(c.run(safari(lang, { isVisible: (selector) => Promise.resolve(selector.startsWith('nav')) }))).rejects.toThrow(
        'no visible top heading',
      );
      await expect(c.run(safari(lang, { text: () => Promise.resolve('Something else') }))).rejects.toThrow('Something else');
      await expect(c.run(safari(lang, { visibleLinks: () => Promise.resolve(0) }))).rejects.toThrow('no visible apply link');
      await expect(c.run(safari(lang, { links: (name) => Promise.resolve(name === roadmap ? 1 : 0) }))).rejects.toThrow();
    },
  );

  it.each(cases('the home page answers').map((c) => [c.title, c] as const))('%s: fails on any axe violation', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { axeViolations: () => Promise.resolve(['color-contrast: 1']) }))).rejects.toThrow(
      'color-contrast: 1',
    );
  });

  // One journey, all its assertions (Shyden 2026-11-09, shyden-labs/ShyTalk#151):
  // the home page is opened once, and every check runs even after one fails.
  it.each(cases('the home page answers').map((c) => [c.title, c] as const))(
    '%s: opens the home page once and names every failing check, not only the first',
    async (_, c) => {
      const lang = langOf(c.title);
      const page = safari(lang);
      await c.run(page);
      expect(page.visited).toEqual([`${PREFIX[lang] ?? '?'}/`]);
      const broken = c.run(safari(lang, { goto: () => Promise.resolve(500), axeViolations: () => Promise.resolve(['color-contrast: 1']) }));
      await expect(broken).rejects.toThrow(/500[\s\S]*color-contrast: 1/);
    },
  );

  const named = (start: string) => cases(start).map((c) => [c.title, c] as const);

  it('holds both closed-testing cases in every language', () => {
    expect(named('the closed-testing page shows')).toHaveLength(5);
    expect(named('the confirm page')).toHaveLength(5);
  });

  it.each(named('the closed-testing page shows'))('%s: fails on anything but 200', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { goto: () => Promise.resolve(404) }))).rejects.toThrow();
  });

  it.each(named('the closed-testing page shows'))('%s: fails when a statement is hidden', async (_, c) => {
    const hidden = (selector: string): Promise<boolean> => Promise.resolve(!selector.includes('retention'));
    await expect(c.run(safari(langOf(c.title), { isVisible: hidden }))).rejects.toThrow('retention');
  });

  it.each(named('the closed-testing page shows'))('%s: fails when a statement holds other words', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { text: () => Promise.resolve('other words') }))).rejects.toThrow();
  });

  it.each(named('the closed-testing page shows'))('%s: fails on a CSP refusal', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { cspRefusals: () => Promise.resolve(['refused']) }))).rejects.toThrow();
  });

  it.each(named('the closed-testing page shows'))('%s: fails on any axe violation', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { axeViolations: () => Promise.resolve(['label: 1']) }))).rejects.toThrow();
  });

  it.each(named('the confirm page'))('%s: fails on any axe violation', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { axeViolations: () => Promise.resolve(['label: 1']) }))).rejects.toThrow();
  });

  it.each(named('the confirm page'))('%s: taps the button, then waits for the expired heading', async (_, c) => {
    const lang = langOf(c.title);
    const tapped: string[] = [];
    const waited: [string, string][] = [];
    await c.run(
      safari(lang, {
        tap: (selector) => {
          tapped.push(selector);
          return Promise.resolve();
        },
        waitForText: (selector, text) => {
          waited.push([selector, text]);
          return Promise.resolve();
        },
      }),
    );
    expect(tapped).toEqual(['#confirm-button']);
    expect(waited[0]?.[1]).toBe(t(LOCALE[lang] ?? 'en', 'closedTesting.expiredHeading'));
  });

  it.each(named('the confirm page'))('%s: fails when the heading never comes', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { waitForText: () => Promise.reject(new Error('no heading')) }))).rejects.toThrow(
      'no heading',
    );
  });

  it.each(named('the confirm page'))('%s: fails on a CSP refusal', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { cspRefusals: () => Promise.resolve(['refused']) }))).rejects.toThrow();
  });

  it('holds a legal-links case in every language', () => {
    expect(named('each footer legal link')).toHaveLength(5);
  });

  it.each(named('each footer legal link'))('%s: taps each link, reads its heading in the right language, and checks axe', async (_, c) => {
    const lang = langOf(c.title);
    const locale = LOCALE[lang] ?? 'en';
    const words = legalLines(legalLocale(locale));
    const tapped: string[] = [];
    const waited: string[] = [];
    let axe = 0;
    await c.run(
      safari(lang, {
        attribute: () => Promise.resolve(legalLocale(locale)),
        tap: (selector) => {
          tapped.push(selector);
          return Promise.resolve();
        },
        waitForText: (_selector, text) => {
          waited.push(text);
          return Promise.resolve();
        },
        axeViolations: () => {
          axe += 1;
          return Promise.resolve([]);
        },
      }),
    );
    expect(tapped).toEqual(['privacy', 'terms', 'guidelines'].map((doc) => `footer a[data-legal="${doc}"]`));
    expect(waited).toEqual([words.privacy.title, words.terms.title, words.guidelines.title]);
    expect(axe).toBe(3);
  });

  it.each(named('each footer legal link'))('%s: fails when a page is in the wrong language', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { attribute: () => Promise.resolve('fr') }))).rejects.toThrow();
  });

  it.each(named('each footer legal link'))('%s: fails on any axe violation', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { axeViolations: () => Promise.resolve(['label: 1']) }))).rejects.toThrow();
  });
});
