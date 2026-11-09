/**
 * The Appium copy of the smoke suite (tests/smoke/site.spec.ts) for Safari on
 * the iPhone Air: Playwright cannot drive real Safari on a USB iPhone, so this
 * copy is the one approved exception to "one suite, run unchanged" (Shyden's
 * ruling 2026-11-05, shyden-labs/ShyTalk#112). Its titles must equal the
 * Playwright suite's exactly (tests/unit/phone-smoke-names.test.ts), and each
 * case checks what its Playwright twin checks.
 */
import assert from 'node:assert/strict';
import { t, type Locale } from '../../apps/web/src/i18n/t.ts';
import { LEGAL_DOCS, legalLines, legalLocale } from '../../apps/web/src/legal/legal.ts';

/** What a case can ask of Safari; tests/phones/safari.ts drives it through Appium. */
export interface SafariPage {
  /** Opens a path on the target and answers the document's HTTP status. */
  goto(path: string): Promise<number>;
  /** Every Content Security Policy refusal the console logged since the last `goto`. */
  cspRefusals(): Promise<string[]>;
  attribute(selector: string, name: string): Promise<string | null>;
  isVisible(selector: string): Promise<boolean>;
  text(selector: string): Promise<string>;
  /** Visible links whose accessible name is exactly `name`. */
  visibleLinks(name: string): Promise<number>;
  /** Links whose accessible name is exactly `name`, visible or not. */
  links(name: string): Promise<number>;
  /** axe's violations on the current page, as `id: node count`. */
  axeViolations(): Promise<string[]>;
  /** A real tap on the element, through WebDriverAgent. */
  tap(selector: string): Promise<void>;
  /** Waits for `selector` to hold exactly `text`, failing at a ceiling and naming what it found. */
  waitForText(selector: string, text: string): Promise<void>;
}

export interface IphoneCase {
  title: string;
  run: (page: SafariPage) => Promise<void>;
}

const LANGUAGES = [
  { lang: 'en', locale: 'en', prefix: '' },
  { lang: 'id', locale: 'id', prefix: '/id' },
  { lang: 'th', locale: 'th', prefix: '/th' },
  { lang: 'vi', locale: 'vi', prefix: '/vi' },
  { lang: 'zh-Hans', locale: 'zh', prefix: '/zh' },
] as const;

/** Playwright's `getByRole('navigation')` and `getByRole('heading', { level: 1 })`, as CSS. */
const NAV = 'nav, [role="navigation"]';
const H1 = 'h1, [role="heading"][aria-level="1"]';

const STATEMENTS = ['noAccess', 'moreDetails', 'safeList', 'removed', 'retention'] as const;
const CONFIRM_BUTTON = '#confirm-button';

/** The checks both "answers" cases share: the page's language and navigation, and no CSP refusal. */
async function inLanguageWithoutRefusal(page: SafariPage, lang: string): Promise<void> {
  assert.equal(await page.attribute('html', 'lang'), lang);
  assert.ok(await page.isVisible(NAV), 'no visible navigation');
  assert.deepEqual(await page.cspRefusals(), []);
}

function casesFor(lang: string, locale: Locale, prefix: string): IphoneCase[] {
  return [
    {
      title: `${lang}: the home page answers 200 in ${lang}, with no CSP refusal`,
      run: async (page) => {
        assert.equal(await page.goto(`${prefix}/`), 200);
        await inLanguageWithoutRefusal(page, lang);
      },
    },
    {
      title: `${lang}: an unknown page answers 404 in ${lang}, with no CSP refusal`,
      run: async (page) => {
        assert.equal(await page.goto(`${prefix}/no-such-page`), 404);
        await inLanguageWithoutRefusal(page, lang);
      },
    },
    {
      title: `${lang}: the home page shows its heading in ${lang}, and no roadmap button`,
      run: async (page) => {
        await page.goto(`${prefix}/`);
        assert.ok(await page.isVisible(H1), 'no visible top heading');
        assert.equal(await page.text(H1), t(locale, 'home.heading'));
        assert.ok((await page.visibleLinks(t(locale, 'home.apply'))) > 0, 'no visible apply link');
        assert.equal(await page.links(t(locale, 'home.roadmap')), 0);
      },
    },
    {
      title: `${lang}: the home page passes axe`,
      run: async (page) => {
        await page.goto(`${prefix}/`);
        assert.deepEqual(await page.axeViolations(), []);
      },
    },
    {
      title: `${lang}: each footer legal link opens the right page, with its note if any, passing axe, with no CSP refusal`,
      run: async (page) => {
        const words = legalLines(legalLocale(locale));
        await page.goto(`${prefix}/`);
        for (const doc of LEGAL_DOCS) {
          await page.tap(`footer a[data-legal="${doc}"]`);
          await page.waitForText(H1, words[doc].title);
          assert.equal(await page.attribute('html', 'lang'), legalLocale(locale));
          assert.equal(await page.text('[data-governs]'), words.common.governs);
          if (locale === 'en' || locale === 'id') {
            assert.equal(await page.isVisible('[data-english-only]:not([hidden])'), false);
          } else {
            const note = `[data-english-only="${locale}"]`;
            assert.ok(await page.isVisible(note), 'no visible note');
            assert.equal(await page.text(note), t(locale, 'footer.englishOnly'));
          }
          assert.deepEqual(await page.axeViolations(), []);
          assert.deepEqual(await page.cspRefusals(), []);
          await page.goto(`${prefix}/`);
        }
      },
    },
    {
      title: `${lang}: the closed-testing page shows the form and every statement in ${lang}, passes axe, with no CSP refusal`,
      run: async (page) => {
        assert.equal(await page.goto(`${prefix}/closed-testing`), 200);
        assert.equal(await page.attribute('html', 'lang'), lang);
        for (const line of STATEMENTS) {
          const selector = `[data-line="${line}"]`;
          assert.ok(await page.isVisible(selector), `${line} is not visible`);
          assert.equal(await page.text(selector), t(locale, `closedTesting.${line}`));
        }
        assert.equal(await page.text('label[for="apply-email"]'), t(locale, 'closedTesting.emailLabel'));
        assert.equal(await page.text('label[for="apply-adult"]'), t(locale, 'closedTesting.adultLabel'));
        assert.ok(await page.isVisible('#apply-email'), 'no visible email box');
        assert.ok(await page.isVisible('#apply-adult'), 'no visible age box');
        assert.equal(await page.text('#apply-submit'), t(locale, 'closedTesting.submit'));
        assert.deepEqual(await page.axeViolations(), []);
        assert.deepEqual(await page.cspRefusals(), []);
      },
    },
    {
      title: `${lang}: the confirm page passes axe, and its button with a dead link shows link-expired in ${lang}, with no CSP refusal`,
      run: async (page) => {
        await page.goto(`${prefix}/closed-testing/confirm?t=no-such-link`);
        assert.deepEqual(await page.axeViolations(), []);
        assert.equal(await page.text(CONFIRM_BUTTON), t(locale, 'closedTesting.confirmButton'));
        await page.tap(CONFIRM_BUTTON);
        await page.waitForText(H1, t(locale, 'closedTesting.expiredHeading'));
        assert.deepEqual(await page.cspRefusals(), []);
      },
    },
  ];
}

export const IPHONE_CASES: IphoneCase[] = LANGUAGES.flatMap(({ lang, locale, prefix }) => casesFor(lang, locale, prefix));
