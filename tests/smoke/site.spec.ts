/**
 * Each language's home answers 200 and an unknown page 404, both in that
 * language (`<html lang>`), with no Content Security Policy refusal in the
 * console (shyden-labs/ShyTalk#51 AC4). Each home shows its own heading,
 * no roadmap button while the roadmap is hidden, and passes axe
 * (shyden-labs/ShyTalk#53 AC4). One test per page and language.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { t } from '../../apps/web/src/i18n/t.ts';

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
  test(`${lang}: the home page answers 200 in ${lang}, with no CSP refusal`, async ({ page }) => {
    const refusals = cspRefusals(page);
    const response = await page.goto(`${prefix}/`, { waitUntil: 'load' });
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.getByRole('navigation')).toBeVisible();
    expect(refusals).toEqual([]);
  });

  test(`${lang}: an unknown page answers 404 in ${lang}, with no CSP refusal`, async ({ page }) => {
    const refusals = cspRefusals(page);
    const response = await page.goto(`${prefix}/no-such-page`, { waitUntil: 'load' });
    expect(response?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.getByRole('navigation')).toBeVisible();
    expect(refusals).toEqual([]);
  });

  test(`${lang}: the home page shows its heading in ${lang}, and no roadmap button`, async ({ page }) => {
    await page.goto(`${prefix}/`, { waitUntil: 'load' });
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(t(locale, 'home.heading'));
    await expect(page.getByRole('link', { name: t(locale, 'home.apply') })).toBeVisible();
    await expect(page.getByRole('link', { name: t(locale, 'home.roadmap') })).toHaveCount(0);
  });

  test(`${lang}: the home page passes axe`, async ({ page }) => {
    await page.goto(`${prefix}/`, { waitUntil: 'load' });
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map(({ id, nodes }) => `${id}: ${String(nodes.length)}`)).toEqual([]);
  });
}
