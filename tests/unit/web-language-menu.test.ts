import { describe, it, expect } from 'vitest';
import { menuHref, SHORT_NAMES } from '../../apps/web/src/i18n/language-menu.ts';

/**
 * Where each entry of the language menu leads (shyden-labs/ShyTalk#332), from the page's own path as the build
 * serves it (`Astro.url.pathname`: `/th/`, `/th/support.html`, `/id/privacy.html`).
 */
describe('menuHref', () => {
  it('leads from a home page to each language’s home', () => {
    expect(menuHref('/', 'th')).toBe('/th/');
    expect(menuHref('/th/', 'en')).toBe('/');
    expect(menuHref('/vi/', 'zh')).toBe('/zh/');
  });

  it('leads from any other page to the same page under the language’s prefix, without .html', () => {
    expect(menuHref('/support.html', 'id')).toBe('/id/support');
    expect(menuHref('/th/support.html', 'en')).toBe('/support');
    expect(menuHref('/zh/closed-testing/confirmed.html', 'vi')).toBe('/vi/closed-testing/confirmed');
    expect(menuHref('/vi/sign-up/', 'th')).toBe('/th/sign-up/');
  });

  it('leads from the holding page to each language’s home with its prefix: English is /en/, as the bare address holds', () => {
    expect(menuHref('/holding.html', 'en')).toBe('/en/');
    expect(menuHref('/th/holding.html', 'id')).toBe('/id/');
  });

  it('leads from the not-found page to each language’s home', () => {
    expect(menuHref('/404.html', 'th')).toBe('/th/');
    expect(menuHref('/id/404.html', 'en')).toBe('/');
  });

  it('leads from a legal page to its text in that language, English with the language’s note where it has none', () => {
    expect(menuHref('/privacy.html', 'id')).toBe('/id/privacy');
    expect(menuHref('/id/terms.html', 'en')).toBe('/terms');
    expect(menuHref('/privacy.html', 'th')).toBe('/privacy?from=th');
  });
});

describe('SHORT_NAMES', () => {
  it('names each language in two letters, or its own script where Latin letters would not be its name', () => {
    expect(SHORT_NAMES).toEqual({ en: 'EN', id: 'ID', th: 'ไทย', vi: 'VI', zh: '中文' });
  });
});
