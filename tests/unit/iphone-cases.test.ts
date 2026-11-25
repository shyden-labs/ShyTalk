import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { IPHONE_CASES, type SafariPage } from '../phones/iphone-cases.ts';
import { countingCheck } from '../phones/check.ts';
import { langTag, localePath, t, type Locale } from '../../apps/web/src/i18n/t.ts';
import { nextLocale, wantedLive } from '../support/language-menu.ts';
import { APPEAL_PATH, SUPPORT_PATH, TICKET_PATH } from '../../apps/web/src/support.ts';
import { SMOKE_APPEAL_TOKEN, SMOKE_TICKET_TOKEN } from '../support/support-page.ts';
import { HELLOS } from '../../apps/web/src/brand.ts';
import { wantedFacts } from '../support/holding-facts.ts';
import { legalLines, legalLocale } from '../../apps/web/src/legal/legal.ts';
import { pagePath, pageUrl, sitePages } from '../../apps/web/src/preview.ts';
import { PAGE_FILES, wantedPreview } from '../support/link-preview.ts';
import { MILESTONES, boardDelivery, type RoadmapFacts } from '../support/roadmap-page.ts';
import { updatedLine } from '../../apps/web/src/roadmap/view.ts';
import { pageWords } from '../../apps/web/src/roadmap/words.ts';

/**
 * Each case of the iPhone copy checks what its Playwright twin checks
 * (shyden-labs/ShyTalk#112): here Safari is a stand-in page that behaves as
 * the site should, and each test breaks one thing a case must catch.
 */

// The real test mailbox is stood in: a unit test reaches no IMAP server.
const mailbox = vi.hoisted(() => ({
  // The real reader's ceiling (tests/phones/test-mailbox.ts), which the recovery mail wait uses (shyden-labs/ShyTalk#185).
  MAIL_CEILING_MS: 120_000,
  plusAddress: vi.fn((tag: string) => `box+${tag}@mail.test`),
  waitForMail: vi.fn<(tag: string, deps: { password: string }) => Promise<{ subject: string; text: string; confirmLink: string }>>(() =>
    Promise.resolve({ subject: 'subject', text: 'body', confirmLink: 'https://dev.example/closed-testing/confirm?t=abc' }),
  ),
  waitForAnyMail: vi.fn<(tag: string, deps: { password: string }) => Promise<{ subject: string; text: string }>>(() =>
    Promise.resolve({ subject: 'subject', text: 'code 000000' }),
  ),
  codeIn: vi.fn((mail: { text: string }) => /\b\d{6}\b/.exec(mail.text)?.[0] ?? ''),
}));
// The password helper stays real, so each test sets the variable it reads.
vi.mock('../phones/test-mailbox.ts', async (original) => ({
  envMailboxPassword: (await original<typeof import('../phones/test-mailbox.ts')>()).envMailboxPassword,
  ...mailbox,
}));

// The authenticator's code is stood in: the real one awaits WebCrypto outside fake time, so a journey's waits on fake
// time could start after the test had moved its clock on (a race seen on CI, shyden-labs/ShyTalk#180).
vi.mock('../support/totp.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../support/totp.ts')>()),
  totpAt: vi.fn(() => Promise.resolve('123456')),
}));

const LOCALE: Record<string, Locale> = { en: 'en', id: 'id', th: 'th', vi: 'vi', 'zh-Hans': 'zh' };
const PREFIX: Record<string, string> = { en: '', id: '/id', th: '/th', vi: '/vi', 'zh-Hans': '/zh' };

/** The holding page's lines, by selector (shyden-labs/ShyTalk#273). */
const HOLDING_TEXT: Record<string, (locale: Locale) => string> = {
  'h1, [role="heading"][aria-level="1"]': () => 'ShyTalk',
  'h1 span': () => 'Talk',
  'p.badge': (locale) => t(locale, 'holding.comingSoon'),
  'p.tagline': (locale) => t(locale, 'site.tagline'),
};

/** What each selector holds on the site as it should be; `holding` while the holding page is open. */
function selectorText(locale: Locale, selector: string, holding = false): string {
  const line = holding ? HOLDING_TEXT[selector] : undefined;
  if (line !== undefined) return line(locale);
  const statement = /data-line="(\w+)"/.exec(selector)?.[1];
  if (statement !== undefined) return t(locale, `closedTesting.${statement}`);
  if (selector === 'label[for="apply-email"]') return t(locale, 'closedTesting.emailLabel');
  if (selector === 'label[for="apply-adult"]') return t(locale, 'closedTesting.adultLabel');
  if (selector === '#apply-submit') return t(locale, 'closedTesting.submit');
  if (selector === '#confirm-button') return t(locale, 'closedTesting.confirmButton');
  if (selector === '[data-governs]') return legalLines(legalLocale(locale)).common.governs;
  if (selector.startsWith('[data-english-only')) return t(locale, 'footer.englishOnly');
  if (selector === 'main') return Object.values(legalLines(legalLocale(locale)).privacy).join(' ');
  return t(locale, 'home.heading');
}

/** The viewport tag every page carries: the keyboard resizes the page, never pans over it (shyden-labs/ShyTalk#189). */
const VIEWPORT_TAG = 'meta[name="viewport"]';
const VIEWPORT = 'width=device-width, initial-scale=1, interactive-widget=resizes-content';

/** The origin the site is built for in these tests, from the Worker's settings: SITE_ENVIRONMENT is dev (set below). */
const DEV = (JSON.parse(readFileSync('workers/web/wrangler.json', 'utf8')) as { env: { dev: { vars: { SITE_ORIGIN: string } } } }).env.dev
  .vars.SITE_ORIGIN;

/** The footer's support link (shyden-labs/ShyTalk#37 AC3). */
const SUPPORT_LINK = 'footer a[data-support]';

/** The ShyDesk the dev build embeds, from the Worker's settings (shyden-labs/ShyTalk#37). */
const SHYDESK = (JSON.parse(readFileSync('workers/web/wrangler.json', 'utf8')) as { env: { dev: { vars: { SHYDESK_ORIGIN: string } } } })
  .env.dev.vars.SHYDESK_ORIGIN;

/** The roadmap page's milestone buttons and its one panel (shyden-labs/ShyTalk#321). */
const ROADMAP_BUTTON = '.map button.spot';
const ROADMAP_PANEL = '#roadmap-panel';
const ROADMAP_H1 = 'h1, [role="heading"][aria-level="1"]';
const READ_AT = '2026-11-24T23:49:00.000Z';

/** The roadmap page as an iPhone in Jakarta reads it: eleven milestones, the first done, the board read once. */
function roadmapFacts(locale: Locale, over: Partial<RoadmapFacts> = {}): RoadmapFacts {
  const labels = Array.from({ length: MILESTONES }, (_, index) =>
    index === 0
      ? `Groundwork, ${t(locale, 'roadmap.labelDone')}`
      : `Milestone ${String(index + 1)}, ${t(locale, 'roadmap.labelNotStarted')}`,
  );
  return { labels, readAt: READ_AT, zone: 'Asia/Jakarta', fits: true, version: 1, socket: 'open', marked: false, ...over };
}

/** The roadmap page's lines, by selector, as the page words them (shyden-labs/ShyTalk#321). */
const ROADMAP_TEXT: Record<string, (locale: Locale) => string> = {
  'h1, [role="heading"][aria-level="1"]': (locale) => t(locale, 'roadmap.heading'),
  '.bar-words': (locale) => t(locale, 'roadmap.bar').replace('{percent}', '57'),
  '#roadmap-updated': (locale) => updatedLine(READ_AT, pageWords(locale), locale, 'Asia/Jakarta'),
  '#roadmap-panel h3': () => 'Groundwork',
  '#roadmap-panel h4': (locale) => t(locale, 'roadmap.brings'),
};

