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
import { codeIn, plusAddress, waitForAnyMail, waitForMail } from './test-mailbox.ts';
import { base32, totpAt } from '../support/totp.ts';
import { countingCheck, type Check } from './check.ts';

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
  /** The elements `selector` matches: Playwright's `toHaveCount`. */
  count(selector: string): Promise<number>;
  /** axe's violations on the current page, as `id: node count`. */
  axeViolations(): Promise<string[]>;
  /** A real tap on the element, through WebDriverAgent. */
  tap(selector: string): Promise<void>;
  /** Real typing into the element, key by key on the iPhone's keyboard, through WebDriverAgent. */
  type(selector: string, text: string): Promise<void>;
  /** Waits for `selector` to hold exactly `text`, failing at a ceiling and naming what it found. */
  waitForText(selector: string, text: string): Promise<void>;
}

export interface IphoneCase {
  title: string;
  /** Runs the case; each check goes through `check`, which counts it (shyden-labs/ShyTalk#180 AC7). */
  run: (page: SafariPage, check?: Check) => Promise<void>;
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
async function inLanguageWithoutRefusal(page: SafariPage, check: Check, lang: string): Promise<void> {
  check.equal(await page.attribute('html', 'lang'), lang);
  check.ok(await page.isVisible(NAV), 'no visible navigation');
  check.deepEqual(await page.cspRefusals(), []);
}

/** A case whose checks go through `check`, a fresh counter when the caller gives none. */
function counted(title: string, run: (page: SafariPage, check: Check) => Promise<void>): IphoneCase {
  return { title, run: (page, check = countingCheck()) => run(page, check) };
}

/**
 * A tap on the control named `name`, as Playwright's `getByRole(…, { name }).click()`: the name is a condition of the
 * press, not a check of its own, so it is not counted (shyden-labs/ShyTalk#180 AC7).
 */
async function tapNamed(page: SafariPage, selector: string, name: string): Promise<void> {
  const shown = await page.text(selector);
  if (shown !== name) throw new assert.AssertionError({ message: `${selector} is named "${shown}", not "${name}"` });
  await page.tap(selector);
}

/**
 * Runs every check in order, even after one fails, then fails once naming
 * each failure: Playwright's `expect.soft`, for node's assert (one journey,
 * all its assertions; Shyden 2026-11-09, shyden-labs/ShyTalk#151).
 */
async function softly(checks: (() => Promise<void>)[]): Promise<void> {
  const failures: string[] = [];
  for (const check of checks) {
    try {
      await check();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length > 0) throw new assert.AssertionError({ message: failures.join('\n') });
}

function casesFor(lang: string, locale: Locale, prefix: string): IphoneCase[] {
  return [
    counted(
      `${lang}: the home page answers 200 in ${lang}, shows its heading and no roadmap button, passes axe, and each footer legal link opens the right page, with its note if any, passing axe, with no CSP refusal`,
      async (page, check) => {
        // Each goto starts the console afresh, so the refusals are gathered before each, and checked once at the end,
        // as Playwright checks the whole test's once.
        const refusals: string[] = [];
        await softly([
          async () => {
            check.equal(await page.goto(`${prefix}/`), 200);
          },
          async () => {
            check.equal(await page.attribute('html', 'lang'), lang);
          },
          async () => {
            check.ok(await page.isVisible(NAV), 'no visible navigation');
          },
          async () => {
            check.ok(await page.isVisible(H1), 'no visible top heading');
          },
          async () => {
            check.equal(await page.text(H1), t(locale, 'home.heading'));
          },
          async () => {
            check.ok((await page.visibleLinks(t(locale, 'home.apply'))) > 0, 'no visible apply link');
          },
          async () => {
            check.equal(await page.links(t(locale, 'home.roadmap')), 0);
          },
          async () => {
            check.deepEqual(await page.axeViolations(), []);
          },
        ]);
        // Then each footer legal link (shyden-labs/ShyTalk#56 AC4; #180: one journey, as both opened the home page
        // first). A legal page in a language without its own text is the English page with an English footer, so the
        // next link in this language is found back on the home page; not after the last.
        const words = legalLines(legalLocale(locale));
        for (const doc of LEGAL_DOCS) {
          await page.tap(`footer a[data-legal="${doc}"]`);
          await check.waitForText(page, H1, words[doc].title);
          check.ok(await page.isVisible(H1), 'no visible top heading');
          check.equal(await page.attribute('html', 'lang'), legalLocale(locale));
          check.equal(await page.text('[data-governs]'), words.common.governs);
          if (locale === 'en' || locale === 'id') {
            check.equal(await page.isVisible('[data-english-only]:not([hidden])'), false);
          } else {
            const note = `[data-english-only="${locale}"]`;
            check.ok(await page.isVisible(note), 'no visible note');
            check.equal(await page.text(note), t(locale, 'footer.englishOnly'));
          }
          check.deepEqual(await page.axeViolations(), []);
          if (doc !== LEGAL_DOCS.at(-1)) {
            refusals.push(...(await page.cspRefusals()));
            await page.goto(`${prefix}/`);
          }
        }
        refusals.push(...(await page.cspRefusals()));
        check.deepEqual(refusals, []);
      },
    ),
    counted(`${lang}: an unknown page answers 404 in ${lang}, with no CSP refusal`, async (page, check) => {
      check.equal(await page.goto(`${prefix}/no-such-page`), 404);
      await inLanguageWithoutRefusal(page, check, lang);
    }),
    counted(
      `${lang}: the closed-testing page shows the form and every statement in ${lang}, passes axe, with no CSP refusal`,
      async (page, check) => {
        check.equal(await page.goto(`${prefix}/closed-testing`), 200);
        check.equal(await page.attribute('html', 'lang'), lang);
        for (const line of STATEMENTS) {
          const selector = `[data-line="${line}"]`;
          check.ok(await page.isVisible(selector), `${line} is not visible`);
          check.equal(await page.text(selector), t(locale, `closedTesting.${line}`));
        }
        // Playwright's getByLabel(…) and getByRole('button', { name }) seen: the control shown, under its words.
        for (const [selector, words, what] of [
          ['#apply-email', await page.text('label[for="apply-email"]'), 'emailLabel'],
          ['#apply-adult', await page.text('label[for="apply-adult"]'), 'adultLabel'],
          ['#apply-submit', await page.text('#apply-submit'), 'submit'],
        ] as const) {
          const wanted = t(locale, `closedTesting.${what}`);
          check.ok((await page.isVisible(selector)) && words === wanted, `no visible ${selector} under "${wanted}": "${words}"`);
        }
        check.deepEqual(await page.axeViolations(), []);
        check.deepEqual(await page.cspRefusals(), []);
      },
    ),
    counted(
      `${lang}: the confirm page passes axe, and its button with a dead link shows link-expired in ${lang}, with no CSP refusal`,
      async (page, check) => {
        await page.goto(`${prefix}/closed-testing/confirm?t=no-such-link`);
        check.deepEqual(await page.axeViolations(), []);
        await tapNamed(page, CONFIRM_BUTTON, t(locale, 'closedTesting.confirmButton'));
        await check.waitForText(page, H1, t(locale, 'closedTesting.expiredHeading'));
        check.ok(await page.isVisible(H1), 'no visible top heading');
        check.deepEqual(await page.cspRefusals(), []);
      },
    ),
  ];
}

/**
 * The closed-testing journey, in English, once (tests/smoke/site.spec.ts's last
 * test, shyden-labs/ShyTalk#150): its mail goes out for real, to the test
 * mailbox's plus-address for this run. The confirmed page's own heading stands
 * for Playwright's wait on its address: no other page shows it.
 */
const JOURNEY: IphoneCase = counted('applying and following the mailed link confirms the address', async (page, check) => {
  const tag = `iphone-air-${String(Date.now())}`;
  await page.goto('/closed-testing');
  await page.type('#apply-email', plusAddress(tag));
  await page.tap('#apply-adult');
  await page.tap('#apply-submit');
  await check.waitForText(page, '#apply-answer', t('en', 'closedTesting.sent'));
  check.ok(await page.isVisible('#apply-answer'), 'no visible answer');

  const { subject, confirmLink } = await waitForMail(tag, { password: process.env.TEST_MAILBOX_PASSWORD ?? '' });
  check.equal(subject, t('en', 'closedTesting.mailSubject'));

  const { pathname, search } = new URL(confirmLink);
  await page.goto(`${pathname}${search}`);
  await page.tap(CONFIRM_BUTTON);
  await check.waitForText(page, H1, t('en', 'closedTesting.confirmedHeading'));
  check.ok(await page.isVisible(H1), 'no visible top heading');
});

/**
 * Joining, in English, once (tests/smoke/site.spec.ts, shyden-labs/ShyTalk#133,
 * #134): the code goes out for real to this run's plus-address and is read
 * over IMAP; the authenticator's code is computed from the key the page shows,
 * as the member's app would; then the account page, sign-out, and signing back
 * in with the app's next code.
 */
const SIGN_UP_JOURNEY: IphoneCase = counted(
  'joining with the mailed code and an authenticator app, then signing back in with it',
  async (page, check) => {
    const tag = `iphone-air-${String(Date.now())}`;
    const address = plusAddress(tag);
    await page.goto('/sign-up');
    await page.type('#email-address', address);
    await page.tap('#email-submit');
    await check.waitForText(page, '#email-answer', t('en', 'account.sent'));
    check.ok(await page.isVisible('#email-answer'), 'no visible answer');
    const codeMail = await waitForAnyMail(tag, { password: process.env.TEST_MAILBOX_PASSWORD ?? '' });
    check.equal(codeMail.subject, t('en', 'email.codeSubject'));
    await page.type('#email-code', codeIn(codeMail));
    await page.tap('#code-submit');
    await check.waitForText(page, '#email-answer', t('en', 'account.signUpConfirmed'));
    check.equal(await page.isVisible('#email-address'), false, 'the address form stays after the code was accepted');

    await page.tap('#setup-authenticator');
    check.ok(await page.isVisible('[data-testid="totp-secret"]'), 'no visible authenticator key');
    const secret = base32(await page.text('[data-testid="totp-secret"]'));
    await page.type('#totp-code', await totpAt(secret, 0));
    await page.tap('#totp-confirm');
    // A wait for the next page, as Playwright's waits on a locator or address: not a check, so not counted.
    await page.waitForText('#codes-title', t('en', 'account.codesTitle'));
    const codes = await page.count(CODES);
    check.equal(codes, 10, `ten recovery codes, not ${String(codes)}`);
    check.match(await page.text(CODES), /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    await page.tap('#codes-saved');

    await check.waitForText(page, H1, t('en', 'account.accountTitle'));
    check.equal(await page.text('[data-testid="method-authenticator"]'), t('en', 'account.authenticatorOn'));
    const devices = await page.count(DEVICES);
    check.equal(devices, 1, `one signed-in device, not ${String(devices)}`);
    await page.tap('#sign-out');
    await page.waitForText(H1, t('en', 'account.signInTitle'));
    await page.type('#signin-email', address);
    await page.type('#signin-code', await totpAt(secret, 1));
    await page.tap('#signin-submit');
    await check.waitForText(page, H1, t('en', 'account.accountTitle'));
    check.equal(await page.isVisible(NOTICE), false, 'a recovery notice before any recovery started');

    // A recovery started for this address shows on this signed-in device, which cancels it there
    // (as tests/smoke/site.spec.ts does; shyden-labs/ShyTalk#133 AC3, #180).
    const signUpCode = codeIn(codeMail);
    await page.goto('/recover');
    await page.type('#email-address', address);
    await page.tap('#email-submit');
    await check.waitForText(page, '#email-answer', t('en', 'account.sent'));
    // The mailbox answers only its newest mail: wait for the recovery code to replace the sign-up one.
    const recoveryCode = await check.poll(() =>
      waitFor('the recovery code mail', async () => {
        const code = codeIn(await waitForAnyMail(tag, { password: process.env.TEST_MAILBOX_PASSWORD ?? '' }));
        return code === signUpCode ? null : code;
      }),
    );
    await page.type('#email-code', recoveryCode);
    await page.tap('#code-submit');
    const started = matching(t('en', 'account.recoveryStarted'), '{completesAt}');
    await check.poll(() =>
      waitFor('the recovery-started answer', async () => (started.test(await page.text('#email-answer')) ? true : null)),
    );

    await page.goto('/account/');
    await check.poll(() => waitFor('the recovery notice', async () => ((await page.isVisible(NOTICE)) ? true : null)));
    check.match(await page.text('#recovery-pending-text'), matching(t('en', 'account.recoveryPending'), '{startedAt}'));
    await page.tap('#recovery-cancel');
    await check.poll(() => waitFor('the recovery notice to hide', async () => ((await page.isVisible(NOTICE)) ? null : true)));
  },
);

const NOTICE = '#recovery-pending';
/** Playwright's `getByTestId(…).getByRole('listitem')`, as CSS. */
const CODES = '[data-testid="recovery-codes"] li, [data-testid="recovery-codes"] [role="listitem"]';
const DEVICES = '[data-testid="devices"] li, [data-testid="devices"] [role="listitem"]';

/** `line` as a pattern, its one `placeholder` standing for any text. */
function matching(line: string, placeholder: string): RegExp {
  const parts = line.split(placeholder).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('.+')}$`);
}

const WAIT_CEILING_MS = 60_000;
const WAIT_EVERY_MS = 1_000;

/** Looks every second until `look` answers something other than null, failing at a ceiling that names `what`. */
async function waitFor<T>(what: string, look: () => Promise<T | null>): Promise<T> {
  const started = Date.now();
  for (;;) {
    const found = await look();
    if (found !== null) return found;
    if (Date.now() - started >= WAIT_CEILING_MS) throw new Error(`waited ${String(WAIT_CEILING_MS / 1000)} s for ${what}`);
    await new Promise<void>((done) => setTimeout(done, WAIT_EVERY_MS));
  }
}

/**
 * The recovery pages, in English, once (tests/smoke/site.spec.ts,
 * shyden-labs/ShyTalk#133): the code step appears after a start, and the
 * cancel page answers only once its button is tapped.
 */
const RECOVERY_PAGES: IphoneCase = counted(
  'asking to recover shows the code step, and a cancel link answers on its press',
  async (page, check) => {
    await page.goto('/recover');
    await page.type('#email-address', plusAddress(`iphone-air-recover-${String(Date.now())}`));
    await page.tap('#email-submit');
    await check.waitForText(page, '#email-answer', t('en', 'account.sent'));
    check.equal(await page.isVisible('#email-code'), true, 'no code field after the start');
    await page.goto('/recover/cancel/#not-a-real-token');
    check.equal(await page.isVisible('#cancel-answer'), false, 'the cancel page answered before its button was tapped');
    await page.tap('#cancel-button');
    await check.waitForText(page, '#cancel-answer', t('en', 'account.cancelled'));
  },
);

export const IPHONE_CASES: IphoneCase[] = [
  ...LANGUAGES.flatMap(({ lang, locale, prefix }) => casesFor(lang, locale, prefix)),
  JOURNEY,
  SIGN_UP_JOURNEY,
  RECOVERY_PAGES,
];
