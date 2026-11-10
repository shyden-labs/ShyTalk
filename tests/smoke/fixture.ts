/**
 * The smoke suite's `test` (shyden-labs/ShyTalk#112, shyden-labs/ShyTalk#150).
 *
 * The browser is Playwright's own everywhere CI runs: CI never sets
 * `SMOKE_CDP_ENDPOINT`. The phone run sets it to adb's forward of Chrome's
 * DevTools socket on the OnePlus, and the suite then runs unchanged in real
 * Chrome on the phone (Shyden's choice 2026-11-06 over Playwright's Android
 * mode, which stalls unless a Chrome flag is set on the phone). Each test still
 * gets its own context; the phone config sets `viewport: null`, as Chrome on
 * Android refuses a set window size.
 *
 * `mailbox` gives a test an address of its own and, once the site has mailed
 * it, the mail. Under CI it is the local stand-in for Oracle
 * (tests/smoke/mail-stand-in.ts); the phone config sets `mailSource: 'imap'`,
 * and the mail is read from the real test mailbox (tests/phones/test-mailbox.ts).
 */
import { test as base } from '@playwright/test';
import { plusAddress, waitForMail } from '../phones/test-mailbox.ts';
import { MAIL_STAND_IN_PORT } from './targets.ts';

export { expect } from '@playwright/test';

export type MailSource = 'stand-in' | 'imap';

export interface Mailbox {
  address: string;
  /** The mail the site sent to `address`: its subject and confirm link. */
  mail(): Promise<{ subject: string; confirmLink: string }>;
}

const STAND_IN = `http://127.0.0.1:${String(MAIL_STAND_IN_PORT)}`;
const CONFIRM_LINK = /https?:\/\/\S+\/closed-testing\/confirm\?t=\S+/;

const endpoint = process.env.SMOKE_CDP_ENDPOINT;

export const test = base.extend<{ mailbox: Mailbox }, { mailSource: MailSource }>({
  mailSource: ['stand-in', { option: true, scope: 'worker' }],
  mailbox: async ({ mailSource, request }, use, testInfo) => {
    const tag = `${testInfo.project.name}-${String(Date.now())}`;
    if (mailSource === 'imap') {
      await use({
        address: plusAddress(tag),
        mail: async () => {
          const { subject, confirmLink } = await waitForMail(tag, { password: process.env.TEST_MAILBOX_PASSWORD ?? '' });
          return { subject, confirmLink };
        },
      });
      return;
    }
    const address = `journey-${tag}@example.test`;
    await use({
      address,
      mail: async () => {
        const mailed = await request.get(`${STAND_IN}/mail?to=${encodeURIComponent(address)}`);
        if (mailed.status() !== 200) throw new Error(`the stand-in answered ${String(mailed.status())} for ${address}`);
        const { subject, bodyText } = (await mailed.json()) as { subject: string; bodyText: string };
        const confirmLink = CONFIRM_LINK.exec(bodyText)?.[0];
        if (confirmLink === undefined) throw new Error(`the mail holds no confirm link: ${bodyText}`);
        return { subject, confirmLink };
      },
    });
  },
  ...(endpoint === undefined
    ? {}
    : {
        browser: [
          async ({ playwright }, use) => {
            const browser = await playwright.chromium.connectOverCDP(endpoint);
            await use(browser);
            await browser.close();
          },
          { scope: 'worker' },
        ],
      }),
});