/** Safari showing the site as it should be, in `lang`; `broken` replaces one answer. */
function safari(lang: string, broken: Partial<SafariPage> = {}): SafariPage & { visited: string[] } {
  const locale = LOCALE[lang] ?? 'en';
  const visited: string[] = [];
  let onLegalPage = false;
  // The language menu (shyden-labs/ShyTalk#332): a tap on its button opens or shuts it, a tap on a language opens the
  // same page in that language, which the address and `<html lang>` then show.
  let menuOpen = false;
  let picked: { path: string; lang: string } | null = null;
  // The roadmap page (shyden-labs/ShyTalk#321): a tap on a milestone opens its panel, again or on Close shuts it.
  let panelOpen = false;
  let marked = false;
  const onRoadmap = (): boolean => visited.at(-1)?.endsWith('/roadmap') === true;
  return {
    visited,
    goto: (path) => {
      visited.push(path);
      menuOpen = false;
      panelOpen = false;
      marked = false;
      picked = null;
      return Promise.resolve(path.endsWith('/no-such-page') ? 404 : 200);
    },
    freshStart: () => Promise.resolve(),
    url: () => Promise.resolve(`${DEV}${picked?.path ?? visited.at(-1) ?? '/'}`),
    cspRefusals: () => Promise.resolve([]),
    attribute: (selector, name) =>
      Promise.resolve(
        selector === 'html' && name === 'lang'
          ? picked !== null
            ? picked.lang
            : onLegalPage
              ? legalLocale(locale)
              : lang
          : selector === VIEWPORT_TAG && name === 'content'
            ? VIEWPORT
            : selector === 'footer a[data-support]' && name === 'href'
              ? localePath(locale, SUPPORT_PATH)
              : selector === 'shydesk-support'
                ? ((
                    {
                      product: 'shytalk',
                      view:
                        visited.at(-1)?.includes('/ticket') === true
                          ? 'ticket'
                          : visited.at(-1)?.includes('/appeal') === true
                            ? 'appeal'
                            : 'contact',
                      lang: locale,
                    } as Record<string, string>
                  )[name] ?? null)
                : selector === 'script[src$="/embed.js"]' && name === 'src'
                  ? `${SHYDESK}/embed.js`
                  : selector === ROADMAP_BUTTON && name === 'aria-expanded'
                    ? String(panelOpen)
                    : null,
      ),
    isVisible: (selector) => Promise.resolve(selector === ROADMAP_PANEL ? panelOpen : selector !== '[data-english-only]:not([hidden])'),
    text: (selector) => {
      const at = visited.at(-1) ?? '';
      if (selector === 'footer a[data-support]') return Promise.resolve(t(locale, 'footer.contact'));
      if (onRoadmap()) {
        const roadmapText = ROADMAP_TEXT[selector];
        if (roadmapText !== undefined) return Promise.resolve(roadmapText(locale));
      }
      if (at.includes('/support') || at.includes('/appeal')) {
        const line = /data-line="(\w+)"/.exec(selector)?.[1];
        const title = at.includes('/ticket') ? 'support.ticketTitle' : at.includes('/appeal') ? 'support.appealTitle' : 'support.title';
        return Promise.resolve(t(locale, line === undefined ? title : `support.${line}`));
      }
      return Promise.resolve(selectorText(locale, selector, at.endsWith('/holding')));
    },
    rows: (selector) => Promise.resolve(selector === 'ul.hellos > li' ? HELLOS.map(({ lang: helloLang, word }) => [helloLang, word]) : []),
    holdingFacts: () => Promise.resolve(wantedFacts(420, false)),
    roadmapFacts: () => Promise.resolve(roadmapFacts(locale, { marked })),
    markPage: () => {
      marked = true;
      return Promise.resolve();
    },
    menuLive: () => Promise.resolve(wantedLive(locale, 420, menuOpen)),
    tap: (selector) => {
      if (selector === ROADMAP_BUTTON) {
        panelOpen = !panelOpen;
      } else if (selector === `${ROADMAP_PANEL} button.close`) {
        panelOpen = false;
      } else if (selector === 'details.lang-switch > summary') {
        menuOpen = !menuOpen;
      } else if (selector.startsWith('details.lang-switch a.entry')) {
        const next = nextLocale(locale);
        const holding = visited.at(-1)?.endsWith('/holding') === true;
        if (menuOpen) picked = { path: holding ? `/${next}/` : localePath(next, '/'), lang: langTag(next) };
        menuOpen = false;
      } else {
        onLegalPage = true;
      }
      return Promise.resolve();
    },
    type: () => Promise.resolve(),
    waitForText: () => Promise.resolve(),
    visibleLinks: (name) => Promise.resolve(name === t(locale, 'home.apply') ? 1 : 0),
    links: (name) => Promise.resolve(name === t(locale, 'home.apply') ? 1 : 0),
    count: (selector) =>
      Promise.resolve(
        selector === ROADMAP_BUTTON && onRoadmap()
          ? MILESTONES
          : (selector === 'shydesk-support[view="ticket"]' && visited.at(-1)?.includes('/ticket') === true) ||
              (selector === 'shydesk-support[view="appeal"]' && visited.at(-1)?.includes('/appeal') === true)
            ? 1
            : 0,
      ),
    axeViolations: () => Promise.resolve([]),
    previewFacts: (path) => Promise.resolve(wantedPreview(DEV, locale, lang, path, `${path} · ShyTalk`)),
    ...broken,
  };
}

const kind = (title: string): string => title.replace(/^[^:]+: /, '').split(' in ')[0] ?? '';
const langOf = (title: string): string => title.split(':')[0] ?? '';
const cases = (start: string) => IPHONE_CASES.filter(({ title }) => kind(title).startsWith(start));

/**
 * The checks each test's Playwright twin ran on CI, per test (shyden-labs/ShyTalk#180 AC7):
 * read from smoke-totals on PR #181's web-smoke job, the same on chromium, firefox and webkit.
 * The home page runs three more where its legal pages carry the "English only" note, and
 * 22 more on the privacy page for what an account keeps (#171), read from this PR's smoke-totals.
 */
const CI_ASSERTIONS: Record<string, Record<string, number>> = {
  // Two more for the footer's support link (shyden-labs/ShyTalk#37 AC3): counted, to be confirmed on CI's smoke-totals.
  // Eight more for the language menu (shyden-labs/ShyTalk#332): shut, opened, axe, shut, the width and the menu at a
  // phone's width, the picked page and its language; counted from its Playwright twin, to be confirmed on CI.
  'the home page answers 200': { en: 60, id: 60, th: 63, vi: 63, 'zh-Hans': 63 },
  // The support page (#37 AC1): counted from its Playwright twin, to be confirmed on CI's smoke-totals.
  "the support page shows its heading and lines, and embeds ShyDesk's contact piece": { en: 13, id: 13, th: 13, vi: 13, 'zh-Hans': 13 },
  'an unknown page answers 404': { en: 4, id: 4, th: 4, vi: 4, 'zh-Hans': 4 },
  'the closed-testing page shows the form and every statement': { en: 17, id: 17, th: 17, vi: 17, 'zh-Hans': 17 },
  'the confirm page passes axe, and its button with a dead link shows link-expired': { en: 4, id: 4, th: 4, vi: 4, 'zh-Hans': 4 },
  // Counted from its Playwright twin's 18 checks (shyden-labs/ShyTalk#273, less the contact's two, #333); confirmed against CI's smoke-totals.
  // The language menu (shyden-labs/ShyTalk#332) replaces the switch's two with seven: shut, opened, axe, shut, at a
  // phone's width, the picked page and its language; to be confirmed on CI.
  "the holding page shows ShyTalk's brand, the language menu and the hellos,": {
    en: 23,
    id: 23,
    th: 23,
    vi: 23,
    'zh-Hans': 23,
  },
  // Two per page: its title is not empty, and its preview is as wanted (shyden-labs/ShyTalk#198).
  // Four more each for the support and ticket pages (#37), to be confirmed on CI's smoke-totals.
  // Two more each for the appeal page (#310 AC4), to be confirmed on CI's smoke-totals.
  // Two more each for the roadmap page (#321 AC3), to be confirmed on CI's smoke-totals.
  'every page carries its link preview and its language menu': { en: 38, id: 38, th: 32, vi: 32, 'zh-Hans': 32 },
  // The roadmap page (shyden-labs/ShyTalk#321 AC3): its Playwright twin's 20 checks, counted from it; to be confirmed on
  // CI's smoke-totals.
  'the roadmap page shows the board at once': { en: 20, id: 20, th: 20, vi: 20, 'zh-Hans': 20 },
};

