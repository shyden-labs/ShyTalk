/**
 * Each language's home answers 200 and an unknown page 404, both in that
 * language (`<html lang>`), with no Content Security Policy refusal in the
 * console (shyden-labs/ShyTalk#51 AC4). One test per page and language.
 */
import { test, expect, type Page } from '@playwright/test';

const LANGUAGES = [
  { lang: 'en', prefix: '' },
  { lang: 'id', prefix: '/id' },
  { lang: 'th', prefix: '/th' },
  { lang: 'vi', prefix: '/vi' },
  { lang: 'zh-Hans', prefix: '/zh' },
] as const;

/** Every console line the browser writes about the CSP refusing something. */
function cspRefusals(page: Page): string[] {
  const refusals: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) refusals.push(message.text());
  });
  return refusals;
}

for (const { lang, prefix } of LANGUAGES) {
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
}
