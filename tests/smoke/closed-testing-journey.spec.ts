/**
 * The closed-testing journey with Oracle replaced by a local stand-in
 * (shyden-labs/ShyTalk#55 AC7): apply through the real form with real typing
 * and clicks, follow the captured link, press the button, see "confirmed".
 * Each browser applies once, inside APPLY_LIMIT's 5 a minute.
 *
 * It needs the stand-in, so it runs only under playwright.config.ts: the phones
 * test a deployed address, whose mail really goes out (the open question on
 * running it there is shyden-labs/ShyTalk#150).
 */
import { test, expect } from './fixture.ts';
import { t } from '../../apps/web/src/i18n/t.ts';
import { MAIL_STAND_IN_PORT } from './targets.ts';

const STAND_IN = `http://127.0.0.1:${String(MAIL_STAND_IN_PORT)}`;

test('applying and following the mailed link confirms the address', async ({ page, request, browserName }) => {
  const address = `journey-${browserName}-${String(Date.now())}@example.test`;

  await page.goto('/closed-testing', { waitUntil: 'load' });
  await page.getByLabel(t('en', 'closedTesting.emailLabel')).pressSequentially(address);
  await page.getByLabel(t('en', 'closedTesting.adultLabel')).check();
  await page.getByRole('button', { name: t('en', 'closedTesting.submit') }).click();
  const answer = page.getByRole('status');
  await expect(answer).toBeVisible();
  await expect(answer).toHaveText(t('en', 'closedTesting.sent'));

  const mailed = await request.get(`${STAND_IN}/mail?to=${encodeURIComponent(address)}`);
  expect(mailed.status()).toBe(200);
  const { subject, bodyText } = (await mailed.json()) as { subject: string; bodyText: string };
  expect(subject).toBe(t('en', 'closedTesting.mailSubject'));
  const link = /https?:\/\/\S+\/closed-testing\/confirm\?t=\S+/.exec(bodyText)?.[0];
  if (link === undefined) throw new Error(`the mail holds no confirm link: ${bodyText}`);

  // The Worker builds the link from its own SITE_ORIGIN; the smoke serves the same path locally.
  const { pathname, search } = new URL(link);
  await page.goto(`${pathname}${search}`, { waitUntil: 'load' });
  await page.getByRole('button', { name: t('en', 'closedTesting.confirmButton') }).click();
  await page.waitForURL('**/closed-testing/confirmed');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText(t('en', 'closedTesting.confirmedHeading'));
});
