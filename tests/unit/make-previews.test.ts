import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';

const launch = vi.hoisted(() => vi.fn());
vi.mock('node:fs', () => ({ readdirSync: vi.fn() }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), stat: vi.fn() }));
vi.mock('@playwright/test', () => ({ chromium: { launch } }));

/** What the script exports, as the tests use it. */
interface Script {
  SHOT_ORIGIN: string;
  builtFileFor: (dist: string, path: string, isFile: (file: string) => Promise<boolean>) => Promise<string | undefined>;
  makePreviews: (pages: string[], out: string, shoot: (url: string, file: string) => Promise<void>) => Promise<number>;
  main: () => Promise<number>;
}

/** Typed against the DOM in its own project (apps/web/scripts/tsconfig.json), so loaded by a path the root check does not follow. */
const SCRIPT: string = '../../apps/web/scripts/make-previews.ts';
const { SHOT_ORIGIN, builtFileFor, main, makePreviews } = (await import(/* @vite-ignore */ SCRIPT)) as Script;

/**
 * The script that makes every page's link-preview picture (shyden-labs/ShyTalk#198 AC2): it serves the built pages to
 * Chromium through Playwright's own request routing, as Workers' assets serve them, and screenshots the top of each.
 */

const DIST = '/site/dist';
const present =
  (...files: string[]) =>
  (path: string) =>
    Promise.resolve(files.includes(path));

describe('builtFileFor', () => {
  it.each([
    ['/', ['/site/dist/index.html'], '/site/dist/index.html'],
    ['/id/', ['/site/dist/id/index.html'], '/site/dist/id/index.html'],
    ['/closed-testing', ['/site/dist/closed-testing.html'], '/site/dist/closed-testing.html'],
    ['/styles/site.css', ['/site/dist/styles/site.css'], '/site/dist/styles/site.css'],
    ['/zh/sign-in/', ['/site/dist/zh/sign-in/index.html'], '/site/dist/zh/sign-in/index.html'],
    ['/fonts/a%20b.woff2', ['/site/dist/fonts/a b.woff2'], '/site/dist/fonts/a b.woff2'],
  ])('finds %s as Workers assets do', async (path, files, file) => {
    expect(await builtFileFor(DIST, path, present(...files))).toBe(file);
  });

  it('prefers the file itself over the same name with .html', async () => {
    expect(await builtFileFor(DIST, '/robots.txt', present('/site/dist/robots.txt', '/site/dist/robots.txt.html'))).toBe(
      '/site/dist/robots.txt',
    );
  });

  it.each([
    ['nothing at the path', '/missing'],
    ['a folder with no index page', '/empty/'],
  ])('answers nothing for %s', async (_, path) => {
    expect(await builtFileFor(DIST, path, present())).toBeUndefined();
  });

  it('never reaches above the build folder', async () => {
    const isFile = vi.fn(present('/site/secret.html'));
    expect(await builtFileFor(DIST, '/../secret', isFile)).toBeUndefined();
    expect(await builtFileFor(DIST, '/%2E%2E/secret', isFile)).toBeUndefined();
    expect(isFile.mock.calls.map(([file]) => file)).toEqual([
      '/site/dist/secret',
      '/site/dist/secret.html',
      '/site/dist/secret',
      '/site/dist/secret.html',
    ]);
  });
});