describe('the iPhone cases', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_ENVIRONMENT', 'dev');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(IPHONE_CASES.filter(({ title }) => langOf(title) in LOCALE).map((c) => [c.title, c] as const))(
    '%s: passes on the site as it should be, running as many checks as its twin on CI',
    async (_, c) => {
      const page = safari(langOf(c.title));
      const check = countingCheck();
      await expect(c.run(page, check)).resolves.toBeUndefined();
      expect(page.visited[0]?.startsWith(PREFIX[langOf(c.title)] ?? '?')).toBe(true);
      expect(check.count).toBe(CI_ASSERTIONS[kind(c.title)]?.[langOf(c.title)]);
    },
  );

  it.each(cases('the home page answers').map((c) => [c.title, c] as const))('%s: fails on anything but 200', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { goto: () => Promise.resolve(500) }))).rejects.toThrow();
  });

  it.each(cases('an unknown page').map((c) => [c.title, c] as const))(
    '%s: fails on anything but 404, and asks for the unknown page',
    async (_, c) => {
      const page = safari(langOf(c.title));
      await c.run(page);
      expect(page.visited).toEqual([`${PREFIX[langOf(c.title)] ?? '?'}/no-such-page`]);
      await expect(c.run(safari(langOf(c.title), { goto: () => Promise.resolve(200) }))).rejects.toThrow();
    },
  );

  it.each([...cases('the home page answers'), ...cases('an unknown page')].map((c) => [c.title, c] as const))(
    '%s: fails on the wrong language, a hidden navigation or a CSP refusal',
    async (_, c) => {
      const lang = langOf(c.title);
      await expect(c.run(safari(lang, { attribute: () => Promise.resolve('fr') }))).rejects.toThrow();
      await expect(c.run(safari(lang, { isVisible: () => Promise.resolve(false) }))).rejects.toThrow();
      await expect(c.run(safari(lang, { cspRefusals: () => Promise.resolve(['Refused to load x']) }))).rejects.toThrow();
    },
  );

  it.each(cases('the home page answers').map((c) => [c.title, c] as const))(
    '%s: fails on a hidden or wrong heading, a hidden apply link or a roadmap link',
    async (_, c) => {
      const lang = langOf(c.title);
      const roadmap = t(LOCALE[lang] ?? 'en', 'home.roadmap');
      await expect(c.run(safari(lang, { isVisible: (selector) => Promise.resolve(selector.startsWith('nav')) }))).rejects.toThrow(
        'no visible top heading',
      );
      await expect(c.run(safari(lang, { text: () => Promise.resolve('Something else') }))).rejects.toThrow('Something else');
      await expect(c.run(safari(lang, { visibleLinks: () => Promise.resolve(0) }))).rejects.toThrow('no visible apply link');
      // #171 AC4: a privacy page missing what an account keeps fails, naming the line.
      const page = safari(lang);
      const shown = page.text.bind(page);
      await expect(
        c.run(safari(lang, { text: (selector) => (selector === 'main' ? Promise.resolve('the form only') : shown(selector)) })),
      ).rejects.toThrow('no privacy.accountH');
      await expect(c.run(safari(lang, { links: (name) => Promise.resolve(name === roadmap ? 1 : 0) }))).rejects.toThrow();
    },
  );

  it.each(cases('the home page answers').map((c) => [c.title, c] as const))('%s: fails on any axe violation', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { axeViolations: () => Promise.resolve(['color-contrast: 1']) }))).rejects.toThrow(
      'color-contrast: 1',
    );
  });

  // One journey, all its assertions (Shyden 2026-11-09, shyden-labs/ShyTalk#151, #180): the home page is opened for its
  // checks, then again only to reach the next footer legal link in this language (a legal page in a language without
  // its own text has an English footer), never after the last; every check runs even after one fails.
  it.each(cases('the home page answers').map((c) => [c.title, c] as const))(
    '%s: opens the home page once for its checks and once before each later legal link, and names every failing check, not only the first',
    async (_, c) => {
      const lang = langOf(c.title);
      const page = safari(lang);
      await c.run(page);
      const home = `${PREFIX[lang] ?? '?'}/`;
      // Then once more for the language menu, which picks the next language with taps (shyden-labs/ShyTalk#332).
      expect(page.visited).toEqual([home, home, home, home]);
      const broken = c.run(safari(lang, { goto: () => Promise.resolve(500), axeViolations: () => Promise.resolve(['color-contrast: 1']) }));
      await expect(broken).rejects.toThrow(/500[\s\S]*color-contrast: 1/);
    },
  );

  it('gives the reason of a soft check that fails with something other than an Error, and still runs the rest', async () => {
    const [c] = cases('the home page answers');
    // A WebDriver client may reject with a bare string; the soft checks still name it, and still run every check after it.
    const broken = c?.run(
      safari('en', {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point: a WebDriver client rejecting with a bare string
        attribute: () => Promise.reject('the session went away'),
        axeViolations: () => Promise.resolve(['color-contrast: 1']),
      }),
    );
    await expect(broken).rejects.toThrow(/the session went away[\s\S]*color-contrast: 1/);
  });

  it.each(cases('the home page answers').map((c) => [c.title, c] as const))(
    '%s: fails on a CSP refusal on any page it opened, though each goto starts the console afresh',
    async (_, c) => {
      // Safari's console as Appium reads it: a goto starts it afresh. The refusal comes on the first legal page only.
      let logged: string[] = [];
      let taps = 0;
      const site = safari(langOf(c.title));
      const page = safari(langOf(c.title), {
        goto: () => ((logged = []), Promise.resolve(200)),
        // The site's own tap, which opens the legal page, then the refusal on the first.
        tap: async (selector) => {
          await site.tap(selector);
          taps += 1;
          if (taps === 1) logged = ['Refused to load x'];
        },
        attribute: (selector, name) => site.attribute(selector, name),
        menuLive: () => site.menuLive(),
        url: () => site.url(),
        cspRefusals: () => Promise.resolve(logged),
      });
      await expect(c.run(page)).rejects.toThrow('Refused to load x');
    },
  );

  const named = (start: string) => cases(start).map((c) => [c.title, c] as const);

  it('holds both closed-testing cases in every language', () => {
    expect(named('the closed-testing page shows')).toHaveLength(5);
    expect(named('the confirm page')).toHaveLength(5);
  });

  it.each(named('the closed-testing page shows'))('%s: fails on anything but 200', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { goto: () => Promise.resolve(404) }))).rejects.toThrow();
  });

  it.each(named('the closed-testing page shows'))('%s: fails when a statement is hidden', async (_, c) => {
    const hidden = (selector: string): Promise<boolean> => Promise.resolve(!selector.includes('retention'));
    await expect(c.run(safari(langOf(c.title), { isVisible: hidden }))).rejects.toThrow('retention');
  });

  it.each(named('the closed-testing page shows'))('%s: fails naming the box when its label holds other words', async (_, c) => {
    const locale = LOCALE[langOf(c.title)] ?? 'en';
    const text = (selector: string) =>
      Promise.resolve(selector === 'label[for="apply-adult"]' ? 'other words' : selectorText(locale, selector));
    await expect(c.run(safari(langOf(c.title), { text }))).rejects.toThrow('no visible #apply-adult');
  });

  it.each(named('the confirm page'))('%s: fails naming the button when it holds another name, before tapping it', async (_, c) => {
    const locale = LOCALE[langOf(c.title)] ?? 'en';
    const taps: string[] = [];
    const page = safari(langOf(c.title), {
      text: (selector) => Promise.resolve(selector === '#confirm-button' ? 'Other' : selectorText(locale, selector)),
      tap: (selector) => (taps.push(selector), Promise.resolve()),
    });
    await expect(c.run(page)).rejects.toThrow('#confirm-button is named "Other"');
    expect(taps).toEqual([]);
  });

  it.each(named('the closed-testing page shows'))('%s: fails when a statement holds other words', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { text: () => Promise.resolve('other words') }))).rejects.toThrow();
  });

  it.each(named('the closed-testing page shows'))('%s: fails on a CSP refusal', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { cspRefusals: () => Promise.resolve(['refused']) }))).rejects.toThrow();
  });

  it.each(named('the closed-testing page shows'))('%s: fails on any axe violation', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { axeViolations: () => Promise.resolve(['label: 1']) }))).rejects.toThrow();
  });

  it.each(named('the confirm page'))('%s: fails on any axe violation', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { axeViolations: () => Promise.resolve(['label: 1']) }))).rejects.toThrow();
  });

  it.each(named('the confirm page'))('%s: taps the button, then waits for the expired heading', async (_, c) => {
    const lang = langOf(c.title);
    const tapped: string[] = [];
    const waited: [string, string][] = [];
    await c.run(
      safari(lang, {
        tap: (selector) => {
          tapped.push(selector);
          return Promise.resolve();
        },
        waitForText: (selector, text) => {
          waited.push([selector, text]);
          return Promise.resolve();
        },
      }),
    );
    expect(tapped).toEqual(['#confirm-button']);
    expect(waited[0]?.[1]).toBe(t(LOCALE[lang] ?? 'en', 'closedTesting.expiredHeading'));
  });

  it.each(named('the confirm page'))('%s: fails when the heading never comes', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { waitForText: () => Promise.reject(new Error('no heading')) }))).rejects.toThrow(
      'no heading',
    );
  });

  it.each(named('the confirm page'))('%s: fails on a CSP refusal', async (_, c) => {
    await expect(c.run(safari(langOf(c.title), { cspRefusals: () => Promise.resolve(['refused']) }))).rejects.toThrow();
  });

  it("holds the legal links in each language's home-page case, and no case of their own", () => {
    expect(named('the home page answers').filter(([title]) => title.includes('each footer legal link opens the right page'))).toHaveLength(
      5,
    );
    expect(named('each footer legal link')).toHaveLength(0);
  });

  it.each(named('the home page answers'))(
    '%s: taps each legal link, reads its heading in the right language, and checks axe on home and each',
    async (_, c) => {
      const lang = langOf(c.title);
      const locale = LOCALE[lang] ?? 'en';
      const words = legalLines(legalLocale(locale));
      const tapped: string[] = [];
      const waited: string[] = [];
      let axe = 0;
      // The site's own menu answers its taps (shyden-labs/ShyTalk#332).
      const site = safari(lang);
      const next = langTag(nextLocale(locale));
      await c.run(
        safari(lang, {
          // The home page is in this language; a legal page, once a link was tapped, in its legal language; the picked
          // page in the language picked.
          attribute: (selector) =>
            Promise.resolve(
              selector === VIEWPORT_TAG
                ? VIEWPORT
                : selector === SUPPORT_LINK
                  ? localePath(locale, SUPPORT_PATH)
                  : tapped.at(-1)?.startsWith('details.lang-switch a') === true
                    ? next
                    : tapped.length === 0
                      ? lang
                      : legalLocale(locale),
            ),
          tap: (selector) => {
            tapped.push(selector);
            return site.tap(selector);
          },
          menuLive: () => site.menuLive(),
          url: () => site.url(),
          waitForText: (_selector, text) => {
            waited.push(text);
            return Promise.resolve();
          },
          axeViolations: () => {
            axe += 1;
            return Promise.resolve([]);
          },
        }),
      );
      const button = 'details.lang-switch > summary';
      expect(tapped).toEqual([
        ...['privacy', 'terms', 'guidelines'].map((doc) => `footer a[data-legal="${doc}"]`),
        button,
        button,
        button,
        `details.lang-switch a.entry[hreflang="${next}"]`,
      ]);
      expect(waited).toEqual([words.privacy.title, words.terms.title, words.guidelines.title]);
      // Home, each legal page, and home with the menu open.
      expect(axe).toBe(5);
    },
  );

  it.each(named('the home page answers'))('%s: fails when a legal page is in the wrong language', async (_, c) => {
    const lang = langOf(c.title);
    let tapped = false;
    const page = safari(lang, {
      tap: () => ((tapped = true), Promise.resolve()),
      attribute: (selector) =>
        Promise.resolve(
          selector === VIEWPORT_TAG
            ? VIEWPORT
            : selector === SUPPORT_LINK
              ? localePath(LOCALE[langOf(c.title)] ?? 'en', SUPPORT_PATH)
              : tapped
                ? 'fr'
                : lang,
        ),
    });
    await expect(c.run(page)).rejects.toThrow(/'fr'/);
  });

  it.each(named('the home page answers'))(
    '%s: fails when the keyboard may pan the page over it (shyden-labs/ShyTalk#189)',
    async (_, c) => {
      const lang = langOf(c.title);
      const page = safari(lang, {
        attribute: (selector) => Promise.resolve(selector === VIEWPORT_TAG ? 'width=device-width, initial-scale=1' : lang),
      });
      await expect(c.run(page)).rejects.toThrow(/interactive-widget=resizes-content/);
    },
  );

  it.each(named('the home page answers'))('%s: fails on an axe violation on a legal page', async (_, c) => {
    let calls = 0;
    const onLegal = () => ((calls += 1), Promise.resolve(calls > 1 ? ['label: 1'] : []));
    await expect(c.run(safari(langOf(c.title), { axeViolations: onLegal }))).rejects.toThrow('label: 1');
  });
});

