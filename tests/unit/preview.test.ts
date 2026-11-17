import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  makePreviews,
  pageUrl,
  previewImageUrl,
  previewKey,
  siteOrigin,
  type PreviewDeps,
} from '../../apps/web/src/preview.ts';

/**
 * Link previews (shyden-labs/ShyTalk#198): each page's picture is named after
 * the page Astro built, and its addresses start at the origin of the
 * environment the site is built for.
 */

describe('previewKey', () => {
  it('names the home page index', () => {
    expect(previewKey('/')).toBe('index');
  });

  it('names a language home page after its folder', () => {
    expect(previewKey('/id/')).toBe('id/index');
  });

  it('names a folder page after its folder', () => {
    expect(previewKey('/sign-up/')).toBe('sign-up/index');
  });

  it('names a page file without its .html', () => {
    expect(previewKey('/closed-testing.html')).toBe('closed-testing');
  });

  it('names a nested language page with its folders', () => {
    expect(previewKey('/id/closed-testing/confirm.html')).toBe('id/closed-testing/confirm');
  });

  it('names a built file path the same as its page path', () => {
    expect(previewKey('zh/404.html')).toBe(previewKey('/zh/404.html'));
    expect(previewKey('sign-up/index.html')).toBe(previewKey('/sign-up/'));
  });
});

describe('pageUrl', () => {
  it('drops .html, as the site serves the page without it', () => {
    expect(pageUrl('https://site.test', '/id/privacy.html')).toBe('https://site.test/id/privacy');
  });

  it('keeps a folder page as it is', () => {
    expect(pageUrl('https://site.test', '/')).toBe('https://site.test/');
    expect(pageUrl('https://site.test', '/th/sign-in/')).toBe('https://site.test/th/sign-in/');
  });
});

describe('previewImageUrl', () => {
  it('points at the page’s picture under /previews', () => {
    expect(previewImageUrl('https://site.test', '/vi/closed-testing/confirmed.html')).toBe(
      'https://site.test/previews/vi/closed-testing/confirmed.png',
    );
    expect(previewImageUrl('https://site.test', '/')).toBe('https://site.test/previews/index.png');
  });

  it('is 1200 by 630, the size Facebook and WhatsApp show', () => {
    expect([PREVIEW_WIDTH, PREVIEW_HEIGHT]).toEqual([1200, 630]);
  });
});

describe('siteOrigin', () => {
  const wrangler = {
    env: {
      dev: { vars: { SITE_ORIGIN: 'https://dev.site.test' } },
      prod: { vars: { SITE_ORIGIN: 'https://site.test' } },
      test: { vars: {} },
    },
  };

  it('is the SITE_ORIGIN of the environment named', () => {
    expect(siteOrigin('dev', wrangler)).toBe('https://dev.site.test');
    expect(siteOrigin('prod', wrangler)).toBe('https://site.test');
  });

  it('refuses a build naming no environment', () => {
    expect(() => siteOrigin(undefined, wrangler)).toThrow(
      'SITE_ENVIRONMENT is unset: name the environment the site is built for (dev, test or prod)',
    );
    expect(() => siteOrigin('', wrangler)).toThrow('SITE_ENVIRONMENT is unset');
  });

  it('refuses an environment the Worker does not have', () => {
    expect(() => siteOrigin('staging', wrangler)).toThrow(
      'SITE_ENVIRONMENT staging is not one of dev, prod, test in workers/web/wrangler.json',
    );
  });

  it('refuses an environment with no SITE_ORIGIN', () => {
    expect(() => siteOrigin('test', wrangler)).toThrow('workers/web/wrangler.json gives test no SITE_ORIGIN');
  });
});

describe('makePreviews', () => {
  function deps(pages: string[]): { pages: PreviewDeps['pages']; shoot: Mock<PreviewDeps['shoot']> } {
    return { pages: () => pages, shoot: vi.fn<PreviewDeps['shoot']>(() => Promise.resolve()) };
  }

  it('shoots each built page to its own picture, in order', async () => {
    const d = deps(['index.html', 'id/closed-testing.html', 'sign-up/index.html']);
    await expect(makePreviews('http://127.0.0.1:4321', 'out', d)).resolves.toBe(3);
    expect(d.shoot.mock.calls).toEqual([
      ['http://127.0.0.1:4321/', 'out/index.png'],
      ['http://127.0.0.1:4321/id/closed-testing', 'out/id/closed-testing.png'],
      ['http://127.0.0.1:4321/sign-up/', 'out/sign-up/index.png'],
    ]);
  });

  it('refuses a build with no pages', async () => {
    await expect(makePreviews('http://127.0.0.1:4321', 'out', deps([]))).rejects.toThrow('no built pages: run npm run build:web first');
  });

  it('stops at the first page that cannot be shot, naming it', async () => {
    const d = deps(['index.html', 'id/index.html', 'th/index.html']);
    d.shoot.mockImplementation((url) => (url.endsWith('/id/') ? Promise.reject(new Error('timed out')) : Promise.resolve()));
    await expect(makePreviews('http://127.0.0.1:4321', 'out', d)).rejects.toThrow('id/index.html: timed out');
    expect(d.shoot.mock.calls).toHaveLength(2);
  });

  it('keeps the page’s own error as the cause', async () => {
    const failure = new Error('timed out');
    const d = deps(['index.html']);
    d.shoot.mockRejectedValue(failure);
    await expect(makePreviews('http://127.0.0.1:4321', 'out', d)).rejects.toHaveProperty('cause', failure);
  });
});
