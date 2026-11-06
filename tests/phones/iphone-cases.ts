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
}

export interface IphoneCase {
  title: string;
  run(page: SafariPage): Promise<void>;
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
  ];
}

export const IPHONE_CASES: IphoneCase[] = LANGUAGES.flatMap(({ lang, locale, prefix }) => casesFor(lang, locale, prefix));
