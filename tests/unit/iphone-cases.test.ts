import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IPHONE_CASES, type SafariPage } from '../phones/iphone-cases.ts';
import { countingCheck } from '../phones/check.ts';
import { t, type Locale } from '../../apps/web/src/i18n/t.ts';
import { legalLines, legalLocale } from '../../apps/web/src/legal/legal.ts';

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
vi.mock('../phones/test-mailbox.ts', () => mailbox);

// The authenticator's code is stood in: the real one awaits WebCrypto outside fake time, so a journey's waits on fake
// time could start after the test had moved its clock on (a race seen on CI, shyden-labs/ShyTalk#180).
vi.mock('../support/totp.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../support/totp.ts')>()),
  totpAt: vi.fn(() => Promise.resolve('123456')),
}));

const LOCALE: Record<string, Locale> = { en: 'en', id: 'id', th: 'th', vi: 'vi', 'zh-Hans': 'zh' };
const PREFIX: Record<string, string> = { en: '', id: '/id', th: '/th', vi: '/vi', 'zh-Hans': '/zh' };

/** What each selector holds on the site as it should be. */
function selectorText(locale: Locale, selector: string): string {
  const line = /data-line="(\w+)"/.exec(selector)?.[1];
  if (line !== undefined) return t(locale, `closedTesting.${line}`);
  if (selector === 'label[for="apply-email"]') return t(locale, 'closedTesting.emailLabel');
  if (selector === 'label[for="apply-adult"]') return t(locale, 'closedTesting.adultLabel');
  if (selector === '#apply-submit') return t(locale, 'closedTesting.submit');
  if (selector === '#confirm-button') return t(locale, 'closedTesting.confirmButton');
  if (selector === '[data-governs]') return legalLines(legalLocale(locale)).common.governs;
  if (selector.startsWith('[data-english-only')) return t(locale, 'footer.englishOnly');
  return t(locale, 'home.heading');
}

/** The viewport tag every page carries: the keyboard resizes the page, never pans over it (shyden-labs/ShyTalk#189). */
const VIEWPORT_TAG = 'meta[name="viewport"]';
const VIEWPORT = 'width=device-width, initial-scale=1, interactive-widget=resizes-content';

/** Safari showing the site as it should be, in `lang`; `broken` replaces one answer. */
function safari(lang: string, broken: Partial<SafariPage> = {}): SafariPage & { visited: string[] } {
  const locale = LOCALE[lang] ?? 'en';
  const visited: string[] = [];
  let onLegalPage = false;
  return {
    visited,
    goto: (path) => {
      visited.push(path);
      return Promise.resolve(path.endsWith('/no-such-page') ? 404 : 200);
    },
    freshStart: () => Promise.resolve(),
    cspRefusals: () => Promise.resolve([]),
    attribute: (selector, name) =>
      Promise.resolve(
        selector === 'html' && name === 'lang'
          ? onLegalPage
            ? legalLocale(locale)
            : lang
          : selector === VIEWPORT_TAG && name === 'content'
            ? VIEWPORT
            : null,
      ),
    isVisible: (selector) => Promise.resolve(selector !== '[data-english-only]:not([hidden])'),
    text: (selector) => Promise.resolve(selectorText(locale, selector)),
    tap: () => {
      onLegalPage = true;
      return Promise.resolve();
    },
    type: () => Promise.resolve(),
    waitForText: () => Promise.resolve(),
    visibleLinks: (name) => Promise.resolve(name === t(locale, 'home.apply') ? 1 : 0),
    links: (name) => Promise.resolve(name === t(locale, 'home.apply') ? 1 : 0),
    count: () => Promise.resolve(0),
    axeViolations: () => Promise.resolve([]),
    ...broken,
  };
}

const kind = (title: string): string => title.replace(/^[^:]+: /, '').split(' in ')[0] ?? '';
const langOf = (title: string): string => title.split(':')[0] ?? '';
const cases = (start: string) => IPHONE_CASES.filter(({ title }) => kind(title).startsWith(start));

/**
 * The checks each test's Playwright twin ran on CI, per test (shyden-labs/ShyTalk#180 AC7):
 * read from smoke-totals on PR #181's web-smoke job, the same on chromium, firefox and webkit.
 * The home page runs three more where its legal pages carry the "English only" note.
 */
const CI_ASSERTIONS: Record<string, Record<string, number>> = {
  'the home page answers 200': { en: 28, id: 28, th: 31, vi: 31, 'zh-Hans': 31 },
  'an unknown page answers 404': { en: 4, id: 4, th: 4, vi: 4, 'zh-Hans': 4 },
  'the closed-testing page shows the form and every statement': { en: 17, id: 17, th: 17, vi: 17, 'zh-Hans': 17 },
  'the confirm page passes axe, and its button with a dead link shows link-expired': { en: 4, id: 4, th: 4, vi: 4, 'zh-Hans': 4 },
};

