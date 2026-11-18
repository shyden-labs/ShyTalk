import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const launch = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('@playwright/test', () => ({ chromium: { launch } }));

/** What the script exports, as the tests use it. */
interface Script {
  ICON_ORIGIN: string;
  ICON_SIZES: readonly { file: string; size: number; square: boolean }[];
  iconPage: (svg: string, square: boolean) => string;
  fontFile: (modules: string, pathname: string) => string | undefined;
  main: () => Promise<number>;
}

/** Typed against the DOM in its own project (apps/web/scripts/tsconfig.json), so loaded by a path the root check does not follow. */
const SCRIPT: string = '../../apps/web/scripts/export-icons.ts';
const { ICON_ORIGIN, ICON_SIZES, fontFile, iconPage, main } = (await import(/* @vite-ignore */ SCRIPT)) as Script;

/**
 * The script that renders ShyTalk's icons from brand/icon.svg (shyden-labs/ShyTalk#273): Chromium draws the SVG with
 * the brand fonts, served from node_modules through Playwright's own request routing, and screenshots each size.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const MODULES = `${ROOT}/node_modules`;
const SVG = '<svg viewBox="0 0 120 120"><rect width="120" height="120" rx="27" fill="#211a52"/></svg>';

describe('ICON_SIZES', () => {
  it('makes the favicon and the page icon (an <img> SVG cannot use the page fonts) with round corners, and the Apple and store icons square for the platform to round', () => {
    expect(ICON_SIZES).toEqual([
      { file: 'apps/web/public/icons/favicon-32.png', size: 32, square: false },
      { file: 'apps/web/public/icons/icon-192.png', size: 192, square: false },
      { file: 'apps/web/public/icons/apple-touch-icon.png', size: 180, square: true },
      { file: 'brand/icon-1024.png', size: 1024, square: true },
    ]);
  });
});

describe('iconPage', () => {
  it('loads each bubble font from the icon origin and fills the page with the icon on a clear background', () => {
    const html = iconPage(SVG, false);
    for (const font of ['noto-sans', 'noto-sans-sc', 'noto-sans-thai']) {
      expect(html).toContain(`<link rel="stylesheet" href="${ICON_ORIGIN}/@fontsource/${font}/800.css">`);
    }
    expect(html).toContain('background:transparent');
    expect(html).toContain('rx="27"');
    expect(html.indexOf(SVG)).toBeGreaterThan(html.indexOf('<body>'));
  });

  it('squares the tile for a platform that rounds it', () => {
    expect(iconPage(SVG, true)).toContain('<rect width="120" height="120" rx="0" fill="#211a52"/>');
  });
});

describe('fontFile', () => {
  it.each([
    ['/@fontsource/noto-sans/800.css', `${MODULES}/@fontsource/noto-sans/800.css`],
    [
      '/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-800-normal.woff2',
      `${MODULES}/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-800-normal.woff2`,
    ],
  ])('serves %s from node_modules', (path, file) => {
    expect(fontFile(MODULES, path)).toBe(file);
  });

  it.each([
    ['another package', '/vitest/package.json'],
    ['a climb out of the fonts', '/@fontsource/../vitest/package.json'],
    ['an encoded climb', '/@fontsource/%2E%2E/vitest/package.json'],
  ])('serves nothing for %s', (_, path) => {
    expect(fontFile(MODULES, path)).toBeUndefined();
  });
});

/** Fakes for Chromium: each page records the requests its route answered. */
function fakes(options: { fontsLoaded?: boolean; failShot?: string } = {}) {
  const served: { url: string; answer: unknown }[] = [];
  const pages: ReturnType<typeof makePage>[] = [];
  function makePage() {
    let handler: ((route: unknown) => Promise<void>) | undefined;
    const request = async (url: string) => {
      await handler?.({ request: () => ({ url: () => url }), fulfill: (answer: unknown) => served.push({ url, answer }) });
    };
    return {
      route: vi.fn((_: string, given: (route: unknown) => Promise<void>) => {
        handler = given;
        return Promise.resolve();
      }),
      setContent: vi.fn(async () => {
        await request(`${ICON_ORIGIN}/@fontsource/noto-sans-thai/800.css`);
        await request(`${ICON_ORIGIN}/elsewhere.js`);
      }),
      evaluate: vi.fn(() => Promise.resolve(options.fontsLoaded ?? true)),
      screenshot: vi.fn((shot: { path: string }) =>
        options.failShot !== undefined && shot.path.endsWith(options.failShot)
          ? Promise.reject(new Error('disk full'))
          : Promise.resolve(Buffer.from('')),
      ),
    };
  }
  const browser = {
    newPage: vi.fn(() => {
      const page = makePage();
      pages.push(page);
      return Promise.resolve(page);
    }),
    close: vi.fn(() => Promise.resolve()),
  };
  launch.mockResolvedValue(browser);
  vi.mocked(readFile).mockResolvedValue(SVG);
  return { browser, pages, served };
}

