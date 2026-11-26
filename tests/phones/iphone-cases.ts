/**
 * The Appium copy of the smoke suite (tests/smoke/site.spec.ts) for Safari on
 * the iPhone Air: Playwright cannot drive real Safari on a USB iPhone, so this
 * copy is the one approved exception to "one suite, run unchanged" (Shyden's
 * ruling 2026-11-05, shyden-labs/ShyTalk#112). Its titles must equal the
 * Playwright suite's exactly (tests/unit/phone-smoke-names.test.ts), and each
 * case checks what its Playwright twin checks.
 */
import assert from 'node:assert/strict';
import { LOCALES, langTag, localePath, t, type Locale } from '../../apps/web/src/i18n/t.ts';
import { APPEAL_PATH, SUPPORT_PATH, TICKET_PATH } from '../../apps/web/src/support.ts';
import { SMOKE_APPEAL_TOKEN, SMOKE_TICKET_TOKEN, builtShydeskOrigin } from '../support/support-page.ts';
import { HELLOS } from '../../apps/web/src/brand.ts';
import { LEGAL_DOCS, legalLines, legalLocale } from '../../apps/web/src/legal/legal.ts';
import { ACCOUNT_PRIVACY_KEYS } from '../support/account-privacy.ts';
import { codeIn, envMailboxPassword, MAIL_CEILING_MS, plusAddress, waitForAnyMail, waitForMail } from './test-mailbox.ts';
import { base32, totpAt } from '../support/totp.ts';
import { countingCheck, type Check } from './check.ts';
import { pagePath, pageUrl, sitePages } from '../../apps/web/src/preview.ts';
import { PAGE_FILES, builtSiteOrigin, wantedPreview, type PreviewFacts } from '../support/link-preview.ts';
import { PHONE_WIDTH, wantedFacts, type HoldingFacts } from '../support/holding-facts.ts';
import { FULL_NAME_WIDTH, nextLocale, wantedLive, type MenuLive } from '../support/language-menu.ts';
import { MILESTONES, boardDelivery, linePattern, stateEndings, type RoadmapDrawing, type RoadmapFacts } from '../support/roadmap-page.ts';
import { smokeWebhookSecret } from '../smoke/targets.ts';
import { updatedLine } from '../../apps/web/src/roadmap/view.ts';
import { pageWords } from '../../apps/web/src/roadmap/words.ts';

