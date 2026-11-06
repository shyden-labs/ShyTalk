import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The smoke suite's `test` (tests/smoke/fixture.ts, shyden-labs/ShyTalk#112):
 * Playwright's own everywhere, except that with `SMOKE_CDP_ENDPOINT` set the
 * browser is Chrome on the OnePlus, reached over adb's DevTools forward. CI
 * never sets it, so CI runs Playwright's `test` untouched. Playwright is stood
 * in; nothing reaches a browser.
 */
const base = vi.hoisted(() => ({ extend: vi.fn((fixtures: unknown) => ({ fixtures })) }));
vi.mock('@playwright/test', () => ({ test: base, expect: vi.fn() }));

/** Typed against the DOM in its own project (tests/smoke/tsconfig.json), so loaded by a path the root check does not follow. */
const FIXTURE: string = '../smoke/fixture.ts';
const load = async () => ((await import(/* @vite-ignore */ FIXTURE)) as { test: unknown }).test;

type BrowserFixture = [(deps: { playwright: unknown }, use: (browser: unknown) => Promise<void>) => Promise<void>, { scope: string }];

beforeEach(() => {
  vi.resetModules();
  base.extend.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the smoke suite’s test', () => {
  it('is Playwright’s own when no DevTools endpoint is set', async () => {
    vi.stubEnv('SMOKE_CDP_ENDPOINT', undefined);
    expect(await load()).toBe(base);
    expect(base.extend).not.toHaveBeenCalled();
  });

  it('with an endpoint, takes its one browser, per worker, from Chrome over CDP, and disconnects after', async () => {
    vi.stubEnv('SMOKE_CDP_ENDPOINT', 'http://127.0.0.1:9333');
    const test = (await load()) as { fixtures: { browser: BrowserFixture } };
    expect(base.extend).toHaveBeenCalledOnce();
    expect(Object.keys(test.fixtures)).toEqual(['browser']);
    const [fixture, options] = test.fixtures.browser;
    expect(options).toEqual({ scope: 'worker' });

    const order: string[] = [];
    const browser = { close: vi.fn(() => (order.push('close'), Promise.resolve())) };
    const connectOverCDP = vi.fn(() => Promise.resolve(browser));
    await fixture({ playwright: { chromium: { connectOverCDP } } }, (given) => {
      expect(given).toBe(browser);
      order.push('use');
      return Promise.resolve();
    });
    expect(connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9333');
    expect(order).toEqual(['use', 'close']);
  });
});
