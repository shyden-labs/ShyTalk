/**
 * The smoke suite on Chrome on the OnePlus (shyden-labs/ShyTalk#112), run by
 * `npm run test:phones -- <address>` (tests/phones/phone-smoke.ts), never by
 * hand or CI. The phone run sets both variables: the deployed address to test,
 * and adb's forward of Chrome's DevTools socket, which tests/smoke/fixture.ts
 * connects to. The journey's mail is read from the real test mailbox
 * (`mailSource: 'imap'`), with the password the run reads from the Keychain.
 * Without the forward the suite would run in a desktop browser
 * and call it the phone, so the config refuses to load.
 */
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { MailSource } from './fixture.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const address = process.env.PHONE_BASE_URL ?? '';
if (!address.startsWith('https://')) throw new Error('PHONE_BASE_URL must be the https address the phones test');
if ((process.env.SMOKE_CDP_ENDPOINT ?? '') === '')
  throw new Error('SMOKE_CDP_ENDPOINT is unset: without the OnePlus the suite would run on this Mac');

export default defineConfig<object, { mailSource: MailSource }>({
  testDir: '.',
  testMatch: 'site.spec.ts',
  forbidOnly: true,
  retries: 0,
  // One phone, one Chrome: tests take turns.
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: `${ROOT}test-results/phone-oneplus.json` }],
    ['./assertion-counts.ts', { outputFile: `${ROOT}test-results/phone-oneplus-assertions.json` }],
  ],
  // Chrome on Android refuses a set window size (measured 2026-11-06): the phone's own screen it is.
  use: { baseURL: address, viewport: null, mailSource: 'imap' },
  projects: [{ name: 'oneplus' }],
});
