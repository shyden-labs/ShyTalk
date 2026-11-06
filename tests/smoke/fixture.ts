/**
 * The smoke suite's `test` (shyden-labs/ShyTalk#112). Everywhere it is
 * Playwright's own: CI never sets `SMOKE_CDP_ENDPOINT`. The phone run sets it
 * to adb's forward of Chrome's DevTools socket on the OnePlus, and the suite
 * then runs unchanged in real Chrome on the phone (Shyden's choice 2026-11-06
 * over Playwright's Android mode, which stalls unless a Chrome flag is set on
 * the phone). Each test still gets its own context; the phone config sets
 * `viewport: null`, as Chrome on Android refuses a set window size.
 */
import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

const endpoint = process.env.SMOKE_CDP_ENDPOINT;

export const test =
  endpoint === undefined
    ? base
    : base.extend<object, object>({
        browser: [
          async ({ playwright }, use) => {
            const browser = await playwright.chromium.connectOverCDP(endpoint);
            await use(browser);
            await browser.close();
          },
          { scope: 'worker' },
        ],
      });
