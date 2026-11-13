import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IPHONE_CASES, type SafariPage } from '../phones/iphone-cases.ts';
import { t, type Locale } from '../../apps/web/src/i18n/t.ts';
import { legalLines, legalLocale } from '../../apps/web/src/legal/legal.ts';

/**
 * Each case of the iPhone copy checks what its Playwright twin checks
 * (shyden-labs/ShyTalk#112): here Safari is a stand-in page that behaves as
 * the site should, and each test breaks one thing a case must catch.
 */

// The real test mailbox is stood in: a unit test reaches no IMAP server.
const mailbox = vi.hoisted(() => ({
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
    cspRefusals: () => Promise.resolve([]),
    attribute: (selector, name) =>
      Promise.resolve(selector === 'html' && name === 'lang' ? (onLegalPage ? legalLocale(locale) : lang) : null),
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
    axeViolations: () => Promise.resolve([]),
    ...broken,
  };
}

const kind = (title: string): string => title.replace(/^[^:]+: /, '').split(' in ')[0] ?? '';
const langOf = (title: string): string => title.split(':')[0] ?? '';
const cases = (start: string) => IPHONE_CASES.filter(({ title }) => kind(title).startsWith(start));

describe('the iPhone cases', () => {
  it.each(IPHONE_CASES.filter(({ title }) => langOf(title) in LOCALE).map((c) => [c.title, c] as const))(
    '%s: passes on the site as it should be',
    async (_, c) => {
      const page = safari(langOf(c.title));
      await expect(c.run(page)).resolves.toBeUndefined();
      expect(page.visited[0]?.startsWith(PREFIX[langOf(c.title)] ?? '?')).toBe(true);
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
          attribute: () => Promise.resolve(tapped.length === 0 ? lang : legalLocale(locale)),
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
      attribute: () => Promise.resolve(tapped ? 'fr' : lang),
    });
    await expect(c.run(page)).rejects.toThrow(/'fr'/);
  });

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
    await journey().run(page);
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

  /** Safari on the account pages as they should be: the notice shows once a recovery started, until it is cancelled. */
  function accountPages(overrides: { notice?: (pending: boolean) => boolean; noticeText?: string } = {}) {
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
      isVisible: (selector) => Promise.resolve(selector === NOTICE ? (overrides.notice ?? ((shown) => shown))(pending) : false),
      text: (selector) => {
        if (selector === '[data-testid="totp-secret"]') return Promise.resolve('JBSWY3DPEHPK3PXP');
        if (selector === '[data-testid="recovery-codes"]')
          return Promise.resolve(Array.from({ length: 10 }, () => 'AAAA-AAAA-AAAA-AAAA').join(' '));
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
  async function run(page: SafariPage): Promise<void> {
    const state = { settled: false };
    const running = journey()
      .run(page)
      .finally(() => {
        state.settled = true;
      });
    running.catch(() => undefined);
    // Each wait sets its next timer only after its look answers, so time moves a second at a time.
    for (let second = 0; second < 70 && !state.settled; second += 1) await vi.advanceTimersByTimeAsync(1_000);
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
    await run(page);
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
    await expect(run(page)).rejects.toThrow('waited 60 s for the recovery code mail');
  });
});
