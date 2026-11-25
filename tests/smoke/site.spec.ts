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
import { LOCALES, langTag, localePath, t, type Locale } from '../../apps/web/src/i18n/t.ts';
import { FULL_NAME_WIDTH, MENU_LIVE, nextLocale, wantedLive, type MenuLive } from '../support/language-menu.ts';
import { APPEAL_PATH, SUPPORT_PATH, TICKET_PATH } from '../../apps/web/src/support.ts';
import { SMOKE_APPEAL_TOKEN, SMOKE_TICKET_TOKEN, builtShydeskOrigin } from '../support/support-page.ts';
import { HELLOS } from '../../apps/web/src/brand.ts';
import { HOLDING_FACTS, BRAND_FONTS, NARROW_WIDTH, PHONE_WIDTH, wantedFacts, type HoldingFacts } from '../support/holding-facts.ts';
import { LEGAL_DOCS, legalLines, legalLocale, legalPath } from '../../apps/web/src/legal/legal.ts';
import { ACCOUNT_PRIVACY_KEYS } from '../support/account-privacy.ts';
import { pagePath, pageUrl, sitePages } from '../../apps/web/src/preview.ts';
import { PAGE_FILES, PREVIEW_FACTS, PREVIEW_TAGS, builtSiteOrigin, wantedPreview, type PreviewFacts } from '../support/link-preview.ts';
import { SITE_USER } from '../../packages/environment/index.ts';
import { MILESTONES, boardDelivery, linePattern, stateEndings } from '../support/roadmap-page.ts';
import { smokeWebhookSecret } from './targets.ts';
import { updatedLine } from '../../apps/web/src/roadmap/view.ts';
import { pageWords } from '../../apps/web/src/roadmap/words.ts';

/**
 * The site password's box answer (shyden-labs/ShyTalk#262), for the one check that fetches with no cookie and so
 * cannot use the browser's remembered answer; null where the run gives no password.
 */
const sitePassword = process.env.SMOKE_SITE_PASSWORD ?? '';
const SITE_BOX = sitePassword === '' ? null : `Basic ${btoa(`${SITE_USER}:${sitePassword}`)}`;

const LANGUAGES = [
  { lang: 'en', locale: 'en', prefix: '' },
  { lang: 'id', locale: 'id', prefix: '/id' },
  { lang: 'th', locale: 'th', prefix: '/th' },
  { lang: 'vi', locale: 'vi', prefix: '/vi' },
  { lang: 'zh-Hans', locale: 'zh', prefix: '/zh' },
] as const;

/** The holding page's look, measured in the page by the check its iPhone copy runs too (shyden-labs/ShyTalk#273). */
async function holdingFacts(page: Page): Promise<HoldingFacts> {
  return page.evaluate<HoldingFacts>(`(${HOLDING_FACTS})(${JSON.stringify(BRAND_FONTS)})`);
}

/** The language menu as the page draws it (shyden-labs/ShyTalk#332). */
async function menuLive(page: Page): Promise<MenuLive> {
  return page.evaluate<MenuLive>(`(${MENU_LIVE})()`);
}

const MENU_BUTTON = 'details.lang-switch > summary';

/**
 * The language menu shut, opened by a click (passing axe while open) and shut again by the keyboard's Enter
 * (shyden-labs/ShyTalk#332): its iPhone copy taps where this presses Enter, as the phone has no keyboard.
 */
async function menuOpensAndShuts(page: Page, locale: Locale): Promise<void> {
  let now = await menuLive(page);
  expect.soft(now, 'the menu, shut').toEqual(wantedLive(locale, now.width, false));
  await page.locator(MENU_BUTTON).click();
  now = await menuLive(page);
  expect.soft(now, 'the menu, opened by a click').toEqual(wantedLive(locale, now.width, true));
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect
    .soft(
      violations.map(({ id, nodes }) => `${id}: ${String(nodes.length)}`),
      'axe, the menu open',
    )
    .toEqual([]);
  await page.locator(MENU_BUTTON).press('Enter');
  now = await menuLive(page);
  expect.soft(now, 'the menu, shut by Enter').toEqual(wantedLive(locale, now.width, false));
}