describe('the iPhone cases', () => {
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
      expect(page.visited).toEqual([home, home, home]);
      const broken = c.run(safari(lang, { goto: () => Promise.resolve(500), axeViolations: () => Promise.resolve(['color-contrast: 1']) }));
      await expect(broken).rejects.toThrow(/500[\s\S]*color-contrast: 1/);
    },
  );

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
      await c.run(
        safari(lang, {
          // The home page is in this language; a legal page, once a link was tapped, in its legal language.
          attribute: (selector) => Promise.resolve(selector === VIEWPORT_TAG ? VIEWPORT : tapped.length === 0 ? lang : legalLocale(locale)),
          tap: (selector) => {
            tapped.push(selector);
            return Promise.resolve();
          },
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
      expect(tapped).toEqual(['privacy', 'terms', 'guidelines'].map((doc) => `footer a[data-legal="${doc}"]`));
      expect(waited).toEqual([words.privacy.title, words.terms.title, words.guidelines.title]);
      expect(axe).toBe(4);
    },
  );

  it.each(named('the home page answers'))('%s: fails when a legal page is in the wrong language', async (_, c) => {
    const lang = langOf(c.title);
    let tapped = false;
    const page = safari(lang, {
      tap: () => ((tapped = true), Promise.resolve()),
      attribute: (selector) => Promise.resolve(selector === VIEWPORT_TAG ? VIEWPORT : tapped ? 'fr' : lang),
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
  const H1 = 'h1, [role="heading"][aria-level="1"]';
  const CODES = '[data-testid="recovery-codes"] li, [data-testid="recovery-codes"] [role="listitem"]';
  const DEVICES = '[data-testid="devices"] li, [data-testid="devices"] [role="listitem"]';

  /** Safari on the account pages as they should be: the notice shows once a recovery started, until it is cancelled. */
  function accountPages(
    overrides: {
      notice?: (pending: boolean) => boolean;
      noticeText?: string;
      shown?: (selector: string) => boolean;
      count?: (selector: string) => number | undefined;
      firstCode?: string;
    } = {},
  ) {
    const steps: string[] = [];
    let started = false;
    let pending = false;
    const page = safari('en', {
      goto: (path) => {
        steps.push(`goto ${path}`);
        if (path === '/account/' && started) pending = true;
        return Promise.resolve(200);
      },
      type: (selector, text) => (steps.push(`type ${selector} ${text}`), Promise.resolve()),
      tap: (selector) => {
        steps.push(`tap ${selector}`);
        if (selector === '#code-submit' && steps.includes('goto /recover')) started = true;
        if (selector === '#recovery-cancel') pending = false;
        return Promise.resolve();
      },
      waitForText: (selector, text) => (steps.push(`wait ${selector} ${text}`), Promise.resolve()),
      isVisible: (selector) => {
        if (selector === NOTICE) return Promise.resolve((overrides.notice ?? ((shown) => shown))(pending));
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
          return Promise.resolve(t('en', 'account.recoveryStarted').replace('{completesAt}', '14 Nov 2026, 10:00'));
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
    // Its twin on CI ran 19 (shyden-labs/ShyTalk#180 AC7).
    expect(check.count).toBe(19);
    const address = 'box+iphone-air-1700000000000@mail.test';
    expect(steps.slice(steps.indexOf('goto /recover'))).toEqual([
      'goto /recover',
      `type #email-address ${address}`,
      'tap #email-submit',
      `wait #email-answer ${t('en', 'account.sent')}`,
      'type #email-code 222222',
      'tap #code-submit',
      'goto /account/',
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
    expect(check.count).toBe(19);
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
    expect(check.count).toBe(19);
  });

  it('waits for the authenticator to read On, which the account page fills in after its heading shows (#190 run 8)', async () => {
    const { page, steps } = accountPages();
    const text = page.text.bind(page);
    page.text = (selector) => (selector === '[data-testid="method-authenticator"]' ? Promise.resolve('') : text(selector));
    const check = countingCheck();
    await run(page, check);
    expect(check.count).toBe(19);
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
    expect(check.count).toBe(19);
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

  it('fails when the notice says something else', async () => {
    const { page } = accountPages({ noticeText: 'Something else' });
    await expect(run(page)).rejects.toThrow('Something else');
  });

  it('fails naming the notice when it stays after the cancel', async () => {
    let shown = false;
    const { page } = accountPages({ notice: (pending) => (shown ||= pending) });
    await expect(run(page)).rejects.toThrow('waited 60 s for the recovery notice to hide');
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
          selector === '#email-code' ? tapped === '#email-submit' : selector === '#cancel-answer' && tapped === '#cancel-button',
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
    // Its twin on CI ran 4 (shyden-labs/ShyTalk#180 AC7).
    expect(check.count).toBe(4);
  });

  it('fails naming the code field when it never shows', async () => {
    const { page } = recoveryPages({ isVisible: () => Promise.resolve(false) });
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
    expect(check.count).toBe(31);
  });

  it('fails naming the note when it is not shown within 15 s', async () => {
    await expect(run(delayedNote(15_001))).rejects.toThrow('no visible note');
  });
});