/** What a case can ask of Safari; tests/phones/safari.ts drives it through Appium. */
export interface SafariPage {
  /** Opens a path on the target and answers the document's HTTP status. */
  goto(path: string): Promise<number>;
  /** Leaves no cookie or stored value from an earlier case, as each Playwright test starts with a fresh context. */
  freshStart(): Promise<void>;
  /** Every Content Security Policy refusal the console logged since the last `goto`. */
  cspRefusals(): Promise<string[]>;
  attribute(selector: string, name: string): Promise<string | null>;
  isVisible(selector: string): Promise<boolean>;
  text(selector: string): Promise<string>;
  /** The address Safari shows, after any redirect the page made itself. */
  url(): Promise<string>;
  /** Visible links whose accessible name is exactly `name`. */
  visibleLinks(name: string): Promise<number>;
  /** Links whose accessible name is exactly `name`, visible or not. */
  links(name: string): Promise<number>;
  /** Each element `selector` matches, as its `attributes` in order and then its trimmed text. */
  rows(selector: string, attributes: string[]): Promise<(string | null)[][]>;
  /** The holding page's look, by the smoke's own in-page check (shyden-labs/ShyTalk#273). */
  holdingFacts(): Promise<HoldingFacts>;
  /** The language menu as the page draws it, by the smoke's own in-page check (shyden-labs/ShyTalk#332). */
  menuLive(): Promise<MenuLive>;
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
  /** The page at `path` as a link preview reads it, by the smoke's own in-page check (shyden-labs/ShyTalk#198). */
  previewFacts(path: string): Promise<PreviewFacts>;
  /** The roadmap page as the smoke reads it, by an in-page check (shyden-labs/ShyTalk#321). */
  roadmapFacts(): Promise<RoadmapFacts>;
  /** Marks the page, so a reload since shows as the mark gone (shyden-labs/ShyTalk#321). */
  markPage(): Promise<void>;
  /** Turns the iPhone to its light or dark appearance, as its own setting does (shyden-labs/ShyTalk#364). */
  appearance(style: 'light' | 'dark'): Promise<void>;
  /** The roadmap's drawing as the smoke reads it, by an in-page check (shyden-labs/ShyTalk#364). */
  roadmapDrawing(): Promise<RoadmapDrawing>;
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

/** The holding page's lines under its name, by selector (shyden-labs/ShyTalk#273). */
const HOLDING_LINES = [
  ['p.badge', 'holding.comingSoon'],
  ['p.tagline', 'site.tagline'],
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
 * Runs every check in order, even after one fails, and answers each failure's reason: the case then makes one counted
 * check that there were none, as its Playwright twin ends with `expect(test.info().errors).toEqual([])`.
 */
async function failuresOf(checks: (() => Promise<void>)[]): Promise<string[]> {
  const failures: string[] = [];
  for (const each of checks) {
    try {
      await each();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  return failures;
}

/**
 * Runs every check in order, even after one fails, then fails once naming
 * each failure: Playwright's `expect.soft`, for node's assert (one journey,
 * all its assertions; Shyden 2026-11-09, shyden-labs/ShyTalk#151).
 */
async function softly(checks: (() => Promise<void>)[]): Promise<void> {
  const failures = await failuresOf(checks);
  if (failures.length > 0) throw new assert.AssertionError({ message: failures.join('\n') });
}

const MENU_BUTTON = 'details.lang-switch > summary';

/**
 * The language menu shut, opened by a tap (passing axe while open) and shut again (shyden-labs/ShyTalk#332), as the
 * smoke's menuOpensAndShuts: where it presses Enter, the phone, having no keyboard, taps, its real equivalent.
 */
async function menuOpensAndShuts(page: SafariPage, check: Check, locale: Locale): Promise<void> {
  let now = await page.menuLive();
  check.deepEqual(now, wantedLive(locale, now.width, false), 'the menu, shut');
  await page.tap(MENU_BUTTON);
  now = await page.menuLive();
  check.deepEqual(now, wantedLive(locale, now.width, true), 'the menu, opened by a tap');
  check.deepEqual(await page.axeViolations(), [], 'axe, the menu open');
  await page.tap(MENU_BUTTON);
  now = await page.menuLive();
  check.deepEqual(now, wantedLive(locale, now.width, false), 'the menu, shut by a tap');
}

/** The next language picked from the menu by taps opens `href`, in that language, as the smoke's menuPicks. */
async function menuPicks(page: SafariPage, check: Check, locale: Locale, href: string): Promise<void> {
  const next = langTag(nextLocale(locale));
  await page.tap(MENU_BUTTON);
  await page.tap(`details.lang-switch a.entry[hreflang="${next}"]`);
  check.equal(await pathWithin(page, href), href, "the picked language's page");
  check.equal(await page.attribute('html', 'lang'), next);
}

/**
 * On a page an emailed or notice link opens, as the smoke's menuKeepsToken (shyden-labs/ShyTalk#352): another language
 * picked by taps keeps the address's fragment; English picked stays English, keeping it, whatever Safari's language.
 */
async function menuKeepsToken(page: SafariPage, check: Check, locale: Locale, path: string, hash: string, view: string): Promise<void> {
  // The language after this one, never English: en, then id, th, vi, zh, and id again.
  const other = LOCALES[(LOCALES.indexOf(locale) % (LOCALES.length - 1)) + 1] as Locale;
  await page.tap(MENU_BUTTON);
  await page.tap(`details.lang-switch a.entry[hreflang="${langTag(other)}"]`);
  const elsewhere = `${localePath(other, path)}${hash}`;
  check.equal(await addressWithin(page, elsewhere), elsewhere, 'another language keeps the token');
  check.equal(await page.attribute(`shydesk-support[view="${view}"]`, 'lang'), other);
  await page.tap(MENU_BUTTON);
  await page.tap('details.lang-switch a.entry[hreflang="en"]');
  check.equal(await countWithin(page, 'shydesk-support[data-language-kept]'), 1, 'the page stays on English');
  check.equal(await addressWithin(page, `${path}${hash}`), `${path}${hash}`, 'English stays English, keeping the token');
  check.equal(await page.attribute('html', 'lang'), 'en');
}

/** Every page's viewport tag: the keyboard resizes the page, never pans over it (shyden-labs/ShyTalk#189). */
const VIEWPORT = 'width=device-width, initial-scale=1, interactive-widget=resizes-content';

function casesFor(lang: string, locale: Locale, prefix: string): IphoneCase[] {
  return [
    counted(
      `${lang}: the home page answers 200 in ${lang}, shows its heading and no roadmap button, passes axe, each footer legal link opens the right page, with its note if any, passing axe, and its language menu opens, shuts and changes the language, with no CSP refusal`,
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
            // The keyboard resizes the page, never pans over it (shyden-labs/ShyTalk#189).
            check.equal(await page.attribute('meta[name="viewport"]', 'content'), VIEWPORT);
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
          async () => {
            // The footer reaches support through its page, never an email address (shyden-labs/ShyTalk#37 AC3):
            // Playwright's getByRole('contentinfo').getByRole('link', { name }), as the footer's support link.
            check.equal(await page.text('footer a[data-support]'), t(locale, 'footer.contact'));
            check.equal(await page.attribute('footer a[data-support]', 'href'), localePath(locale, SUPPORT_PATH));
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
            // The page's own script reveals the note once it loads: waited for, as Playwright's toBeVisible() waits.
            check.ok(await visibleWithin(page, note), 'no visible note');
            check.equal(await page.text(note), t(locale, 'footer.englishOnly'));
          }
          // #171 AC4: the privacy page shows what an account keeps, in English and in Indonesian.
          if (doc === 'privacy') {
            const privacy = words.privacy as Record<string, string | undefined>;
            const shown = await page.text('main');
            for (const key of ACCOUNT_PRIVACY_KEYS)
              check.ok(privacy[key] !== undefined && shown.includes(privacy[key]), `no privacy.${key}`);
          }
          check.deepEqual(await page.axeViolations(), []);
          if (doc !== LEGAL_DOCS.at(-1)) {
            refusals.push(...(await page.cspRefusals()));
            await page.goto(`${prefix}/`);
          }
        }
        // The language menu (shyden-labs/ShyTalk#332), as the smoke: the phone's own width is its phone width.
        refusals.push(...(await page.cspRefusals()));
        await page.goto(`${prefix}/`);
        await softly([() => menuOpensAndShuts(page, check, locale)]);
        const narrow = await page.menuLive();
        check.ok(narrow.width < FULL_NAME_WIDTH, `the page is ${String(narrow.width)} wide, not under ${String(FULL_NAME_WIDTH)}`);
        check.deepEqual(narrow, wantedLive(locale, narrow.width, false), "the menu at a phone's width");
        await menuPicks(page, check, locale, localePath(nextLocale(locale), '/'));
        refusals.push(...(await page.cspRefusals()));
        check.deepEqual(refusals, []);
      },
    ),
    counted(`${lang}: an unknown page answers 404 in ${lang}, with no CSP refusal`, async (page, check) => {
      check.equal(await page.goto(`${prefix}/no-such-page`), 404);
      await inLanguageWithoutRefusal(page, check, lang);
    }),
    counted(
      `${lang}: the holding page shows ShyTalk's brand, the language menu and the hellos, in ${lang}, passing axe, keeping still for reduced motion and fitting a phone, its menu opening, shutting and changing the language, with no CSP refusal`,
      async (page, check) => {
        check.equal(await page.goto(`${prefix}/holding`), 200);
        check.equal(await page.attribute('html', 'lang'), lang);
        await menuOpensAndShuts(page, check, locale);
        check.ok(await page.isVisible(H1), 'no visible top heading');
        check.equal(await page.text(H1), 'ShyTalk');
        check.equal(await page.text('h1 span'), 'Talk');
        // Playwright's toBeVisible and toHaveText on each line.
        for (const [selector, key] of HOLDING_LINES) {
          check.ok(await page.isVisible(selector), `no visible ${selector}`);
          check.equal(await page.text(selector), t(locale, key), selector);
        }
        check.deepEqual(
          await page.rows('ul.hellos > li', ['lang']),
          HELLOS.map(({ lang: helloLang, word }) => [helloLang, word]),
        );
        check.deepEqual(await page.axeViolations(), []);
        const facts = await page.holdingFacts();
        check.deepEqual(facts, wantedFacts(facts.width, facts.reducedMotion));
        // The smoke turns reduced motion on and narrows the page to a phone's width. WebDriver can do neither in
        // Safari: reduced motion is the iPhone's own setting (Settings > Accessibility > Motion), and its width is the
        // phone's own. Each step is measured as the phone stands, so the hellos move or keep still as its setting asks.
        const still = await page.holdingFacts();
        check.deepEqual(still, wantedFacts(still.width, still.reducedMotion));
        const phone = await page.holdingFacts();
        check.ok(phone.width <= PHONE_WIDTH, `the page is ${String(phone.width)} wide, not a phone's`);
        check.deepEqual(phone, wantedFacts(phone.width, phone.reducedMotion));
        const narrow = await page.menuLive();
        check.deepEqual(narrow, wantedLive(locale, narrow.width, false), "the menu at a phone's width");
        // A tap's navigation keeps the console's refusals since the last goto, so this reads the picked page's too.
        await menuPicks(page, check, locale, `/${nextLocale(locale)}/`);
        check.deepEqual(await page.cspRefusals(), []);
      },
    ),
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
    counted(
      `${lang}: the support page shows its heading and lines, and embeds ShyDesk's contact piece in ${lang}, passes axe, with no CSP refusal`,
      async (page, check) => {
        check.equal(await page.goto(localePath(locale, SUPPORT_PATH)), 200);
        check.equal(await page.attribute('html', 'lang'), lang);
        check.equal(await page.text(H1), t(locale, 'support.title'));
        for (const line of ['intro', 'englishForm']) {
          const selector = `[data-line="${line}"]`;
          check.ok(await page.isVisible(selector), `${line} is not visible`);
          check.equal(await page.text(selector), t(locale, `support.${line}`));
        }
        for (const [name, wanted] of [
          ['product', 'shytalk'],
          ['view', 'contact'],
          ['lang', locale],
        ] as const) {
          check.equal(await page.attribute('shydesk-support', name), wanted);
        }
        check.equal(await page.attribute('script[src$="/embed.js"]', 'src'), `${builtShydeskOrigin()}/embed.js`);
        check.deepEqual(await page.axeViolations(), []);
        check.deepEqual(await page.cspRefusals(), []);
      },
    ),
    counted(
      `${lang}: every page carries its link preview and its language menu in ${lang}, each preview picture is 1200 by 630 and not one flat colour, and no page offers an email address`,
      async (page, check) => {
        const origin = builtSiteOrigin();
        await page.goto(`${prefix}/`);
        const checks: (() => Promise<void>)[] = [];
        for (const file of sitePages(PAGE_FILES, locale)) {
          const path = pageUrl('', pagePath(file));
          const facts = await page.previewFacts(path);
          checks.push(
            () => {
              check.ok(facts.title !== '', `${path}: no title`);
              return Promise.resolve();
            },
            () => {
              check.deepEqual(facts, wantedPreview(origin, locale, lang, path, facts.title), `${path}: the link preview`);
              return Promise.resolve();
            },
          );
        }
        await softly(checks);
      },
    ),
    counted(
      `${lang}: the roadmap page shows the board at once in ${lang}, its heading, a button named with its state for each milestone, the bar and when it was last read; a press opens that milestone's panel, Close shuts it, and Escape shuts it again; it passes axe and fits a phone's width, with no CSP refusal`,
      async (page, check) => {
        // The phone's own width is its phone width; it has no Escape key, so the same button tapped again shuts the
        // panel, as the page's own code does for a press.
        let facts: RoadmapFacts | undefined;
        const failures = await failuresOf([
          async () => {
            check.equal(await page.goto(`${prefix}/roadmap`), 200);
          },
          async () => {
            check.equal(await page.attribute('html', 'lang'), lang);
          },
          async () => {
            check.ok(await page.isVisible(H1), 'no visible top heading');
          },
          async () => {
            check.equal(await page.text(H1), t(locale, 'roadmap.heading'));
          },
          async () => {
            check.equal(await page.count(SPOT), MILESTONES);
          },
          async () => {
            facts = await page.roadmapFacts();
            const endings = stateEndings(locale);
            check.deepEqual(
              facts.labels.filter((label) => !endings.some((ending) => label.endsWith(ending))),
              [],
            );
          },
          async () => {
            check.match(await page.text('.bar-words'), linePattern(locale, 'roadmap.bar'));
          },
          async () => {
            check.equal(await page.text('#roadmap-updated'), updatedLine(facts?.readAt ?? '', pageWords(locale), locale, facts?.zone));
          },
          async () => {
            await page.tap(SPOT);
            check.equal(await page.attribute(SPOT, 'aria-expanded'), 'true');
          },
          async () => {
            check.ok(await page.isVisible(PANEL), 'the panel did not open');
          },
          async () => {
            check.equal(await page.text(`${PANEL} h2`), facts?.labels[0]?.split(', ')[0] ?? '(no label)');
          },
          async () => {
            check.equal(await page.text(`${PANEL} h3`), t(locale, 'roadmap.brings'));
          },
          async () => {
            check.deepEqual(await page.axeViolations(), []);
          },
          async () => {
            await page.tap(`${PANEL} button.close`);
            check.ok(!(await page.isVisible(PANEL)), 'the panel did not shut');
          },
          async () => {
            check.equal(await page.attribute(SPOT, 'aria-expanded'), 'false');
          },
          async () => {
            await page.tap(SPOT);
            check.ok(await page.isVisible(PANEL), 'the panel did not open again');
          },
          async () => {
            await page.tap(SPOT);
            check.ok(!(await page.isVisible(PANEL)), 'the panel did not shut again');
          },
          // In each colour mode (global rule 2026-11-25; shyden-labs/ShyTalk#362, #364): nothing lies over a bubble
          // or a label, no bubble lets what is under it show through, and every hello and label reads at 4.5:1.
          ...(['light', 'dark'] as const).flatMap((scheme) => {
            let drawing: RoadmapDrawing | undefined;
            return [
              async () => {
                await page.appearance(scheme);
                drawing = await page.roadmapDrawing();
                check.equal(drawing.scheme, scheme);
              },
              () => {
                check.deepEqual(drawing?.covered, [], `${scheme}: covered`);
                return Promise.resolve();
              },
              () => {
                check.deepEqual(drawing?.seeThrough, [], `${scheme}: see-through bubbles`);
                return Promise.resolve();
              },
              () => {
                check.deepEqual(drawing?.lowContrast, [], `${scheme}: under 4.5:1`);
                return Promise.resolve();
              },
            ];
          }),
          async () => {
            check.ok((await page.roadmapFacts()).fits, "the page does not fit the phone's width");
          },
          async () => {
            check.deepEqual(await page.cspRefusals(), []);
          },
        ]);
        check.deepEqual(failures, []);
      },
    ),
  ];
}

/** The roadmap page's first milestone button, and the one panel each opens (shyden-labs/ShyTalk#321). */
const SPOT = '.map button.spot';
const PANEL = '#roadmap-panel';

/** Asks `look` every quarter second for up to 10 s, as Playwright's assertions wait; answers what it last saw. */
async function within<T>(look: () => Promise<T>, done: (seen: T) => boolean, ends = Date.now() + 10_000): Promise<T> {
  const seen = await look();
  if (done(seen) || Date.now() >= ends) return seen;
  await new Promise((resolve) => setTimeout(resolve, 250));
  return within(look, done, ends);
}

/**
 * The roadmap's live board, once (tests/smoke/site.spec.ts, shyden-labs/ShyTalk#321 AC3): a signed delivery for the
 * board asks DEV's roadmap for a fresh read, as GitHub's webhook does, and the open page takes it with no reload. The
 * phone run gives DEV's webhook secret as SMOKE_ROADMAP_WEBHOOK_SECRET.
 */
const LIVE_ROADMAP: IphoneCase = counted('the roadmap page takes a fresh board read on its own, with no reload', async (page, check) => {
  await page.goto('/roadmap');
  check.equal(
    await within(
      async () => (await page.roadmapFacts()).socket,
      (socket) => socket === 'open',
    ),
    'open',
  );
  const before = (await page.roadmapFacts()).version;
  await page.markPage();
  const { body, headers } = boardDelivery(smokeWebhookSecret());
  const answer = await fetch(new URL('/hooks/github', process.env.PHONE_BASE_URL), { method: 'POST', body, headers });
  check.equal(answer.status, 202);
  check.deepEqual(await answer.json(), { state: 'reading' });
  const version = await within(
    async () => (await page.roadmapFacts()).version,
    (seen) => seen > before,
  );
  check.ok(version > before, 'no fresh read reached the page within 10 s');
  check.ok((await page.roadmapFacts()).marked, 'the page was reloaded');
  check.equal(await page.count(SPOT), MILESTONES);
});

/**
 * The one ticket page ShyDesk's emailed link opens (tests/smoke/site.spec.ts, shyden-labs/ShyTalk#37 AC1): it lands on
 * the ticket page of the language it shows, the emailed token still in the fragment, with the piece's ticket view.
 */
const TICKET_PAGE: IphoneCase = counted(
  'the ticket page opens the ticket view in the browser’s language, keeping the emailed token, which its language menu keeps, English staying English, passes axe, with no CSP refusal',
  async (page, check) => {
    check.equal(await page.goto(`${TICKET_PATH}#t=${SMOKE_TICKET_TOKEN}`), 200);
    check.equal(await page.count('shydesk-support[view="ticket"]'), 1);
    const shown = await page.attribute('html', 'lang');
    const locale = LOCALES.find((each) => langTag(each) === shown) ?? 'en';
    const address = new URL(await page.url());
    check.equal(`${address.pathname}${address.hash}`, `${localePath(locale, TICKET_PATH)}#t=${SMOKE_TICKET_TOKEN}`);
    check.equal(await page.text(H1), t(locale, 'support.ticketTitle'));
    check.equal(await page.attribute('shydesk-support', 'product'), 'shytalk');
    check.equal(await page.attribute('shydesk-support', 'lang'), locale);
    await menuKeepsToken(page, check, locale, TICKET_PATH, `#t=${SMOKE_TICKET_TOKEN}`, 'ticket');
    check.deepEqual(await page.axeViolations(), []);
    check.deepEqual(await page.cspRefusals(), []);
  },
);

/**
 * The one appeal page a punishment notice links to (tests/smoke/site.spec.ts, shyden-labs/ShyTalk#310 AC4): it lands on
 * the appeal page of the language it shows, the notice's token still in the fragment, with the piece's appeal view.
 */
const APPEAL_PAGE: IphoneCase = counted(
  'the appeal page opens the appeal view in the browser’s language, keeping the notice’s token, which its language menu keeps, English staying English, passes axe, with no CSP refusal',
  async (page, check) => {
    check.equal(await page.goto(`${APPEAL_PATH}#appeal=${SMOKE_APPEAL_TOKEN}`), 200);
    check.equal(await page.count('shydesk-support[view="appeal"]'), 1);
    const shown = await page.attribute('html', 'lang');
    const locale = LOCALES.find((each) => langTag(each) === shown) ?? 'en';
    const address = new URL(await page.url());
    check.equal(`${address.pathname}${address.hash}`, `${localePath(locale, APPEAL_PATH)}#appeal=${SMOKE_APPEAL_TOKEN}`);
    check.equal(await page.text(H1), t(locale, 'support.appealTitle'));
    for (const line of ['appealIntro', 'englishForm']) {
      const selector = `[data-line="${line}"]`;
      check.ok(await page.isVisible(selector), `${line} is not visible`);
      check.equal(await page.text(selector), t(locale, `support.${line}`));
    }
    check.equal(await page.attribute('shydesk-support', 'product'), 'shytalk');
    check.equal(await page.attribute('shydesk-support', 'lang'), locale);
    check.equal(await page.attribute('script[src$="/embed.js"]', 'src'), `${builtShydeskOrigin()}/embed.js`);
    await menuKeepsToken(page, check, locale, APPEAL_PATH, `#appeal=${SMOKE_APPEAL_TOKEN}`, 'appeal');
    check.deepEqual(await page.axeViolations(), []);
    check.deepEqual(await page.cspRefusals(), []);
  },
);

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

  const { subject, confirmLink } = await waitForMail(tag, { password: envMailboxPassword() });
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
 * in with the app's next code; the sign-up and recovery pages saying signed in
 * (#213); and a recovery, seen after signing in with a saved recovery code.
 */
const SIGN_UP_JOURNEY: IphoneCase = counted(
  'joining with the mailed code and an authenticator app, then signing back in with it',
  async (page, check) => {
    const tag = `iphone-air-${String(Date.now())}`;
    const address = plusAddress(tag);
    await page.goto('/sign-up');
    // The form shows once the page has asked whether it is signed in (#213): 0 typed on both phones before this wait.
    check.ok(await visibleWithin(page, '#email-address'), 'no visible sign-up form');
    await page.type('#email-address', address);
    await page.tap('#email-submit');
    await check.waitForText(page, '#email-answer', t('en', 'account.sent'));
    check.ok(await page.isVisible('#email-answer'), 'no visible answer');
    const codeMail = await waitForAnyMail(tag, { password: envMailboxPassword() });
    check.equal(codeMail.subject, t('en', 'email.codeSubject'));
    await page.type('#email-code', codeIn(codeMail));
    await page.tap('#code-submit');
    await check.waitForText(page, '#email-answer', t('en', 'account.signUpConfirmed'));
    check.equal(await page.isVisible('#email-address'), false, 'the address form stays after the code was accepted');

    await page.tap('#setup-authenticator');
    // As Playwright's toBeVisible() waits: the key shows once the page's setup fetch answers (1.1 s on the iPhone Air,
    // 2026-11-14, shyden-labs/ShyTalk#190).
    check.ok(await visibleWithin(page, '[data-testid="totp-secret"]'), 'no visible authenticator key');
    const secret = base32(await page.text('[data-testid="totp-secret"]'));
    await page.type('#totp-code', await totpAt(secret, 0));
    await page.tap('#totp-confirm');
    // The codes show once the confirm answers; their hidden heading already holds its text, so the wait is on the
    // codes themselves, as Playwright's count on a locator waits (shyden-labs/ShyTalk#190). Not a check, so not counted.
    const codes = await countWithin(page, CODES);
    check.equal(codes, 10, `ten recovery codes, not ${String(codes)}`);
    const savedCode = await page.text(CODES);
    check.match(savedCode, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    await page.tap('#codes-saved');

    await check.waitForText(page, H1, t('en', 'account.accountTitle'));
    // The account page fills in its methods after its heading shows: read '' on the iPhone Air (#190 run 8).
    await check.waitForText(page, '[data-testid="method-authenticator"]', t('en', 'account.authenticatorOn'));
    // The device list fills in after the methods: read 0 straight after On (#190 run 11); toHaveCount waits too.
    const devices = await countWithin(page, DEVICES);
    check.equal(devices, 1, `one signed-in device, not ${String(devices)}`);
    await page.tap('#sign-out');
    await page.waitForText(H1, t('en', 'account.signInTitle'));
    await page.type('#signin-email', address);
    await page.type('#signin-code', await totpAt(secret, 1));
    await page.tap('#signin-submit');
    await check.waitForText(page, H1, t('en', 'account.accountTitle'));
    check.equal(await page.isVisible(NOTICE), false, 'a recovery notice before any recovery started');

    // Signed in, the sign-up and recovery pages say so and offer Sign out before anything else
    // (as tests/smoke/site.spec.ts does; shyden-labs/ShyTalk#213).
    // The line is in the page from the start, hidden: it shows once the page has asked whether it is signed in
    // (run 4, 2026-11-16: its text was there while it was still hidden on the recovery page).
    await page.goto('/sign-up');
    await check.waitForText(page, SIGNED_IN, t('en', 'account.signedInFirst'));
    check.ok(await visibleWithin(page, SIGNED_IN), 'no visible signed-in line on the sign-up page');
    check.equal(await page.isVisible('#email-address'), false, 'the sign-up form shows while signed in');
    await page.goto('/recover');
    await check.waitForText(page, SIGNED_IN, t('en', 'account.signedInFirst'));
    check.ok(await visibleWithin(page, SIGNED_IN), 'no visible signed-in line on the recovery page');
    check.equal(await page.isVisible('#email-address'), false, 'the recovery form shows while signed in');
    await page.tap('#signed-in-sign-out');
    check.ok(await visibleWithin(page, '#email-address'), 'no visible recovery form after signing out');
    check.equal(await page.isVisible(SIGNED_IN), false, 'the signed-in line stays after signing out');

    // A recovery started for this address shows on a signed-in device, which cancels it there
    // (as tests/smoke/site.spec.ts does; shyden-labs/ShyTalk#133 AC3, #180).
    const signUpCode = codeIn(codeMail);
    await page.type('#email-address', address);
    await page.tap('#email-submit');
    await check.waitForText(page, '#email-answer', t('en', 'account.sent'));
    // The mailbox answers only its newest mail: wait for the recovery code to replace the sign-up one.
    // Real mail took 48 s (2026-11-13): wait as long as the mail reader does (shyden-labs/ShyTalk#185).
    const recoveryCode = await check.poll(() =>
      waitFor(
        'the recovery code mail',
        async () => {
          const code = codeIn(await waitForAnyMail(tag, { password: envMailboxPassword() }));
          return code === signUpCode ? null : code;
        },
        MAIL_CEILING_MS,
      ),
    );
    await page.type('#email-code', recoveryCode);
    await page.tap('#code-submit');
    const started = matching(t('en', 'account.recoveryStarted'), '{completesAt}');
    await check.poll(() =>
      waitFor('the recovery-started answer', async () => (started.test(await page.text('#email-answer')) ? true : null)),
    );

    // Signing back in with a recovery code: the authenticator's next steps may not have come round yet.
    await page.goto('/sign-in');
    await page.tap('#use-recovery-code');
    await page.type('#signin-email', address);
    await page.type('#signin-recovery-code', savedCode);
    await page.tap('#signin-recovery-submit');
    // A recovery code's sign-in says how many are left before going on: ten were made, one is now used.
    await check.waitForText(page, '#signin-answer', t('en', 'account.codesLeftAfterSignIn').replace('{count}', '9'));
    await page.tap('#signin-continue a');
    await check.waitForText(page, H1, t('en', 'account.accountTitle'));
    await check.poll(() => waitFor('the recovery notice', async () => ((await page.isVisible(NOTICE)) ? true : null)));
    check.match(await page.text('#recovery-pending-text'), matching(t('en', 'account.recoveryPending'), '{startedAt}'));
    await page.tap('#recovery-cancel');
    await check.poll(() => waitFor('the recovery notice to hide', async () => ((await page.isVisible(NOTICE)) ? null : true)));
  },
);

const NOTICE = '#recovery-pending';
const SIGNED_IN = '[data-testid="signed-in"]';
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
async function waitFor<T>(what: string, look: () => Promise<T | null>, ceilingMs = WAIT_CEILING_MS): Promise<T> {
  const started = Date.now();
  for (;;) {
    const found = await look();
    if (found !== null) return found;
    if (Date.now() - started >= ceilingMs) throw new Error(`waited ${String(ceilingMs / 1000)} s for ${what}`);
    await new Promise<void>((done) => setTimeout(done, WAIT_EVERY_MS));
  }
}

const SHOWN_CEILING_MS = 15_000;
const SHOWN_EVERY_MS = 250;

/** Whether `selector` is shown within the ceiling, looked at every quarter second. */
async function visibleWithin(page: SafariPage, selector: string): Promise<boolean> {
  const started = Date.now();
  for (;;) {
    if (await page.isVisible(selector)) return true;
    if (Date.now() - started >= SHOWN_CEILING_MS) return false;
    await new Promise<void>((done) => setTimeout(done, SHOWN_EVERY_MS));
  }
}

/** The page's path and query once they read `href`, looked at every quarter second up to the ceiling; else the last read. */
async function pathWithin(page: SafariPage, href: string): Promise<string> {
  const started = Date.now();
  for (;;) {
    const url = new URL(await page.url());
    const path = `${url.pathname}${url.search}`;
    if (path === href || Date.now() - started >= SHOWN_CEILING_MS) return path;
    await new Promise<void>((done) => setTimeout(done, SHOWN_EVERY_MS));
  }
}

/** The address's path and fragment once it is `want`, looked at every quarter second up to the ceiling; the last seen otherwise. */
async function addressWithin(page: SafariPage, want: string): Promise<string> {
  const started = Date.now();
  for (;;) {
    const url = new URL(await page.url());
    const address = `${url.pathname}${url.hash}`;
    if (address === want || Date.now() - started >= SHOWN_CEILING_MS) return address;
    await new Promise<void>((done) => setTimeout(done, SHOWN_EVERY_MS));
  }
}

/** How many elements match `selector` once any do, looked at every quarter second up to the ceiling; 0 if none. */
async function countWithin(page: SafariPage, selector: string): Promise<number> {
  const started = Date.now();
  for (;;) {
    const found = await page.count(selector);
    if (found > 0 || Date.now() - started >= SHOWN_CEILING_MS) return found;
    await new Promise<void>((done) => setTimeout(done, SHOWN_EVERY_MS));
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
    // The form shows once the page has asked whether it is signed in (#213).
    check.ok(await visibleWithin(page, '#email-address'), 'no visible recovery form');
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
  LIVE_ROADMAP,
  TICKET_PAGE,
  APPEAL_PAGE,
  JOURNEY,
  SIGN_UP_JOURNEY,
  RECOVERY_PAGES,
];