/** The next language picked from the menu by clicks opens `href`, in that language (shyden-labs/ShyTalk#332). */
async function menuPicks(page: Page, locale: Locale, href: string): Promise<void> {
  const next = langTag(nextLocale(locale));
  await page.locator(MENU_BUTTON).click();
  await page.locator(`details.lang-switch a.entry[hreflang="${next}"]`).click();
  await expect.soft(page, "the picked language's page").toHaveURL((url) => `${url.pathname}${url.search}` === href);
  await expect.soft(page.locator('html')).toHaveAttribute('lang', next);
}

/**
 * On a page an emailed or notice link opens (shyden-labs/ShyTalk#352): another language picked from the menu opens
 * that language's page with the address's fragment, so the piece still opens the thread; English picked from the menu
 * stays English, keeping the fragment, whatever the browser's language.
 */
async function menuKeepsToken(page: Page, locale: Locale, path: string, hash: string, view: string): Promise<void> {
  // The language after this one, never English: en, then id, th, vi, zh, and id again.
  const other = LOCALES[(LOCALES.indexOf(locale) % (LOCALES.length - 1)) + 1] as Locale;
  await page.locator(MENU_BUTTON).click();
  await page.locator(`details.lang-switch a.entry[hreflang="${langTag(other)}"]`).click();
  await expect
    .soft(page, 'another language keeps the token')
    .toHaveURL((url) => `${url.pathname}${url.hash}` === `${localePath(other, path)}${hash}`);
  await expect.soft(page.locator(`shydesk-support[view="${view}"]`)).toHaveAttribute('lang', other);
  await page.locator(MENU_BUTTON).click();
  await page.locator('details.lang-switch a.entry[hreflang="en"]').click();
  // The page marks that it chose to stay; one that moves to the browser's language never does.
  await expect.soft(page.locator('shydesk-support[data-language-kept]')).toHaveCount(1);
  await expect.soft(page, 'English stays English, keeping the token').toHaveURL((url) => `${url.pathname}${url.hash}` === `${path}${hash}`);
  await expect.soft(page.locator('html')).toHaveAttribute('lang', 'en');
}

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
  test(`${lang}: the home page answers 200 in ${lang}, shows its heading and no roadmap button, passes axe, each footer legal link opens the right page, with its note if any, passing axe, and its language menu opens, shuts and changes the language, with no CSP refusal`, async ({
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
    // The footer reaches support through its page, never an email address (shyden-labs/ShyTalk#37 AC3).
    const supportLink = page.getByRole('contentinfo').getByRole('link', { name: t(locale, 'footer.contact'), exact: true });
    await expect.soft(supportLink).toHaveCount(1);
    await expect.soft(supportLink).toHaveAttribute('href', localePath(locale, SUPPORT_PATH));

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
    // The language menu (shyden-labs/ShyTalk#332): opened and shut, at a phone's width too (set here where the
    // browser can take a width, measured as it stands on a phone), then the next language picked from it.
    await page.goto(`${prefix}/`, { waitUntil: 'load' });
    await menuOpensAndShuts(page, locale);
    if ((await menuLive(page)).width >= FULL_NAME_WIDTH) {
      await page.setViewportSize({ width: NARROW_WIDTH, height: 740 });
      await page.reload({ waitUntil: 'load' });
    }
    const narrow = await menuLive(page);
    expect.soft(narrow.width).toBeLessThan(FULL_NAME_WIDTH);
    expect.soft(narrow, "the menu at a phone's width").toEqual(wantedLive(locale, narrow.width, false));
    await menuPicks(page, locale, localePath(nextLocale(locale), '/'));
    expect.soft(refusals).toEqual([]);
    // Every soft check above held (shyden-labs/ShyTalk#353: one hard assertion SonarCloud counts, S2699).
    expect(test.info().errors).toEqual([]);
  });

  test(`${lang}: an unknown page answers 404 in ${lang}, with no CSP refusal`, async ({ page }) => {
    const refusals = cspRefusals(page);
    const response = await page.goto(`${prefix}/no-such-page`, { waitUntil: 'load' });
    expect(response?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.getByRole('navigation')).toBeVisible();
    expect(refusals).toEqual([]);
  });

  // The holding page production answers with until the full release (shyden-labs/ShyTalk#261), in ShyTalk's brand
  // (#273): a language switch, the icon, the name, "Coming soon", the tagline, and the floating hellos (no contact address,
  // shyden-labs/ShyTalk#333). The
  // hellos keep still for reduced motion, and a phone's width shows five, inside the page; set here where the browser
  // can take a width, measured as it is on a phone.
  test(`${lang}: the holding page shows ShyTalk's brand, the language menu and the hellos, in ${lang}, passing axe, keeping still for reduced motion and fitting a phone, its menu opening, shutting and changing the language, with no CSP refusal`, async ({
    page,
  }) => {
    const refusals = cspRefusals(page);
    const response = await page.goto(`${prefix}/holding`, { waitUntil: 'load' });
    expect.soft(response?.status()).toBe(200);
    await expect.soft(page.locator('html')).toHaveAttribute('lang', lang);
    await menuOpensAndShuts(page, locale);
    const heading = page.getByRole('heading', { level: 1 });
    await expect.soft(heading).toBeVisible();
    await expect.soft(heading).toHaveText('ShyTalk');
    await expect.soft(heading.locator('span')).toHaveText('Talk');
    const badge = page.locator('p.badge');
    await expect.soft(badge).toBeVisible();
    await expect.soft(badge).toHaveText(t(locale, 'holding.comingSoon'));
    const tagline = page.locator('p.tagline');
    await expect.soft(tagline).toBeVisible();
    await expect.soft(tagline).toHaveText(t(locale, 'site.tagline'));
    expect
      .soft(
        await page
          .locator('ul.hellos > li')
          .evaluateAll((hellos) => hellos.map((hello) => [hello.getAttribute('lang'), hello.textContent.trim()])),
      )
      .toEqual(HELLOS.map(({ lang: helloLang, word }) => [helloLang, word]));
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect.soft(violations.map(({ id, nodes }) => `${id}: ${String(nodes.length)}`)).toEqual([]);
    const facts = await holdingFacts(page);
    expect.soft(facts).toEqual(wantedFacts(facts.width, facts.reducedMotion));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const still = await holdingFacts(page);
    expect.soft(still).toEqual(wantedFacts(still.width, true));
    if (still.width > PHONE_WIDTH) {
      await page.setViewportSize({ width: NARROW_WIDTH, height: 740 });
      await page.reload({ waitUntil: 'load' });
    }
    const phone = await holdingFacts(page);
    expect.soft(phone.width).toBeLessThanOrEqual(PHONE_WIDTH);
    expect.soft(phone).toEqual(wantedFacts(phone.width, phone.reducedMotion));
    const narrow = await menuLive(page);
    expect.soft(narrow, "the menu at a phone's width").toEqual(wantedLive(locale, narrow.width, false));
    await menuPicks(page, locale, `/${nextLocale(locale)}/`);
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

  // Link previews (shyden-labs/ShyTalk#198 AC1, AC3): every page the site builds in this language, read as a preview
  // fetcher reads it (its HTML as served, no scripts run, so a page that sends a signed-out visitor on still counts),
  // its tags in this language with addresses on the built environment's origin, and its picture 1200 by 630 and more
  // than one colour. The home page opens once; each page is fetched from it.
  // The support page embeds ShyDesk's support piece (shyden-labs/ShyTalk#37 AC1).
  test(`${lang}: the support page shows its heading and lines, and embeds ShyDesk's contact piece in ${lang}, passes axe, with no CSP refusal`, async ({
    page,
  }) => {
    const refusals = cspRefusals(page);
    const response = await page.goto(localePath(locale, SUPPORT_PATH), { waitUntil: 'load' });
    expect.soft(response?.status()).toBe(200);
    await expect.soft(page.locator('html')).toHaveAttribute('lang', lang);
    await expect.soft(page.getByRole('heading', { level: 1 })).toHaveText(t(locale, 'support.title'));
    for (const line of ['intro', 'englishForm']) {
      const statement = page.locator(`[data-line="${line}"]`);
      await expect.soft(statement).toBeVisible();
      await expect.soft(statement).toHaveText(t(locale, `support.${line}`));
    }
    const piece = page.locator('shydesk-support');
    await expect.soft(piece).toHaveAttribute('product', 'shytalk');
    await expect.soft(piece).toHaveAttribute('view', 'contact');
    await expect.soft(piece).toHaveAttribute('lang', locale);
    await expect.soft(page.locator('script[src$="/embed.js"]')).toHaveAttribute('src', `${builtShydeskOrigin()}/embed.js`);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect.soft(violations.map(({ id, nodes }) => `${id}: ${String(nodes.length)}`)).toEqual([]);
    expect(refusals).toEqual([]);
  });

  test(`${lang}: every page carries its link preview and its language menu in ${lang}, each preview picture is 1200 by 630 and not one flat colour, and no page offers an email address`, async ({
    page,
  }) => {
    const origin = builtSiteOrigin();
    await page.goto(`${prefix}/`, { waitUntil: 'load' });
    for (const file of sitePages(PAGE_FILES, locale)) {
      const path = pagePath(file);
      const facts = await page.evaluate<PreviewFacts>(
        `(${PREVIEW_FACTS})(${JSON.stringify(pageUrl('', path))}, ${JSON.stringify(PREVIEW_TAGS)}, ${JSON.stringify(SITE_BOX)})`,
      );
      expect.soft(facts.title, file).not.toBe('');
      expect.soft(facts, file).toEqual(wantedPreview(origin, locale, lang, path, facts.title));
    }
    // Every soft check above held (shyden-labs/ShyTalk#353: one hard assertion SonarCloud counts, S2699).
    expect(test.info().errors).toEqual([]);
  });

  // The roadmap (shyden-labs/ShyTalk#321 AC3): the board drawn at once, never a loading line, each milestone a button
  // named with its state that opens its own panel, the one bar, and when the board was read in the visitor's own zone.
  test(`${lang}: the roadmap page shows the board at once in ${lang}, its heading, a button named with its state for each milestone, the bar and when it was last read; a press opens that milestone's panel, Close shuts it, and Escape shuts it again; it passes axe and fits a phone's width, with no CSP refusal`, async ({
    page,
  }) => {
    const refusals = cspRefusals(page);
    const response = await page.goto(`${prefix}/roadmap`, { waitUntil: 'load' });
    expect.soft(response?.status()).toBe(200);
    await expect.soft(page.locator('html')).toHaveAttribute('lang', lang);
    const heading = page.getByRole('heading', { level: 1 });
    await expect.soft(heading).toBeVisible();
    await expect.soft(heading).toHaveText(t(locale, 'roadmap.heading'));
    const buttons = page.locator('.map button.spot');
    await expect.soft(buttons).toHaveCount(MILESTONES);
    const labels = await buttons.evaluateAll((all) => all.map((button) => button.getAttribute('aria-label') ?? ''));
    const endings = stateEndings(locale);
    expect.soft(labels.filter((label) => !endings.some((ending) => label.endsWith(ending)))).toEqual([]);
    await expect.soft(page.locator('.bar-words')).toHaveText(linePattern(locale, 'roadmap.bar'));
    // Worded in the browser's own zone, named, as the page's own code words it.
    const updated = page.locator('#roadmap-updated');
    const readAt = (await updated.getAttribute('data-read-at')) ?? '';
    const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    await expect.soft(updated).toHaveText(updatedLine(readAt, pageWords(locale), locale, zone));
    // A press opens the milestone's own panel; Close shuts it; a press again, then Escape, shuts it too.
    const first = buttons.first();
    const panel = page.locator('#roadmap-panel');
    await first.click();
    await expect.soft(first).toHaveAttribute('aria-expanded', 'true');
    await expect.soft(panel).toBeVisible();
    await expect.soft(panel.getByRole('heading', { level: 2 })).toHaveText(labels[0]?.split(', ')[0] ?? '(no label)');
    await expect.soft(panel.getByRole('heading', { level: 3 })).toHaveText(t(locale, 'roadmap.brings'));
    const open = await new AxeBuilder({ page }).analyze();
    expect.soft(open.violations.map(({ id, nodes }) => `${id}: ${String(nodes.length)}`)).toEqual([]);
    await panel.getByRole('button', { name: t(locale, 'roadmap.close') }).click();
    await expect.soft(panel).toBeHidden();
    await expect.soft(first).toHaveAttribute('aria-expanded', 'false');
    await first.click();
    await expect.soft(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.soft(panel).toBeHidden();
    // A phone's width: set here where the browser can take one, measured as it stands on a phone.
    if ((await page.evaluate(() => window.innerWidth)) > PHONE_WIDTH) {
      await page.setViewportSize({ width: NARROW_WIDTH, height: 740 });
      await page.reload({ waitUntil: 'load' });
    }
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect.soft(fits, "the page fits a phone's width").toBe(true);
    expect.soft(refusals).toEqual([]);
    expect(test.info().errors).toEqual([]);
  });
}

/**
 * The roadmap's live board (shyden-labs/ShyTalk#321 AC3), once per browser: an open page takes each fresh board read
 * as it comes, with no reload. A signed delivery for ShyTalk's board asks for the read, as GitHub's webhook does; on
 * CI the board is the stand-in's (tests/smoke/github-stand-in.ts), on the phones DEV's own. A real board edit reaching
 * an open page within 10 s is measured by hand (AC5).
 */
test('the roadmap page takes a fresh board read on its own, with no reload', async ({ page, request }) => {
  // What the browser says of its socket and in its console, so a socket that will not open fails naming why.
  const trouble: string[] = [];
  page.on('websocket', (socket) => {
    socket.on('socketerror', (error) => trouble.push(`socket error: ${error}`));
    socket.on('close', () => trouble.push('socket closed'));
  });
  page.on('console', (message) => {
    if (message.type() === 'error') trouble.push(`console: ${message.text()}`);
  });
  await page.goto('/roadmap', { waitUntil: 'load' });
  const live = page.locator('#roadmap-live');
  // A wait, then one assertion: an expect.poll counts a step per try, so its count would differ by browser speed.
  const opened = await page
    .locator('#roadmap-live[data-socket="open"]')
    .waitFor({ timeout: 5_000 })
    .then(
      () => true,
      () => false,
    );
  expect(opened ? 'open' : trouble.join('; ') || 'not open yet').toBe('open');
  const before = Number(await live.getAttribute('data-version'));
  await page.evaluate(() => {
    (window as { notReloaded?: boolean }).notReloaded = true;
  });
  const { body, headers } = boardDelivery(smokeWebhookSecret());
  const answer = await request.post('/hooks/github', { data: body, headers });
  expect(answer.status()).toBe(202);
  expect(await answer.json()).toEqual({ state: 'reading' });
  await expect(live).not.toHaveAttribute('data-version', String(before), { timeout: 10_000 });
  expect(Number(await live.getAttribute('data-version'))).toBeGreaterThan(before);
  expect(await page.evaluate(() => (window as { notReloaded?: boolean }).notReloaded)).toBe(true);
  await expect(page.locator('.map button.spot')).toHaveCount(MILESTONES);
});

/**
 * The closed-testing journey, in English, once per browser (shyden-labs/ShyTalk#55
 * AC7, shyden-labs/ShyTalk#150): apply through the real form with real typing
 * and clicks, follow the mailed link, press the button, see "confirmed". CI's
 * mail goes to the stand-in; the phones' goes out for real, to the test mailbox
 * (the `mailbox` fixture). Each browser applies once, inside APPLY_LIMIT's 5 a minute.
 */
/**
 * The two pages ShyDesk's emails and notices link to, in a Thai browser, so that English picked from the menu is a
 * real choice against the browser's language (shyden-labs/ShyTalk#352). Titled, as one-suite reads an untitled group's tests
 * under a name its counter does not give them.
 */
test.describe('in a Thai browser', () => {
  test.use({ locale: 'th-TH' });

  /**
   * The one ticket page ShyDesk's emailed link opens (shyden-labs/ShyTalk#37 AC1): it lands on the ticket page of the
   * language it shows, with the emailed token still in the fragment, and opens the piece's ticket view in that language.
   * Which browser language picks which page is the unit test's (tests/unit/support-page.test.ts).
   */
  test('the ticket page opens the ticket view in the browser’s language, keeping the emailed token, which its language menu keeps, English staying English, passes axe, with no CSP refusal', async ({
    page,
  }) => {
    const refusals = cspRefusals(page);
    const response = await page.goto(`${TICKET_PATH}#t=${SMOKE_TICKET_TOKEN}`, { waitUntil: 'load' });
    expect.soft(response?.status()).toBe(200);
    const piece = page.locator('shydesk-support[view="ticket"]');
    await expect.soft(piece).toHaveCount(1);
    const shown = await page.locator('html').getAttribute('lang');
    const locale = LOCALES.find((each) => langTag(each) === shown) ?? 'en';
    const address = new URL(page.url());
    expect.soft(`${address.pathname}${address.hash}`).toBe(`${localePath(locale, TICKET_PATH)}#t=${SMOKE_TICKET_TOKEN}`);
    await expect.soft(page.getByRole('heading', { level: 1 })).toHaveText(t(locale, 'support.ticketTitle'));
    await expect.soft(piece).toHaveAttribute('product', 'shytalk');
    await expect.soft(piece).toHaveAttribute('lang', locale);
    await menuKeepsToken(page, locale, TICKET_PATH, `#t=${SMOKE_TICKET_TOKEN}`, 'ticket');
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect.soft(violations.map(({ id, nodes }) => `${id}: ${String(nodes.length)}`)).toEqual([]);
    expect(refusals).toEqual([]);
  });

  /**
   * The one appeal page a punishment notice links to (shyden-labs/ShyTalk#310 AC4): it lands on the appeal page of the
   * language it shows, with the notice's token still in the fragment, and opens the piece's appeal view in that language.
   */
  test('the appeal page opens the appeal view in the browser’s language, keeping the notice’s token, which its language menu keeps, English staying English, passes axe, with no CSP refusal', async ({
    page,
  }) => {
    const refusals = cspRefusals(page);
    const response = await page.goto(`${APPEAL_PATH}#appeal=${SMOKE_APPEAL_TOKEN}`, { waitUntil: 'load' });
    expect.soft(response?.status()).toBe(200);
    const piece = page.locator('shydesk-support[view="appeal"]');
    await expect.soft(piece).toHaveCount(1);
    const shown = await page.locator('html').getAttribute('lang');
    const locale = LOCALES.find((each) => langTag(each) === shown) ?? 'en';
    const address = new URL(page.url());
    expect.soft(`${address.pathname}${address.hash}`).toBe(`${localePath(locale, APPEAL_PATH)}#appeal=${SMOKE_APPEAL_TOKEN}`);
    await expect.soft(page.getByRole('heading', { level: 1 })).toHaveText(t(locale, 'support.appealTitle'));
    for (const line of ['appealIntro', 'englishForm']) {
      const statement = page.locator(`[data-line="${line}"]`);
      await expect.soft(statement).toBeVisible();
      await expect.soft(statement).toHaveText(t(locale, `support.${line}`));
    }
    await expect.soft(piece).toHaveAttribute('product', 'shytalk');
    await expect.soft(piece).toHaveAttribute('lang', locale);
    await expect.soft(page.locator('script[src$="/embed.js"]')).toHaveAttribute('src', `${builtShydeskOrigin()}/embed.js`);
    await menuKeepsToken(page, locale, APPEAL_PATH, `#appeal=${SMOKE_APPEAL_TOKEN}`, 'appeal');
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect.soft(violations.map(({ id, nodes }) => `${id}: ${String(nodes.length)}`)).toEqual([]);
    expect(refusals).toEqual([]);
  });
});

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