describe('the iPhone closed-testing journey', () => {
  const TITLE = 'applying and following the mailed link confirms the address';
  const journey = () => {
    const found = IPHONE_CASES.find(({ title }) => title === TITLE);
    if (found === undefined) throw new Error(`no case titled ${TITLE}`);
    return found;
  };
  const sent = t('en', 'closedTesting.sent');

  beforeEach(() => {
    mailbox.plusAddress.mockClear();
    mailbox.waitForMail.mockClear();
    mailbox.waitForMail.mockResolvedValue({
      subject: t('en', 'closedTesting.mailSubject'),
      text: 'body',
      confirmLink: 'https://dev.example/closed-testing/confirm?t=abc',
    });
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    vi.stubEnv('TEST_MAILBOX_PASSWORD', 'secret');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('is in the suite once', () => {
    expect(IPHONE_CASES.filter(({ title }) => title === TITLE)).toHaveLength(1);
  });

  it('applies with its own plus-address by real typing and taps, reads the mail, follows its link and confirms', async () => {
    const steps: string[] = [];
    mailbox.waitForMail.mockImplementation((tag: string, deps: { password: string }) => {
      steps.push(`mail ${tag} ${deps.password}`);
      return Promise.resolve({
        subject: t('en', 'closedTesting.mailSubject'),
        text: 'body',
        confirmLink: 'https://dev.example/closed-testing/confirm?t=abc',
      });
    });
    const page = safari('en', {
      goto: (path) => (steps.push(`goto ${path}`), Promise.resolve(200)),
      type: (selector, text) => (steps.push(`type ${selector} ${text}`), Promise.resolve()),
      tap: (selector) => (steps.push(`tap ${selector}`), Promise.resolve()),
      waitForText: (selector, text) => (steps.push(`wait ${selector} ${text}`), Promise.resolve()),
    });
    const check = countingCheck();
    await journey().run(page, check);
    // Its twin on CI ran 5 (shyden-labs/ShyTalk#180 AC7).
    expect(check.count).toBe(5);
    expect(mailbox.plusAddress).toHaveBeenCalledWith('iphone-air-1700000000000');
    expect(steps).toEqual([
      'goto /closed-testing',
      'type #apply-email box+iphone-air-1700000000000@mail.test',
      'tap #apply-adult',
      'tap #apply-submit',
      `wait #apply-answer ${sent}`,
      'mail iphone-air-1700000000000 secret',
      'goto /closed-testing/confirm?t=abc',
      'tap #confirm-button',
      `wait h1, [role="heading"][aria-level="1"] ${t('en', 'closedTesting.confirmedHeading')}`,
    ]);
  });

  it('fails naming what is hidden when the sent answer or the confirmed heading is not shown', async () => {
    const hidden = (gone: string) => safari('en', { isVisible: (selector) => Promise.resolve(selector !== gone) });
    await expect(journey().run(hidden('#apply-answer'))).rejects.toThrow('no visible answer');
    await expect(journey().run(hidden('h1, [role="heading"][aria-level="1"]'))).rejects.toThrow('no visible top heading');
  });

  it('fails when the mail has another subject', async () => {
    mailbox.waitForMail.mockResolvedValue({
      subject: 'Other',
      text: 'body',
      confirmLink: 'https://dev.example/closed-testing/confirm?t=abc',
    });
    await expect(journey().run(safari('en'))).rejects.toThrow('Other');
  });

  it('fails without reading mail when the sent answer never shows', async () => {
    const page = safari('en', { waitForText: () => Promise.reject(new Error('#apply-answer held null')) });
    await expect(journey().run(page)).rejects.toThrow('#apply-answer held null');
    expect(mailbox.waitForMail).not.toHaveBeenCalled();
  });

  it('passes an empty password when none is set, which waitForMail refuses by name', async () => {
    vi.stubEnv('TEST_MAILBOX_PASSWORD', undefined);
    await journey().run(safari('en'));
    expect(mailbox.waitForMail).toHaveBeenCalledWith('iphone-air-1700000000000', { password: '' });
  });
});

describe('the iPhone joining journey: a recovery shows on the signed-in device (shyden-labs/ShyTalk#180)', () => {
  const TITLE = 'joining with the mailed code and an authenticator app, then signing back in with it';
  const journey = () => {
    const found = IPHONE_CASES.find(({ title }) => title === TITLE);
    if (found === undefined) throw new Error(`no case titled ${TITLE}`);
    return found;
  };
  const NOTICE = '#recovery-pending';
  const SIGNED_IN = '[data-testid="signed-in"]';
  const H1 = 'h1, [role="heading"][aria-level="1"]';
  const CODES = '[data-testid="recovery-codes"] li, [data-testid="recovery-codes"] [role="listitem"]';
  const DEVICES = '[data-testid="devices"] li, [data-testid="devices"] [role="listitem"]';

  /** Safari on the account pages as they should be: the notice shows once a recovery started, until it is cancelled. */
  function accountPages(
    overrides: {
      notice?: (pending: boolean) => boolean;
      noticeText?: string;
      answerText?: string;
      shown?: (selector: string) => boolean;
      count?: (selector: string) => number | undefined;
      firstCode?: string;
    } = {},
  ) {
    const steps: string[] = [];
    let started = false;
    let pending = false;
    let signedOut = false;
    const page = safari('en', {
      goto: (path) => {
        steps.push(`goto ${path}`);
        return Promise.resolve(200);
      },
      type: (selector, text) => (steps.push(`type ${selector} ${text}`), Promise.resolve()),
      tap: (selector) => {
        steps.push(`tap ${selector}`);
        if (selector === '#code-submit' && steps.includes('goto /recover')) started = true;
        if (selector === '#signed-in-sign-out') signedOut = true;
        if (selector === '#signin-recovery-submit' && started) pending = true;
        if (selector === '#recovery-cancel') pending = false;
        return Promise.resolve();
      },
      waitForText: (selector, text) => (steps.push(`wait ${selector} ${text}`), Promise.resolve()),
      isVisible: (selector) => {
        if (selector === NOTICE) return Promise.resolve((overrides.notice ?? ((shown) => shown))(pending));
        // Signed in, the sign-up and recovery pages show only the signed-in line, until its Sign out (#213).
        if (selector === SIGNED_IN) return Promise.resolve(!signedOut && overrides.shown?.(selector) !== false);
        // The address form shows once the page has asked whether it is signed in, until its code is accepted;
        // signed in, it shows only after Sign out (#213).
        if (selector === '#email-address')
          return Promise.resolve((signedOut || !steps.includes('tap #code-submit')) && overrides.shown?.(selector) !== false);
        return Promise.resolve(
          ['#email-answer', '[data-testid="totp-secret"]', H1].includes(selector) && overrides.shown?.(selector) !== false,
        );
      },
      count: (selector) => Promise.resolve(overrides.count?.(selector) ?? (selector === CODES ? 10 : selector === DEVICES ? 1 : 0)),
      text: (selector) => {
        if (selector === '[data-testid="totp-secret"]') return Promise.resolve('JBSWY3DPEHPK3PXP');
        if (selector === CODES) return Promise.resolve(overrides.firstCode ?? 'AB12-CD34-EF56-GH78');
        if (selector === '[data-testid="method-authenticator"]') return Promise.resolve(t('en', 'account.authenticatorOn'));
        if (selector === '#email-answer')
          return Promise.resolve(overrides.answerText ?? t('en', 'account.recoveryStarted').replace('{completesAt}', '14 Nov 2026, 10:00'));
        if (selector === '#recovery-pending-text')
          return Promise.resolve(overrides.noticeText ?? t('en', 'account.recoveryPending').replace('{startedAt}', '13 Nov 2026, 10:00'));
        return Promise.resolve('');
      },
    });
    return { page, steps };
  }

  /** Runs the journey, letting its waits pass on fake time. */
  async function run(page: SafariPage, check = countingCheck()): Promise<void> {
    const state = { settled: false };
    const running = journey()
      .run(page, check)
      .finally(() => {
        state.settled = true;
      });
    running.catch(() => undefined);
    // Each wait sets its next timer only after its look answers, so time moves a second at a time.
    for (let second = 0; second < 130 && !state.settled; second += 1) await vi.advanceTimersByTimeAsync(1_000);
    await running;
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: 1700000000000 });
    vi.stubEnv('TEST_MAILBOX_PASSWORD', 'secret');
    mailbox.waitForAnyMail.mockReset();
    // The sign-up code; then the same mail while the recovery mail has not yet arrived; then the recovery code.
    mailbox.waitForAnyMail
      .mockResolvedValueOnce({ subject: t('en', 'email.codeSubject'), text: 'code 111111' })
      .mockResolvedValueOnce({ subject: t('en', 'email.codeSubject'), text: 'code 111111' })
      .mockResolvedValue({ subject: t('en', 'email.codeSubject'), text: 'code 222222' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('starts a recovery for its own address, types the new code once it arrives, sees the notice and cancels it there', async () => {
    const { page, steps } = accountPages();
    const check = countingCheck();
    await run(page, check);
    // Its twin on CI runs 30: 19 (shyden-labs/ShyTalk#180 AC7), 9 for the signed-in pages and the sign-in, 1 for the
    // codes left and 1 for the sign-up form showing before it is typed in (#213).
    expect(check.count).toBe(30);
    const address = 'box+iphone-air-1700000000000@mail.test';
    expect(steps.slice(steps.indexOf('goto /sign-up', 1))).toEqual([
      'goto /sign-up',
      `wait ${SIGNED_IN} ${t('en', 'account.signedInFirst')}`,
      'goto /recover',
      `wait ${SIGNED_IN} ${t('en', 'account.signedInFirst')}`,
      'tap #signed-in-sign-out',
      `type #email-address ${address}`,
      'tap #email-submit',
      `wait #email-answer ${t('en', 'account.sent')}`,
      'type #email-code 222222',
      'tap #code-submit',
      'goto /sign-in',
      'tap #use-recovery-code',
      `type #signin-email ${address}`,
      'type #signin-recovery-code AB12-CD34-EF56-GH78',
      'tap #signin-recovery-submit',
      `wait #signin-answer ${t('en', 'account.codesLeftAfterSignIn').replace('{count}', '9')}`,
      'tap #signin-continue a',
      `wait ${H1} ${t('en', 'account.accountTitle')}`,
      'tap #recovery-cancel',
    ]);
    expect(mailbox.waitForAnyMail).toHaveBeenCalledTimes(3);
  });

  it('waits for the authenticator key, which the page shows once its setup fetch answers (1.1 s on the iPhone Air, 2026-11-14)', async () => {
    let tappedAt: number | undefined;
    const KEY = '[data-testid="totp-secret"]';
    const { page } = accountPages({ shown: (selector) => selector !== KEY || (tappedAt !== undefined && Date.now() - tappedAt >= 1_000) });
    const tap = page.tap.bind(page);
    page.tap = (selector) => {
      if (selector === '#setup-authenticator') tappedAt = Date.now();
      return tap(selector);
    };
    const check = countingCheck();
    await run(page, check);
    expect(check.count).toBe(30);
  });

  it('waits for the recovery codes, which show once the confirm answers: their hidden heading already holds its text', async () => {
    let confirmedAt: number | undefined;
    const { page } = accountPages({
      count: (selector) => (selector === CODES ? (confirmedAt !== undefined && Date.now() - confirmedAt >= 1_000 ? 10 : 0) : undefined),
    });
    const tap = page.tap.bind(page);
    page.tap = (selector) => {
      if (selector === '#totp-confirm') confirmedAt = Date.now();
      return tap(selector);
    };
    const check = countingCheck();
    await run(page, check);
    expect(check.count).toBe(30);
  });

  it('waits for the authenticator to read On, which the account page fills in after its heading shows (#190 run 8)', async () => {
    const { page, steps } = accountPages();
    const text = page.text.bind(page);
    page.text = (selector) => (selector === '[data-testid="method-authenticator"]' ? Promise.resolve('') : text(selector));
    const check = countingCheck();
    await run(page, check);
    expect(check.count).toBe(30);
    expect(steps).toContain(`wait [data-testid="method-authenticator"] ${t('en', 'account.authenticatorOn')}`);
  });

  it('waits for the signed-in device, which the account page lists after its methods (#190 run 11: read 0)', async () => {
    let onAt: number | undefined;
    const { page } = accountPages({
      count: (selector) => (selector === DEVICES ? (onAt !== undefined && Date.now() - onAt >= 1_000 ? 1 : 0) : undefined),
    });
    const wait = page.waitForText.bind(page);
    page.waitForText = (selector, text) => {
      if (selector === '[data-testid="method-authenticator"]') onAt = Date.now();
      return wait(selector, text);
    };
    const check = countingCheck();
    await run(page, check);
    expect(check.count).toBe(30);
  });

  it('fails naming the count when no recovery codes show within 15 s', async () => {
    let confirmedAt: number | undefined;
    const { page } = accountPages({
      count: (selector) => (selector === CODES ? (confirmedAt !== undefined && Date.now() - confirmedAt > 15_000 ? 10 : 0) : undefined),
    });
    const tap = page.tap.bind(page);
    page.tap = (selector) => {
      if (selector === '#totp-confirm') confirmedAt = Date.now();
      return tap(selector);
    };
    await expect(run(page)).rejects.toThrow('ten recovery codes, not 0');
  });

  it('fails naming the key when the authenticator key is not shown within 15 s', async () => {
    let tappedAt: number | undefined;
    const KEY = '[data-testid="totp-secret"]';
    const { page } = accountPages({ shown: (selector) => selector !== KEY || (tappedAt !== undefined && Date.now() - tappedAt > 15_000) });
    const tap = page.tap.bind(page);
    page.tap = (selector) => {
      if (selector === '#setup-authenticator') tappedAt = Date.now();
      return tap(selector);
    };
    await expect(run(page)).rejects.toThrow('no visible authenticator key');
  });

  it('fails naming the key when the authenticator key is not shown', async () => {
    const { page } = accountPages({ shown: (selector) => selector !== '[data-testid="totp-secret"]' });
    await expect(run(page)).rejects.toThrow('no visible authenticator key');
  });

  it('fails naming the count when there are not ten recovery codes', async () => {
    const { page } = accountPages({ count: (selector) => (selector === CODES ? 9 : undefined) });
    await expect(run(page)).rejects.toThrow('ten recovery codes, not 9');
  });

  it('fails when the first recovery code is not four groups of four Crockford letters', async () => {
    const { page } = accountPages({ firstCode: 'AB12-CD34-EF56-GH7U' });
    await expect(run(page)).rejects.toThrow('AB12-CD34-EF56-GH7U');
  });

  it('fails naming the count when the account page lists another number of devices than this one', async () => {
    const { page } = accountPages({ count: (selector) => (selector === DEVICES ? 2 : undefined) });
    await expect(run(page)).rejects.toThrow('one signed-in device, not 2');
  });

  it('fails naming the answer when the sent answer is not shown', async () => {
    const { page } = accountPages({ shown: (selector) => selector !== '#email-answer' });
    await expect(run(page)).rejects.toThrow('no visible answer');
  });

  it('fails when a notice shows before any recovery started', async () => {
    const { page } = accountPages({ notice: () => true });
    await expect(run(page)).rejects.toThrow('a recovery notice before any recovery started');
  });

  it('fails naming the notice when it never shows', async () => {
    const { page } = accountPages({ notice: () => false });
    await expect(run(page)).rejects.toThrow('waited 60 s for the recovery notice');
  });

  it('fails naming the recovery-started answer when the page never shows it', async () => {
    const { page } = accountPages({ answerText: t('en', 'account.sent') });
    await expect(run(page)).rejects.toThrow('waited 60 s for the recovery-started answer');
  });

  it('fails when the notice says something else', async () => {
    const { page } = accountPages({ noticeText: 'Something else' });
    await expect(run(page)).rejects.toThrow('Something else');
  });

  it('fails naming the notice when it stays after the cancel', async () => {
    let shown = false;
    const { page } = accountPages({ notice: (pending) => (shown ||= pending) });
    await expect(run(page)).rejects.toThrow('waited 60 s for the recovery notice to hide');
  });

  it('waits for the sign-up form, which shows once the page has asked whether it is signed in (#213: 0 typed on both phones, 2026-11-16)', async () => {
    let visitedAt: number | undefined;
    const ready = () => visitedAt !== undefined && Date.now() - visitedAt >= 1_000;
    const { page, steps } = accountPages({ shown: (selector) => selector !== '#email-address' || ready() });
    const goto = page.goto.bind(page);
    page.goto = (path) => {
      if (path === '/sign-up' && visitedAt === undefined) visitedAt = Date.now();
      return goto(path);
    };
    const type = page.type.bind(page);
    let typedWhileHidden = false;
    page.type = (selector, text) => {
      if (selector === '#email-address' && visitedAt !== undefined && !ready()) typedWhileHidden = true;
      return type(selector, text);
    };
    const check = countingCheck();
    await run(page, check);
    expect(typedWhileHidden).toBe(false);
    expect(steps).toContain('type #email-address box+iphone-air-1700000000000@mail.test');
    expect(check.count).toBe(30);
  });

  it('waits for the signed-in line, which shows once the page has asked whether it is signed in (#213 run 4: read hidden on the recovery page)', async () => {
    let visitedAt = 0;
    const { page } = accountPages({ shown: (selector) => selector !== SIGNED_IN || Date.now() - visitedAt >= 1_000 });
    const goto = page.goto.bind(page);
    page.goto = (path) => {
      visitedAt = Date.now();
      return goto(path);
    };
    const check = countingCheck();
    await run(page, check);
    expect(check.count).toBe(30);
  });

  it('fails naming the page when its signed-in line never shows', async () => {
    const { page } = accountPages({ shown: (selector) => selector !== SIGNED_IN });
    await expect(run(page)).rejects.toThrow('no visible signed-in line on the sign-up page');
  });

  it('fails naming the sign-up form when it never shows', async () => {
    const { page } = accountPages({ shown: (selector) => selector !== '#email-address' });
    await expect(run(page)).rejects.toThrow('no visible sign-up form');
  });

  it('fails naming the recovery mail when it never replaces the sign-up one', async () => {
    mailbox.waitForAnyMail.mockReset();
    mailbox.waitForAnyMail.mockResolvedValue({ subject: t('en', 'email.codeSubject'), text: 'code 111111' });
    const { page } = accountPages();
    await expect(run(page)).rejects.toThrow('waited 120 s for the recovery code mail');
  });

  it('waits as long as the mail reader for the recovery code: real mail took 48 s (shyden-labs/ShyTalk#185)', async () => {
    mailbox.waitForAnyMail.mockReset();
    const sent = Date.now();
    mailbox.waitForAnyMail
      .mockResolvedValueOnce({ subject: t('en', 'email.codeSubject'), text: 'code 111111' })
      .mockImplementation(() =>
        Promise.resolve({ subject: t('en', 'email.codeSubject'), text: Date.now() - sent < 90_000 ? 'code 111111' : 'code 222222' }),
      );
    const { page, steps } = accountPages();
    await run(page);
    expect(steps).toContain('type #email-code 222222');
  });
});

describe('the iPhone recovery pages', () => {
  const TITLE = 'asking to recover shows the code step, and a cancel link answers on its press';
  const recovery = () => {
    const found = IPHONE_CASES.find(({ title }) => title === TITLE);
    if (found === undefined) throw new Error(`no case titled ${TITLE}`);
    return found;
  };

  /** Safari on the recovery pages as they should be: the code field after a start, the cancel answer after its tap. */
  function recoveryPages(overrides: Partial<SafariPage> = {}) {
    const steps: string[] = [];
    let tapped = '';
    const page = safari('en', {
      goto: (path) => (steps.push(`goto ${path}`), Promise.resolve(200)),
      type: (selector, text) => (steps.push(`type ${selector} ${text}`), Promise.resolve()),
      tap: (selector) => ((tapped = selector), steps.push(`tap ${selector}`), Promise.resolve()),
      waitForText: (selector, text) => (steps.push(`wait ${selector} ${text}`), Promise.resolve()),
      isVisible: (selector) =>
        Promise.resolve(
          selector === '#email-address' ||
            (selector === '#email-code' ? tapped === '#email-submit' : selector === '#cancel-answer' && tapped === '#cancel-button'),
        ),
      ...overrides,
    });
    return { page, steps };
  }

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts a recovery, sees the code step, and sees the cancel page answer only once its button is tapped, as many checks as its twin on CI', async () => {
    const { page, steps } = recoveryPages();
    const check = countingCheck();
    await recovery().run(page, check);
    expect(steps).toEqual([
      'goto /recover',
      'type #email-address box+iphone-air-recover-1700000000000@mail.test',
      'tap #email-submit',
      `wait #email-answer ${t('en', 'account.sent')}`,
      'goto /recover/cancel/#not-a-real-token',
      'tap #cancel-button',
      `wait #cancel-answer ${t('en', 'account.cancelled')}`,
    ]);
    // Its twin on CI runs 5: 4 (shyden-labs/ShyTalk#180 AC7) and the form showing before it is typed in (#213).
    expect(check.count).toBe(5);
  });

  it('waits for the recovery form, which shows once the page has asked whether it is signed in (#213)', async () => {
    let looks = 0;
    let typedWhileHidden = false;
    const { page } = recoveryPages();
    const isVisible = page.isVisible.bind(page);
    page.isVisible = (selector) => (selector === '#email-address' ? Promise.resolve(++looks > 2) : isVisible(selector));
    const type = page.type.bind(page);
    page.type = (selector, text) => {
      if (selector === '#email-address' && looks <= 2) typedWhileHidden = true;
      return type(selector, text);
    };
    // The quarter-second looks pass on fake time, so the test waits on none (shyden-labs/ShyTalk#264: 504 ms on the real clock).
    vi.useFakeTimers({ now: 1700000000000 });
    try {
      const running = recovery().run(page, countingCheck());
      await vi.runAllTimersAsync();
      await running;
    } finally {
      vi.useRealTimers();
    }
    expect(typedWhileHidden).toBe(false);
    expect(looks).toBeGreaterThan(2);
  });

  it('fails naming the recovery form when it never shows', async () => {
    let now = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 16_000));
    const { page } = recoveryPages({ isVisible: () => Promise.resolve(false) });
    await expect(recovery().run(page)).rejects.toThrow('no visible recovery form');
  });

  it('fails naming the code field when it never shows', async () => {
    const { page } = recoveryPages({ isVisible: (selector) => Promise.resolve(selector === '#email-address') });
    await expect(recovery().run(page)).rejects.toThrow('no code field after the start');
  });

  it('fails when the cancel page answers before its button is tapped', async () => {
    const { page } = recoveryPages({ isVisible: () => Promise.resolve(true) });
    await expect(recovery().run(page)).rejects.toThrow('the cancel page answered before its button was tapped');
  });
});