describe('main', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders each size from brand/icon.svg with the fonts loaded, says how many, and closes the browser', async () => {
    const { browser, pages, served } = fakes();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main()).toBe(0);
    expect(readFile).toHaveBeenCalledWith(`${ROOT}/brand/icon.svg`, 'utf8');
    expect(browser.newPage.mock.calls).toEqual(
      [32, 192, 180, 1024].map((size) => [{ viewport: { width: size, height: size }, deviceScaleFactor: 1 }]),
    );
    for (const [at, page] of pages.entries()) {
      const square = ICON_SIZES[at]?.square ?? false;
      expect(page.route).toHaveBeenCalledWith(`${ICON_ORIGIN}/**`, expect.any(Function));
      expect(page.setContent).toHaveBeenCalledWith(iconPage(SVG, square), { waitUntil: 'networkidle' });
      expect(page.screenshot).toHaveBeenCalledWith({ path: `${ROOT}/${ICON_SIZES[at]?.file ?? ''}`, omitBackground: !square });
    }
    expect(served).toContainEqual({
      url: `${ICON_ORIGIN}/@fontsource/noto-sans-thai/800.css`,
      answer: { path: `${MODULES}/@fontsource/noto-sans-thai/800.css` },
    });
    expect(served).toContainEqual({ url: `${ICON_ORIGIN}/elsewhere.js`, answer: { status: 404 } });
    expect(log).toHaveBeenCalledWith('export-icons: 4 icons');
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('asks the page whether every bubble font draws its word', async () => {
    const { pages } = fakes();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await main();
    const [check, words] = pages[0]?.evaluate.mock.calls[0] as unknown as [
      (words: [string, string][]) => Promise<boolean>,
      [string, string][],
    ];
    expect(words).toEqual([
      ['800 16px "Noto Sans"', 'hello'],
      ['800 16px "Noto Sans SC"', '你好'],
      ['800 16px "Noto Sans Thai"', 'สวัสดี'],
    ]);
    // In the page: each word must find a face of its own, or the check answers false.
    const load = vi.fn((font: string) => Promise.resolve(font.includes('Thai') ? [] : [{}]));
    vi.stubGlobal('document', { fonts: { load } });
    try {
      expect(await check(words)).toBe(false);
      expect(load.mock.calls).toEqual(words);
      load.mockResolvedValue([{}]);
      expect(await check(words)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stops before any picture when the fonts did not load, naming the file, and still closes the browser', async () => {
    const { browser, pages } = fakes({ fontsLoaded: false });
    await expect(main()).rejects.toThrow('apps/web/public/icons/favicon-32.png: the bubble fonts did not load');
    expect(pages[0]?.screenshot).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('names the file whose picture failed, and still closes the browser', async () => {
    const { browser } = fakes({ failShot: 'apple-touch-icon.png' });
    await expect(main()).rejects.toThrow('apps/web/public/icons/apple-touch-icon.png: disk full');
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