describe('makePreviews', () => {
  it('shoots every page at its served address into its picture file, in order, and answers how many', async () => {
    const shoot = vi.fn(() => Promise.resolve());
    expect(await makePreviews(['index.html', 'id/privacy.html', 'th/sign-in/index.html'], '/out', shoot)).toBe(3);
    expect(shoot.mock.calls).toEqual([
      [`${SHOT_ORIGIN}/`, '/out/index.png'],
      [`${SHOT_ORIGIN}/id/privacy`, '/out/id/privacy.png'],
      [`${SHOT_ORIGIN}/th/sign-in/`, '/out/th/sign-in/index.png'],
    ]);
  });

  it('stops when there are no built pages, saying to build first', async () => {
    await expect(makePreviews([], '/out', vi.fn())).rejects.toThrow('no built pages: run npm run build:web first');
  });

  it('stops at the first page that fails, naming it and keeping the cause', async () => {
    const cause = new Error('net::ERR_ABORTED');
    const shoot = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(cause);
    const failure = await makePreviews(['index.html', 'sign-in/index.html', 'sign-up/index.html'], '/out', shoot).catch(
      (error: unknown) => error as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('sign-in/index.html: net::ERR_ABORTED');
    expect((failure as Error).cause).toBe(cause);
    expect(shoot).toHaveBeenCalledTimes(2);
  });
});

/** What the route handler is handed: the request's address, and the answer it gives. */
interface Route {
  request(): { url(): string };
  fulfill(answer: { path?: string; status?: number }): Promise<void>;
}

const BUILT = fileURLToPath(new URL('../../apps/web/dist', import.meta.url));
const OUT = fileURLToPath(new URL('../../apps/web/public/previews', import.meta.url));

/**
 * A stand-in Chromium whose page loads each address and then the stylesheet through the script's route handler, and
 * built files on disk: `files` are files, `folders` are folders, anything else is missing.
 */
function fakes(options: { status?: number | null; files?: string[] } = {}) {
  const files = options.files ?? [`${BUILT}/index.html`, `${BUILT}/id/sign-in/index.html`, `${BUILT}/styles/site.css`];
  const folders = [`${BUILT}/styles`];
  vi.mocked(readdirSync).mockReturnValue(['styles/site.css', 'id\\sign-in\\index.html', 'index.html', 'styles'] as never);
  vi.mocked(stat).mockImplementation((path) => {
    if (files.includes(String(path))) return Promise.resolve({ isFile: () => true } as never);
    if (folders.includes(String(path))) return Promise.resolve({ isFile: () => false } as never);
    return Promise.reject(new Error(`ENOENT: ${String(path)}`));
  });
  vi.mocked(mkdir).mockResolvedValue(undefined);
  const served: { url: string; answer: { path?: string; status?: number } }[] = [];
  let handler: ((route: Route) => Promise<void>) | undefined;
  const page = {
    route: vi.fn((_: string, h: (route: Route) => Promise<void>) => {
      handler = h;
      return Promise.resolve();
    }),
    goto: vi.fn(async (url: string) => {
      for (const asked of [url, `${SHOT_ORIGIN}/styles/site.css`, `${SHOT_ORIGIN}/styles`]) {
        await handler?.({
          request: () => ({ url: () => asked }),
          fulfill: (answer) => {
            served.push({ url: asked, answer });
            return Promise.resolve();
          },
        });
      }
      return options.status === null ? null : { status: () => options.status ?? 200 };
    }),
    screenshot: vi.fn(() => Promise.resolve(Buffer.from(''))),
  };
  const browser = { newPage: vi.fn(() => Promise.resolve(page)), close: vi.fn(() => Promise.resolve()) };
  launch.mockResolvedValue(browser);
  return { browser, page, served };
}

describe('main', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shoots each built page, in order, at 1200 by 630 from the files the route serves, says how many, and closes the browser', async () => {
    const { browser, page, served } = fakes();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main()).toBe(0);
    expect(readdirSync).toHaveBeenCalledWith(BUILT, { recursive: true, encoding: 'utf8' });
    expect(browser.newPage).toHaveBeenCalledWith({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    expect(page.route).toHaveBeenCalledWith(`${SHOT_ORIGIN}/**`, expect.any(Function));
    expect(page.goto.mock.calls).toEqual([
      [`${SHOT_ORIGIN}/id/sign-in/`, { waitUntil: 'load' }],
      [`${SHOT_ORIGIN}/`, { waitUntil: 'load' }],
    ]);
    expect(served).toContainEqual({ url: `${SHOT_ORIGIN}/id/sign-in/`, answer: { path: `${BUILT}/id/sign-in/index.html` } });
    expect(served).toContainEqual({ url: `${SHOT_ORIGIN}/styles/site.css`, answer: { path: `${BUILT}/styles/site.css` } });
    // A folder is not a file: /styles is neither styles nor styles.html.
    expect(served).toContainEqual({ url: `${SHOT_ORIGIN}/styles`, answer: { status: 404 } });
    expect(mkdir).toHaveBeenCalledWith(`${OUT}/id/sign-in`, { recursive: true });
    expect(page.screenshot.mock.calls).toEqual([[{ path: `${OUT}/id/sign-in/index.png` }], [{ path: `${OUT}/index.png` }]]);
    expect(log).toHaveBeenCalledWith(`make-previews: 2 pictures in ${OUT}`);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('answers 404 for a request with no built file', async () => {
    const { served } = fakes({ files: [`${BUILT}/index.html`, `${BUILT}/id/sign-in/index.html`] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await main();
    expect(served).toContainEqual({ url: `${SHOT_ORIGIN}/styles/site.css`, answer: { status: 404 } });
  });

  it.each([
    [404, 'id/sign-in/index.html: answered 404, not 200'],
    [null, 'id/sign-in/index.html: no answer'],
  ])('stops when a page answers %j, naming it, and still closes the browser', async (status, message) => {
    const { browser, page } = fakes({ status });
    await expect(main()).rejects.toThrow(message);
    expect(page.screenshot).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
