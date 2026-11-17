import { describe, it, expect } from 'vitest';
import {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  environmentAt,
  pagePath,
  pageUrl,
  previewImageUrl,
  previewKey,
  siteOrigin,
  sitePages,
} from '../../apps/web/src/preview.ts';

/**
 * Link previews (shyden-labs/ShyTalk#198): where each page's preview picture
 * lives, the address a page is shared at, which pages the site builds in each
 * language, and the origin of the environment the site is built for.
 */

const WRANGLER = {
  env: {
    prod: { vars: { SITE_ORIGIN: 'https://site.example' } },
    test: { vars: { SITE_ORIGIN: 'https://test.site.example' } },
    dev: { vars: { SITE_ORIGIN: 'https://dev.site.example' } },
  },
};

describe('the preview picture size', () => {
  it('is the 1200 by 630 that Facebook, WhatsApp and X show a large preview at', () => {
    expect([PREVIEW_WIDTH, PREVIEW_HEIGHT]).toEqual([1200, 630]);
  });
});

describe('pagePath', () => {
  it.each([
    ['index.html', '/'],
    ['id/index.html', '/id/'],
    ['sign-in/index.html', '/sign-in/'],
    ['zh/recover/cancel/index.html', '/zh/recover/cancel/'],
    ['closed-testing.html', '/closed-testing.html'],
    ['id/privacy.html', '/id/privacy.html'],
    ['404.html', '/404.html'],
  ])('names the built file %s as the path %s', (file, path) => {
    expect(pagePath(file)).toBe(path);
  });
});

describe('pageUrl', () => {
  it.each([
    ['/', 'https://dev.site.example/'],
    ['/id/', 'https://dev.site.example/id/'],
    ['/closed-testing.html', 'https://dev.site.example/closed-testing'],
    ['/th/closed-testing/confirm.html', 'https://dev.site.example/th/closed-testing/confirm'],
  ])('serves %s at %s, without .html as Workers assets do', (path, url) => {
    expect(pageUrl('https://dev.site.example', path)).toBe(url);
  });

  it('gives a path alone on an empty origin', () => {
    expect(pageUrl('', '/vi/terms.html')).toBe('/vi/terms');
  });
});

describe('previewKey and previewImageUrl', () => {
  it.each([
    ['/', 'index'],
    ['/id/', 'id/index'],
    ['/sign-up/', 'sign-up/index'],
    ['/closed-testing.html', 'closed-testing'],
    ['/zh/closed-testing/link-expired.html', 'zh/closed-testing/link-expired'],
    ['index.html', 'index'],
    ['id/account/index.html', 'id/account/index'],
    ['id/privacy.html', 'id/privacy'],
  ])('names the picture of %s %s', (path, key) => {
    expect(previewKey(path)).toBe(key);
  });

  it('puts the picture under /previews/ on the origin', () => {
    expect(previewImageUrl('https://site.example', '/th/sign-in/')).toBe('https://site.example/previews/th/sign-in/index.png');
  });
});

describe('sitePages', () => {
  const FILES = [
    'index.astro',
    'privacy.astro',
    'sign-in/index.astro',
    'closed-testing/confirm.astro',
    '[locale]/index.astro',
    '[locale]/sign-in/index.astro',
    '[locale]/closed-testing/confirm.astro',
    'id/privacy.astro',
    '[locale]',
    'sign-in',
    'README.md',
  ];

  it('builds the English pages from the files outside [locale] and the language folders', () => {
    expect(sitePages(FILES, 'en')).toEqual(['index.html', 'privacy.html', 'sign-in/index.html', 'closed-testing/confirm.html']);
  });

  it('builds a [locale] page in each other language, and a language folder page in its own language only', () => {
    expect(sitePages(FILES, 'id')).toEqual(['id/index.html', 'id/sign-in/index.html', 'id/closed-testing/confirm.html', 'id/privacy.html']);
    expect(sitePages(FILES, 'th')).toEqual(['th/index.html', 'th/sign-in/index.html', 'th/closed-testing/confirm.html']);
  });

  it('reads Windows separators as folders', () => {
    expect(sitePages(['[locale]\\sign-up\\index.astro', 'id\\terms.astro'], 'id')).toEqual(['id/sign-up/index.html', 'id/terms.html']);
  });
});

describe('siteOrigin', () => {
  it.each([
    ['dev', 'https://dev.site.example'],
    ['test', 'https://test.site.example'],
    ['prod', 'https://site.example'],
  ])('reads the %s origin from the Worker settings', (environment, origin) => {
    expect(siteOrigin(environment, WRANGLER)).toBe(origin);
  });

  it.each([undefined, ''])('stops when no environment is named (%j)', (environment) => {
    expect(() => siteOrigin(environment, WRANGLER)).toThrow(
      'SITE_ENVIRONMENT is unset: name the environment the site is built for (dev, prod or test)',
    );
  });

  it('stops on an environment the Worker lacks, naming the ones it has in order', () => {
    expect(() => siteOrigin('staging', WRANGLER)).toThrow(
      'SITE_ENVIRONMENT staging is not one of dev, prod, test in workers/web/wrangler.json',
    );
  });

  it.each([
    ['no vars', { env: { dev: {} } }],
    ['no SITE_ORIGIN', { env: { dev: { vars: {} } } }],
    ['an empty SITE_ORIGIN', { env: { dev: { vars: { SITE_ORIGIN: '' } } } }],
  ])('stops when the environment has %s', (_, wrangler) => {
    expect(() => siteOrigin('dev', wrangler)).toThrow('workers/web/wrangler.json gives dev no SITE_ORIGIN');
  });
});

describe('environmentAt', () => {
  it.each([
    ['https://dev.site.example/', 'dev'],
    ['https://test.site.example/id/sign-in/', 'test'],
    ['https://site.example', 'prod'],
  ])('names the environment %s was built for: %s', (address, environment) => {
    expect(environmentAt(address, WRANGLER)).toBe(environment);
  });

  it('stops on an address no environment serves, naming its origin', () => {
    expect(() => environmentAt('https://127.0.0.1:8787/sign-in/', WRANGLER)).toThrow(
      'https://127.0.0.1:8787 is the SITE_ORIGIN of no environment in workers/web/wrangler.json',
    );
  });

  it('skips an environment with no settings', () => {
    expect(environmentAt('https://dev.site.example/', { env: { bare: {}, ...WRANGLER.env } })).toBe('dev');
  });
});