describe('the English-only note on a legal page (shyden-labs/ShyTalk#190)', () => {
  const NOTE = '[data-english-only="th"]';
  const home = () => {
    const found = IPHONE_CASES.find(({ title }) => title.startsWith('th: the home page answers'));
    if (found === undefined) throw new Error('no th home case');
    return found;
  };
  /** Safari on th's pages, the note shown `afterMs` after each legal-link tap, as the page's own script reveals it. */
  function delayedNote(afterMs: number): SafariPage {
    let tappedAt: number | undefined;
    const page = safari('th', {
      isVisible: (selector) =>
        Promise.resolve(
          selector === NOTE ? tappedAt !== undefined && Date.now() - tappedAt >= afterMs : selector !== '[data-english-only]:not([hidden])',
        ),
    });
    const tap = page.tap.bind(page);
    page.tap = (selector) => {
      tappedAt = Date.now();
      return tap(selector);
    };
    page.goto = (path) => {
      tappedAt = undefined;
      return Promise.resolve(path.endsWith('/no-such-page') ? 404 : 200);
    };
    return page;
  }
  async function run(page: SafariPage, check = countingCheck()): Promise<void> {
    const state = { settled: false };
    const running = home()
      .run(page, check)
      .finally(() => {
        state.settled = true;
      });
    running.catch(() => undefined);
    for (let step = 0; step < 400 && !state.settled; step += 1) await vi.advanceTimersByTimeAsync(250);
    await running;
  }
  beforeEach(() => {
    vi.useFakeTimers({ now: 1700000000000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the note the page reveals after it loads, as Playwright’s toBeVisible() waits', async () => {
    const check = countingCheck();
    await run(delayedNote(1_000), check);
    expect(check.count).toBe(63);
  });

  it('fails naming the note when it is not shown within 15 s', async () => {
    await expect(run(delayedNote(15_001))).rejects.toThrow('no visible note');
  });
});

describe('the iPhone holding-page cases (shyden-labs/ShyTalk#261, #273)', () => {
  const holding = IPHONE_CASES.filter(({ title }) => kind(title).startsWith('the holding page')).map((c) => [c.title, c] as const);
  const localeOf = (title: string): Locale => LOCALE[langOf(title)] ?? 'en';

  it('holds one in every language', () => {
    expect(holding.map(([title]) => langOf(title))).toEqual(Object.keys(LOCALE));
  });

  it.each(holding)('%s: opens the holding page', async (title, c) => {
    const page = safari(langOf(title));
    await c.run(page);
    expect(page.visited).toEqual([`${PREFIX[langOf(title)] ?? '?'}/holding`]);
  });

  it.each(holding)('%s: fails on anything but 200', async (title, c) => {
    await expect(c.run(safari(langOf(title), { goto: () => Promise.resolve(404) }))).rejects.toThrow();
  });

  it.each(holding)('%s: fails when the language menu does not open, or its pick leads elsewhere', async (title, c) => {
    const locale = localeOf(title);
    await expect(c.run(safari(langOf(title), { menuLive: () => Promise.resolve(wantedLive(locale, 420, false)) }))).rejects.toThrow(
      'the menu, opened by a tap',
    );
    // The address is looked at every quarter second up to 15 s: the clock is stood in, so the wait takes no time.
    vi.useFakeTimers({ now: 1700000000000 });
    try {
      const state = { settled: false };
      const running = c.run(safari(langOf(title), { url: () => Promise.resolve(`${DEV}/elsewhere/`) })).finally(() => {
        state.settled = true;
      });
      running.catch(() => undefined);
      for (let step = 0; step < 100 && !state.settled; step += 1) await vi.advanceTimersByTimeAsync(250);
      await expect(running).rejects.toThrow("the picked language's page");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(holding)('%s: fails naming a line that is hidden or holds other words', async (title, c) => {
    await expect(c.run(safari(langOf(title), { isVisible: (selector) => Promise.resolve(selector !== 'p.badge') }))).rejects.toThrow(
      'p.badge',
    );
    await expect(
      c.run(
        safari(langOf(title), {
          text: (selector) => Promise.resolve(selector === 'p.tagline' ? 'other words' : selectorText(localeOf(title), selector, true)),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      c.run(
        safari(langOf(title), {
          text: (selector) => Promise.resolve(selector === 'h1 span' ? 'Shy' : selectorText(localeOf(title), selector, true)),
        }),
      ),
    ).rejects.toThrow();
  });

  it.each(holding)('%s: fails when a hello is missing, moved or translated', async (title, c) => {
    const hellos: string[][] = HELLOS.map(({ lang, word }) => [lang, word]);
    for (const wrong of [hellos.slice(1), hellos.toReversed(), hellos.map(([lang = '']) => [lang, 'hello'])]) {
      await expect(
        c.run(safari(langOf(title), { rows: (selector) => Promise.resolve(selector === 'ul.hellos > li' ? wrong : []) })),
      ).rejects.toThrow();
    }
  });

  it.each(holding)(
    '%s: fails when the look is wrong: motion against the setting, a missing font, or a page wider than a phone',
    async (title, c) => {
      const phone = wantedFacts(420, false);
      for (const wrong of [
        { ...wantedFacts(420, true), moving: ['hello'] },
        { ...phone, fonts: { ...phone.fonts, '800 18px "Noto Sans Thai"': false } },
        { ...phone, fits: false },
        { ...phone, iconLoaded: false },
        wantedFacts(700, false),
      ]) {
        await expect(c.run(safari(langOf(title), { holdingFacts: () => Promise.resolve(wrong) }))).rejects.toThrow();
      }
    },
  );

  it.each(holding)('%s: fails on an axe violation or a CSP refusal', async (title, c) => {
    await expect(c.run(safari(langOf(title), { axeViolations: () => Promise.resolve(['region: 1']) }))).rejects.toThrow();
    await expect(c.run(safari(langOf(title), { cspRefusals: () => Promise.resolve(['refused']) }))).rejects.toThrow();
  });
});

describe('the iPhone link-preview cases (shyden-labs/ShyTalk#198)', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_ENVIRONMENT', 'dev');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const previews = IPHONE_CASES.filter(({ title }) => kind(title).startsWith('every page carries its link preview')).map(
    (c) => [c.title, c] as const,
  );

  it('holds one in every language', () => {
    expect(previews.map(([title]) => langOf(title))).toEqual(Object.keys(LOCALE));
  });

  it.each(previews)('%s: opens the home page once and reads every page this language builds from it', async (title, c) => {
    const lang = langOf(title);
    const asked: string[] = [];
    const page = safari(lang, {
      previewFacts: (path) => {
        asked.push(path);
        return Promise.resolve(wantedPreview(DEV, LOCALE[lang] ?? 'en', lang, path, 'A title'));
      },
    });
    await c.run(page);
    expect(page.visited).toEqual([`${PREFIX[lang] ?? '?'}/`]);
    expect(asked).toEqual(sitePages(PAGE_FILES, LOCALE[lang] ?? 'en').map((file) => pageUrl('', pagePath(file))));
  });

  it.each(previews)('%s: fails naming each page whose preview is wrong, after checking every page', async (title, c) => {
    const lang = langOf(title);
    const locale = LOCALE[lang] ?? 'en';
    const [first, , third] = sitePages(PAGE_FILES, locale).map((file) => pageUrl('', pagePath(file)));
    const asked: string[] = [];
    const page = safari(lang, {
      previewFacts: (path) => {
        asked.push(path);
        const facts = wantedPreview(DEV, locale, lang, path, 'A title');
        if (path === first) facts.tags['og:image:alt'] = null;
        if (path === third) facts.picture.manyColours = false;
        return Promise.resolve(facts);
      },
    });
    const failure = await c.run(page).catch((error: unknown) => (error as Error).message);
    expect(failure).toContain(`${String(first)}: the link preview`);
    expect(failure).toContain(`${String(third)}: the link preview`);
    expect(asked).toHaveLength(sitePages(PAGE_FILES, locale).length);
  });

  it.each(previews)('%s: fails naming a page with no title', async (title, c) => {
    const lang = langOf(title);
    const page = safari(lang, {
      previewFacts: (path) => Promise.resolve(wantedPreview(DEV, LOCALE[lang] ?? 'en', lang, path, '')),
    });
    await expect(c.run(page)).rejects.toThrow(`${PREFIX[lang] ?? '?'}/: no title`);
  });

  it.each(previews)('%s: fails naming why when the run names no environment', async (title, c) => {
    vi.stubEnv('SITE_ENVIRONMENT', '');
    await expect(c.run(safari(langOf(title)))).rejects.toThrow('SITE_ENVIRONMENT is unset');
  });
});

describe('the ticket page (shyden-labs/ShyTalk#37 AC1)', () => {
  const ticket = IPHONE_CASES.find(({ title }) => title.startsWith('the ticket page opens the ticket view'));
  const TOKEN_ADDRESS = `${TICKET_PATH}#t=${SMOKE_TICKET_TOKEN}`;

  it('is in the suite once', () => {
    expect(IPHONE_CASES.filter(({ title }) => title.startsWith('the ticket page opens the ticket view'))).toHaveLength(1);
  });

  it('passes on the site as it should be, running the 8 checks its twin runs on CI', async () => {
    const page = safari('en');
    const check = countingCheck();
    await expect(ticket?.run(page, check)).resolves.toBeUndefined();
    expect(page.visited).toEqual([TOKEN_ADDRESS]);
    expect(check.count).toBe(8);
  });

  it('reads a page language the site does not have as English, the language-free page staying where it is', async () => {
    const page = safari('fr');
    const check = countingCheck();
    await expect(ticket?.run(page, check)).resolves.toBeUndefined();
    expect(check.count).toBe(8);
  });

  it('fails naming the address when the page loses the emailed token', async () => {
    const page = safari('en', { url: () => Promise.resolve(`${DEV}${TICKET_PATH}`) });
    await expect(ticket?.run(page)).rejects.toThrow(TICKET_PATH);
  });

  it('fails when the page shows one language but sits at another language’s address', async () => {
    const page = safari('th', { url: () => Promise.resolve(`${DEV}${TOKEN_ADDRESS}`) });
    await expect(ticket?.run(page)).rejects.toThrow(`/th${TICKET_PATH}`);
  });
});

describe('the appeal page (shyden-labs/ShyTalk#310 AC4)', () => {
  const title = 'the appeal page opens the appeal view in the browser’s language, keeping the notice’s token';
  const appeal = IPHONE_CASES.find((c) => c.title.startsWith(title));
  const TOKEN_ADDRESS = `${APPEAL_PATH}#appeal=${SMOKE_APPEAL_TOKEN}`;
  beforeEach(() => {
    vi.stubEnv('SITE_ENVIRONMENT', 'dev');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is in the suite once', () => {
    expect(IPHONE_CASES.filter((c) => c.title.startsWith(title))).toHaveLength(1);
  });

  it('passes on the site as it should be, running the 13 checks its twin runs on CI', async () => {
    const page = safari('en');
    const check = countingCheck();
    await expect(appeal?.run(page, check)).resolves.toBeUndefined();
    expect(page.visited).toEqual([TOKEN_ADDRESS]);
    expect(check.count).toBe(13);
  });

  it('reads a page language the site does not have as English, the language-free page staying where it is', async () => {
    const page = safari('fr');
    const check = countingCheck();
    await expect(appeal?.run(page, check)).resolves.toBeUndefined();
    expect(check.count).toBe(13);
  });

  it('fails naming the address when the page loses the notice’s token', async () => {
    const page = safari('en', { url: () => Promise.resolve(`${DEV}${APPEAL_PATH}`) });
    await expect(appeal?.run(page)).rejects.toThrow(APPEAL_PATH);
  });

  it('fails when the page shows one language but sits at another language’s address', async () => {
    const page = safari('th', { url: () => Promise.resolve(`${DEV}${TOKEN_ADDRESS}`) });
    await expect(appeal?.run(page)).rejects.toThrow(`/th${APPEAL_PATH}`);
  });

  it('fails naming the line when an appeal line is not visible', async () => {
    const page = safari('en', { isVisible: (selector) => Promise.resolve(selector !== '[data-line="appealIntro"]') });
    await expect(appeal?.run(page)).rejects.toThrow('appealIntro is not visible');
  });

  it('fails when the page embeds a view other than the appeal view', async () => {
    const page = safari('en', { count: () => Promise.resolve(0) });
    await expect(appeal?.run(page)).rejects.toThrow();
  });
});

describe('the iPhone copy of the roadmap page (shyden-labs/ShyTalk#321 AC3)', () => {
  /** Each language's roadmap case, by language, so every test runs (and fails) even before a case exists. */
  const roadmap = Object.keys(LOCALE).map((lang) => {
    const found = cases('the roadmap page shows the board at once').find(({ title }) => langOf(title) === lang);
    const missing = { title: `${lang}: (no roadmap case)`, run: () => Promise.reject(new Error(`no ${lang} roadmap case`)) };
    return [lang, found ?? missing] as const;
  });

  beforeEach(() => {
    vi.stubEnv('SITE_ENVIRONMENT', 'dev');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('holds the roadmap case in every language', () => {
    expect(cases('the roadmap page shows the board at once').map(({ title }) => langOf(title))).toEqual([
      'en',
      'id',
      'th',
      'vi',
      'zh-Hans',
    ]);
  });

  it.each(roadmap)('%s roadmap: opens the roadmap at its own address', async (lang, c) => {
    const page = safari(lang);
    await c.run(page);
    expect(page.visited).toEqual([`${PREFIX[lang] ?? '?'}/roadmap`]);
  });

  it.each(roadmap)('%s roadmap: fails naming the milestones whose button does not say its state', async (lang, c) => {
    const locale = LOCALE[lang] ?? 'en';
    const page = safari(lang, { roadmapFacts: () => Promise.resolve(roadmapFacts(locale, { labels: ['Groundwork'] })) });
    await expect(c.run(page)).rejects.toThrow('Groundwork');
  });

  it.each(roadmap)('%s roadmap: fails when a press does not open the panel', async (lang, c) => {
    const page = safari(lang, { isVisible: () => Promise.resolve(false) });
    await expect(c.run(page)).rejects.toThrow('the panel did not open');
  });

  it.each(roadmap)('%s roadmap: fails when the panel will not shut', async (lang, c) => {
    const page = safari(lang, { isVisible: (selector) => Promise.resolve(selector === ROADMAP_PANEL || selector === ROADMAP_H1) });
    await expect(c.run(page)).rejects.toThrow('the panel did not shut');
  });

  it.each(roadmap)('%s roadmap: fails when the read time is not worded in the phone’s own zone', async (lang, c) => {
    const locale = LOCALE[lang] ?? 'en';
    const page = safari(lang, { roadmapFacts: () => Promise.resolve(roadmapFacts(locale, { zone: 'UTC' })) });
    // Worded in UTC where the phone is in Jakarta: the error shows both.
    await expect(c.run(page)).rejects.toThrow('UTC');
  });

  it.each(roadmap)('%s roadmap: fails when the page does not fit the phone', async (lang, c) => {
    const locale = LOCALE[lang] ?? 'en';
    const page = safari(lang, { roadmapFacts: () => Promise.resolve(roadmapFacts(locale, { fits: false })) });
    await expect(c.run(page)).rejects.toThrow("the page does not fit the phone's width");
  });

  it.each(roadmap)('%s roadmap: fails on a CSP refusal and on an axe violation, running every other check', async (lang, c) => {
    const page = safari(lang, {
      cspRefusals: () => Promise.resolve(['refused']),
      axeViolations: () => Promise.resolve(['label: 1']),
    });
    const check = countingCheck();
    const error = await c.run(page, check).catch((caught: unknown) => caught);
    expect(String(error)).toContain('refused');
    expect(String(error)).toContain('label: 1');
    expect(check.count).toBe(20);
  });
});

describe('the iPhone copy of the live roadmap (shyden-labs/ShyTalk#321 AC3)', () => {
  const TITLE = 'the roadmap page takes a fresh board read on its own, with no reload';
  const live = IPHONE_CASES.find(({ title }) => title === TITLE);
  const SECRET = 'dev-webhook-secret';
  let sent: { url: string; init: RequestInit }[];

  beforeEach(() => {
    vi.useFakeTimers({ now: 1700000000000 });
    vi.stubEnv('PHONE_BASE_URL', 'https://dev.example');
    vi.stubEnv('SMOKE_ROADMAP_WEBHOOK_SECRET', SECRET);
    sent = [];
    vi.stubGlobal('fetch', (url: URL, init: RequestInit) => {
      sent.push({ url: String(url), init });
      return Promise.resolve(Response.json({ state: 'reading' }, { status: 202 }));
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** The page's version goes up `after` looks at it, as a fresh read reaching it does. */
  function readingPage(after: number, over: Partial<RoadmapFacts> = {}): SafariPage & { visited: string[] } {
    let looks = 0;
    const page = safari('en');
    let marked = false;
    return {
      ...page,
      markPage: async () => {
        marked = true;
        await page.markPage();
      },
      roadmapFacts: () => {
        looks += 1;
        return Promise.resolve(roadmapFacts('en', { version: looks > after ? 2 : 1, marked, ...over }));
      },
    };
  }

  it('sits after every language’s cases, as its Playwright twin does', () => {
    const at = IPHONE_CASES.findIndex(({ title }) => title === TITLE);
    expect(IPHONE_CASES[at - 1]?.title.startsWith('zh-Hans: the roadmap page')).toBe(true);
  });

  it('opens the roadmap, sends the board’s signed delivery to the site, and sees the fresh read land with no reload', async () => {
    const page = readingPage(3);
    const check = countingCheck();
    const run = live?.run(page, check);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(run).resolves.toBeUndefined();
    expect(page.visited).toEqual(['/roadmap']);
    const { body, headers } = boardDelivery(SECRET);
    expect(sent).toEqual([{ url: 'https://dev.example/hooks/github', init: { method: 'POST', body, headers } }]);
    // Its Playwright twin's six: the socket, the answer's status and words, the fresh read, no reload, the milestones.
    expect(check.count).toBe(6);
  });

  it('fails naming the wait when no fresh read reaches the page within 10 s', async () => {
    const run = live?.run(readingPage(Number.POSITIVE_INFINITY)).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(10_500);
    expect(String(await run)).toContain('no fresh read reached the page within 10 s');
  });

  it('fails when the page was reloaded to show it', async () => {
    const page = readingPage(3);
    const run = live?.run({ ...page, markPage: () => Promise.resolve() }).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await run).toBeInstanceOf(Error);
  });

  it('fails when the socket never opens, waiting no more than 10 s', async () => {
    const run = live?.run(readingPage(3, { socket: 'closed' })).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(10_500);
    expect(String(await run)).toContain('closed');
  });

  it('fails when the site refuses the delivery', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ error: 'bad_signature' }, { status: 401 })));
    const run = live?.run(readingPage(3)).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(2000);
    expect(String(await run)).toContain('401');
  });
});
