/**
 * Each language's home answers 200 and an unknown page 404, both in that
 * language (`<html lang>`), with no Content Security Policy refusal in the
 * console (shyden-labs/ShyTalk#51 AC4). Each home shows its own heading,
 * no roadmap button while the roadmap is hidden, and passes axe
 * (shyden-labs/ShyTalk#53 AC4). One test per page and language, each page
 * opened once with all its checks (shyden-labs/ShyTalk#151).
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixture.ts';
import AxeBuilder from '@axe-core/playwright';
import { t } from '../../apps/web/src/i18n/t.ts';
import { LEGAL_DOCS, legalLines, legalLocale, legalPath } from '../../apps/web/src/legal/legal.ts';

const LANGUAGES = [
  { lang: 'en', locale: 'en', prefix: '' },
  { lang: 'id', locale: 'id', prefix: '/id' },
  { lang: 'th', locale: 'th', prefix: '/th' },
  { lang: 'vi', locale: 'vi', prefix: '/vi' },
  { lang: 'zh-Hans', locale: 'zh', prefix: '/zh' },
] as const;

/** Every console line the browser writes about the CSP refusing something. */
function cspRefusals(page: Page): string[] {
  const refusals: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) refusals.push(message.text());
  });
  return refusals;
}

for (const { lang, locale, prefix } of LANGUAGES) {
  // One journey, all its assertions (Shyden 2026-11-09, shyden-labs/ShyTalk#151): the home page opens once.
  test(`${lang}: the home page answers 200 in ${lang}, shows its heading and no roadmap button, passes axe, with no CSP refusal`, async ({
    page,
  }) => {
    const refusals = cspRefusals(page);
    const response = await page.goto(`${prefix}/`, { waitUntil: 'load' });
    expect.soft(response?.status()).toBe(200);
    await expect.soft(page.locator('html')).toHaveAttribute('lang', lang);
    await expect.soft(page.getByRole('navigation')).toBeVisible();
    const heading = page.getByRole('heading', { level: 1 });
    await expect.soft(heading).toBeVisible();
    await expect.soft(heading).toHaveText(t(locale, 'home.heading'));
    await expect.soft(page.getByRole('link', { name: t(locale, 'home.apply') })).toBeVisible();
    await expect.soft(page.getByRole('link', { name: t(locale, 'home.roadmap') })).toHaveCount(0);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect.soft(violations.map(({ id, nodes }) => `${id}: ${String(nodes.length)}`)).toEqual([]);
    expect.soft(refusals).toEqual([]);
  });

  test(`${lang}: an unknown page answers 404 in ${lang}, with no CSP refusal`, async ({ page }) => {
    const refusals = cspRefusals(page);
    const response = await page.goto(`${prefix}/no-such-page`, { waitUntil: 'load' });
    expect(response?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.getByRole('navigation')).toBeVisible();
    expect(refusals).toEqual([]);
  });

  // The legal pages (shyden-labs/ShyTalk#56 AC4): each language's footer opens the right text.
  test(`${lang}: each footer legal link opens the right page, with its note if any, passing axe, with no CSP refusal`, async ({ page }) => {
    const refusals = cspRefusals(page);
    const words = legalLines(legalLocale(locale));
    await page.goto(`${prefix}/`, { waitUntil: 'load' });
    for (const doc of LEGAL_DOCS) {
      await page
        .getByRole('contentinfo')
        .getByRole('link', { name: t(locale, `footer.${doc}`), exact: true })
        .click();
      await page.waitForURL((url) => `${url.pathname}${url.search}` === legalPath(locale, doc));
      const heading = page.getByRole('heading', { level: 1 });
      await expect.soft(heading).toBeVisible();
      await expect.soft(heading).toHaveText(words[doc].title);
      await expect.soft(page.locator('html')).toHaveAttribute('lang', legalLocale(locale));
      await expect.soft(page.locator('[data-governs]')).toHaveText(words.common.governs);
      if (locale === 'en' || locale === 'id') {
        await expect.soft(page.locator('[data-english-only]:visible')).toHaveCount(0);
      } else {
        const note = page.locator(`[data-english-only="${locale}"]`);
        await expect.soft(note).toBeVisible();
        await expect.soft(note).toHaveText(t(locale, 'footer.englishOnly'));
      }
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect.soft(violations.map(({ id, nodes }) => `${id}: ${String(nodes.length)}`)).toEqual([]);
      await page.goto(`${prefix}/`, { waitUntil: 'load' });
    }
    expect(refusals).toEqual([]);
  });

  // The closed-testing pages (shyden-labs/ShyTalk#55 AC6). Nothing here applies:
  // the phones test a deployed address, where an application sends real mail.
  test(`${lang}: the closed-testing page shows the form and every statement in ${lang}, passes axe, with no CSP refusal`, async ({
    page,
  }) => {
    const refusals = cspRefusals(page);
    const response = await page.goto(`${prefix}/closed-testing`, { waitUntil: 'load' });
    expect.soft(response?.status()).toBe(200);
    await expect.soft(page.locator('html')).toHaveAttribute('lang', lang);
    for (const line of ['noAccess', 'moreDetails', 'safeList', 'removed', 'retention']) {
      const statement = page.locator(`[data-line="${line}"]`);
      await expect.soft(statement).toBeVisible();
      await expect.soft(statement).toHaveText(t(locale, `closedTesting.${line}`));
    }
    await expect.soft(page.getByLabel(t(locale, 'closedTesting.emailLabel'))).toBeVisible();
    await expect.soft(page.getByLabel(t(locale, 'closedTesting.adultLabel'))).toBeVisible();
    await expect.soft(page.getByRole('button', { name: t(locale, 'closedTesting.submit') })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect.soft(violations.map(({ id, nodes }) => `${id}: ${String(nodes.length)}`)).toEqual([]);
    expect(refusals).toEqual([]);
  });

  test(`${lang}: the confirm page passes axe, and its button with a dead link shows link-expired in ${lang}, with no CSP refusal`, async ({
    page,
  }) => {
    const refusals = cspRefusals(page);
    await page.goto(`${prefix}/closed-testing/confirm?t=no-such-link`, { waitUntil: 'load' });
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect.soft(violations.map(({ id, nodes }) => `${id}: ${String(nodes.length)}`)).toEqual([]);
    await page.getByRole('button', { name: t(locale, 'closedTesting.confirmButton') }).click();
    await page.waitForURL(`**${prefix}/closed-testing/link-expired`);
    const heading = page.getByRole('heading', { level: 1 });
    await expect.soft(heading).toBeVisible();
    await expect.soft(heading).toHaveText(t(locale, 'closedTesting.expiredHeading'));
    expect(refusals).toEqual([]);
  });
}

/**
 * The closed-testing journey, in English, once per browser (shyden-labs/ShyTalk#55
 * AC7, shyden-labs/ShyTalk#150): apply through the real form with real typing
 * and clicks, follow the mailed link, press the button, see "confirmed". CI's
 * mail goes to the stand-in; the phones' goes out for real, to the test mailbox
 * (the `mailbox` fixture). Each browser applies once, inside APPLY_LIMIT's 5 a minute.
 */
test('applying and following the mailed link confirms the address', async ({ page, mailbox }) => {
  await page.goto('/closed-testing', { waitUntil: 'load' });
  await page.getByLabel(t('en', 'closedTesting.emailLabel')).pressSequentially(mailbox.address);
  await page.getByLabel(t('en', 'closedTesting.adultLabel')).check();
  await page.getByRole('button', { name: t('en', 'closedTesting.submit') }).click();
  const answer = page.getByRole('status');
  await expect(answer).toBeVisible();
  await expect(answer).toHaveText(t('en', 'closedTesting.sent'));

  const { subject, confirmLink } = await mailbox.mail();
  expect(subject).toBe(t('en', 'closedTesting.mailSubject'));

  // The Worker builds the link from its own SITE_ORIGIN; the CI smoke serves the same path locally.
  const { pathname, search } = new URL(confirmLink);
  await page.goto(`${pathname}${search}`, { waitUntil: 'load' });
  await page.getByRole('button', { name: t('en', 'closedTesting.confirmButton') }).click();
  await page.waitForURL('**/closed-testing/confirmed');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText(t('en', 'closedTesting.confirmedHeading'));
});
