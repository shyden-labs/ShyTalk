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
import { codeIn, MAIL_CEILING_MS } from '../phones/test-mailbox.ts';
import { base32, totpAt } from '../support/totp.ts';
import AxeBuilder from '@axe-core/playwright';
import { t } from '../../apps/web/src/i18n/t.ts';
import { LEGAL_DOCS, legalLines, legalLocale, legalPath } from '../../apps/web/src/legal/legal.ts';
import { ACCOUNT_PRIVACY_KEYS } from '../support/account-privacy.ts';
import { sitePages } from '../../apps/web/src/site-pages.ts';
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, pagePath, pageUrl, previewImageUrl } from '../../apps/web/src/preview.ts';
import { builtSiteOrigin, PAGE_FILES, PICTURE_FACTS, previewTag, type PictureFacts } from '../support/link-preview.ts';

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
  // The home page, then each footer legal link from it (shyden-labs/ShyTalk#56 AC4; #180: one journey, as both opened
  // the home page first). A legal page in a language without its own text is the English page with an English footer,
  // so the next link in this language is found back on the home page.
  test(`${lang}: the home page answers 200 in ${lang}, shows its heading and no roadmap button, passes axe, and each footer legal link opens the right page, with its note if any, passing axe, with no CSP refusal`, async ({
    page,
  }) => {
    const refusals = cspRefusals(page);
    const response = await page.goto(`${prefix}/`, { waitUntil: 'load' });
    expect.soft(response?.status()).toBe(200);
    await expect.soft(page.locator('html')).toHaveAttribute('lang', lang);
    // The keyboard resizes the page, never pans over it (shyden-labs/ShyTalk#189).
    await expect
      .soft(page.locator('meta[name="viewport"]'))
      .toHaveAttribute('content', 'width=device-width, initial-scale=1, interactive-widget=resizes-content');
    await expect.soft(page.getByRole('navigation')).toBeVisible();
    const homeHeading = page.getByRole('heading', { level: 1 });
    await expect.soft(homeHeading).toBeVisible();
    await expect.soft(homeHeading).toHaveText(t(locale, 'home.heading'));
    await expect.soft(page.getByRole('link', { name: t(locale, 'home.apply') })).toBeVisible();
    await expect.soft(page.getByRole('link', { name: t(locale, 'home.roadmap') })).toHaveCount(0);
    const home = await new AxeBuilder({ page }).analyze();
    expect.soft(home.violations.map(({ id, nodes }) => `${id}: ${String(nodes.length)}`)).toEqual([]);

    const words = legalLines(legalLocale(locale));
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
      // #171 AC4: the privacy page shows what an account keeps, in English and in Indonesian.
      if (doc === 'privacy') {
        const privacy = words.privacy as Record<string, string | undefined>;
        for (const key of ACCOUNT_PRIVACY_KEYS) {
          await expect.soft(page.locator('main').getByText(privacy[key] ?? `(no privacy.${key})`, { exact: true }), key).toBeVisible();
        }
      }
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect.soft(violations.map(({ id, nodes }) => `${id}: ${String(nodes.length)}`)).toEqual([]);
      if (doc !== LEGAL_DOCS.at(-1)) await page.goto(`${prefix}/`, { waitUntil: 'load' });
    }
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

  // Link previews (shyden-labs/ShyTalk#198 AC1, AC3): every page the site builds in this language, its tags in its own
  // language with addresses on the environment's origin, and its picture: 1200 by 630 and more than one colour.
  test(`${lang}: every page carries its link preview in ${lang}, and each preview picture is 1200 by 630 and not one flat colour`, async ({
    page,
  }) => {
    const origin = builtSiteOrigin();
    for (const file of sitePages(PAGE_FILES, locale)) {
      const path = pagePath(file);
      await page.goto(pageUrl('', path), { waitUntil: 'load' });
      const meta = (key: string) => page.locator(previewTag(key));
      await expect.soft(page.locator('html'), file).toHaveAttribute('lang', lang);
      await expect.soft(meta('og:title'), file).toHaveAttribute('content', await page.title());
      await expect.soft(meta('og:description'), file).toHaveAttribute('content', t(locale, 'site.tagline'));
      await expect.soft(meta('og:image'), file).toHaveAttribute('content', previewImageUrl(origin, path));
      await expect.soft(meta('og:image:width'), file).toHaveAttribute('content', String(PREVIEW_WIDTH));
      await expect.soft(meta('og:image:height'), file).toHaveAttribute('content', String(PREVIEW_HEIGHT));
      await expect.soft(meta('og:image:alt'), file).toHaveAttribute('content', t(locale, 'site.previewAlt'));
      await expect.soft(meta('og:url'), file).toHaveAttribute('content', pageUrl(origin, path));
      await expect.soft(meta('og:type'), file).toHaveAttribute('content', 'website');
      await expect.soft(meta('twitter:card'), file).toHaveAttribute('content', 'summary_large_image');
      // The picture is fetched from this server, whatever origin its address names, so the smoke checks what it serves.
      const picture = await page.evaluate<PictureFacts>(
        `(${PICTURE_FACTS})(${JSON.stringify(new URL(previewImageUrl(origin, path)).pathname)})`,
      );
      expect.soft(picture, file).toEqual({ loaded: true, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, manyColours: true });
    }
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

/**
 * Joining, in English, once per browser (shyden-labs/ShyTalk#133, #134): the
 * real form with real typing; the code read from the mail the site sent; an
 * authenticator app set up from the key the page shows (its code computed as
 * the member's app would); the ten recovery codes shown once; the account page;
 * sign-out; signing back in with the app's next code; the sign-up and recovery
 * pages saying signed in (#213); and a recovery, seen after signing in with a
 * saved recovery code. The authenticator
 * path runs unchanged in every browser; passkeys are proven on the phones by
 * real touches (spec 2026-11-09, Proof).
 */
test('joining with the mailed code and an authenticator app, then signing back in with it', async ({ page, mailbox }) => {
  await page.goto('/sign-up', { waitUntil: 'load' });
  // The form shows once the page has asked whether it is signed in (#213): typing waits for it, as a person does.
  await expect(page.getByLabel(t('en', 'account.emailLabel'))).toBeVisible();
  await page.getByLabel(t('en', 'account.emailLabel')).pressSequentially(mailbox.address);
  await page.getByRole('button', { name: t('en', 'account.sendCode') }).click();
  const answer = page.getByRole('status');
  await expect(answer).toBeVisible();
  await expect(answer).toHaveText(t('en', 'account.sent'));

  const mail = await mailbox.anyMail();
  expect(mail.subject).toBe(t('en', 'email.codeSubject'));
  await page.getByLabel(t('en', 'account.codeLabel')).pressSequentially(codeIn(mail));
  await page.getByRole('button', { name: t('en', 'account.confirmCode') }).click();
  await expect(answer).toHaveText(t('en', 'account.signUpConfirmed'));
  await expect(page.getByLabel(t('en', 'account.emailLabel'))).toBeHidden();

  await page.getByRole('button', { name: t('en', 'account.useAuthenticator') }).click();
  const key = page.getByTestId('totp-secret');
  await expect(key).toBeVisible();
  const secret = base32((await key.textContent()) ?? '');
  await page.getByLabel(t('en', 'account.authenticatorCodeLabel')).pressSequentially(await totpAt(secret, 0));
  await page.getByRole('button', { name: t('en', 'account.confirmAuthenticator'), exact: true }).click();

  const codes = page.getByTestId('recovery-codes').getByRole('listitem');
  await expect(codes).toHaveCount(10);
  await expect(codes.first()).toHaveText(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  const savedCode = (await codes.first().textContent()) ?? '';
  await page.getByRole('button', { name: t('en', 'account.codesSaved') }).click();

  await page.waitForURL('**/account/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('en', 'account.accountTitle'));
  await expect(page.getByTestId('method-authenticator')).toHaveText(t('en', 'account.authenticatorOn'));
  await expect(page.getByTestId('devices').getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: t('en', 'account.signOut'), exact: true }).click();

  await page.waitForURL('**/sign-in/');
  await page.getByLabel(t('en', 'account.emailLabel')).pressSequentially(mailbox.address);
  await page.getByLabel(t('en', 'account.authenticatorCodeLabel')).pressSequentially(await totpAt(secret, 1));
  await page.getByRole('button', { name: t('en', 'account.signInWithAuthenticator'), exact: true }).click();
  await page.waitForURL('**/account/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('en', 'account.accountTitle'));
  const pending = page.getByTestId('recovery-pending');
  await expect(pending).toBeHidden();

  // Signed in, the sign-up and recovery pages say so and offer Sign out before anything else (#213).
  const signedIn = page.getByTestId('signed-in');
  const emailField = page.getByLabel(t('en', 'account.emailLabel'));
  await page.goto('/sign-up', { waitUntil: 'load' });
  await expect(signedIn).toBeVisible();
  await expect(signedIn).toHaveText(t('en', 'account.signedInFirst'));
  await expect(emailField).toBeHidden();
  await page.goto('/recover', { waitUntil: 'load' });
  await expect(signedIn).toBeVisible();
  await expect(signedIn).toHaveText(t('en', 'account.signedInFirst'));
  await expect(emailField).toBeHidden();
  await page.getByRole('button', { name: t('en', 'account.signOut'), exact: true }).click();
  await expect(emailField).toBeVisible();
  await expect(signedIn).toBeHidden();

  // A recovery started for this address shows on a signed-in device, which cancels it there (#133 AC3).
  const signUpCode = codeIn(mail);
  await emailField.pressSequentially(mailbox.address);
  await page.getByRole('button', { name: t('en', 'account.sendCode') }).click();
  await expect(answer).toHaveText(t('en', 'account.sent'));
  // Each mail source answers only the newest mail: wait until the recovery code has replaced the sign-up one.
  // Real mail took 48 s on the phones (2026-11-13): poll as long as the mail reader waits (shyden-labs/ShyTalk#185).
  await expect.poll(async () => codeIn(await mailbox.anyMail()), { timeout: MAIL_CEILING_MS }).not.toBe(signUpCode);
  await page.getByLabel(t('en', 'account.codeLabel')).pressSequentially(codeIn(await mailbox.anyMail()));
  await page.getByRole('button', { name: t('en', 'account.confirmCode') }).click();
  await expect(answer).toHaveText(filled(t('en', 'account.recoveryStarted'), '{completesAt}'));

  // Signing back in with a recovery code: the authenticator's next steps may not have come round yet.
  await page.goto('/sign-in', { waitUntil: 'load' });
  await page.getByRole('button', { name: t('en', 'account.useRecoveryCode'), exact: true }).click();
  await emailField.pressSequentially(mailbox.address);
  await page.getByLabel(t('en', 'account.recoveryCodeLabel')).pressSequentially(savedCode);
  await page.getByRole('button', { name: t('en', 'account.signInWithRecoveryCode'), exact: true }).click();
  // A recovery code's sign-in says how many are left before going on: ten were made, one is now used.
  await expect(answer).toHaveText(t('en', 'account.codesLeftAfterSignIn').replace('{count}', '9'));
  await page
    .locator('#signin-continue')
    .getByRole('link', { name: t('en', 'account.accountTitle'), exact: true })
    .click();
  await page.waitForURL('**/account/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('en', 'account.accountTitle'));
  await expect(pending).toBeVisible();
  await expect(page.getByTestId('recovery-pending-text')).toHaveText(filled(t('en', 'account.recoveryPending'), '{startedAt}'));
  await page.getByRole('button', { name: t('en', 'account.cancelButton'), exact: true }).click();
  await expect(pending).toBeHidden();
});

/** Matches `line` with its one `placeholder` filled by any text. */
function filled(line: string, placeholder: string): RegExp {
  const escaped = line.split(placeholder).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.+')}$`);
}

/**
 * The recovery pages, in English (shyden-labs/ShyTalk#133): asking to recover
 * shows the code step whether or not the address has an account, and the
 * notice's cancel page answers by its button only.
 */
test('asking to recover shows the code step, and a cancel link answers on its press', async ({ page, mailbox }) => {
  await page.goto('/recover', { waitUntil: 'load' });
  // The form shows once the page has asked whether it is signed in (#213).
  await expect(page.getByLabel(t('en', 'account.emailLabel'))).toBeVisible();
  await page.getByLabel(t('en', 'account.emailLabel')).pressSequentially(mailbox.address);
  await page.getByRole('button', { name: t('en', 'account.sendCode') }).click();
  const answer = page.getByRole('status');
  await expect(answer).toHaveText(t('en', 'account.sent'));
  await expect(page.getByLabel(t('en', 'account.codeLabel'))).toBeVisible();

  await page.goto('/recover/cancel/#not-a-real-token', { waitUntil: 'load' });
  const cancelAnswer = page.getByRole('status');
  await expect(cancelAnswer).toBeHidden();
  await page.getByRole('button', { name: t('en', 'account.cancelButton') }).click();
  await expect(cancelAnswer).toHaveText(t('en', 'account.cancelled'));
});
