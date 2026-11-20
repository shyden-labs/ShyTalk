import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { runCases, phoneVerdict, capabilities, runPhones, type PhoneDeps, WDA_LOCAL_PORT } from '../phones/run.ts';
import type { IphoneCase, SafariPage } from '../phones/iphone-cases.ts';
import { countingCheck } from '../phones/check.ts';

/** Each environment's address, as the Worker's own settings give it: tests never name a door host. */
const WORKER = JSON.parse(readFileSync('workers/web/wrangler.json', 'utf8')) as {
  env: Record<'dev' | 'test' | 'prod', { vars: { SITE_ORIGIN: string } }>;
};
const DEV_ORIGIN = WORKER.env.dev.vars.SITE_ORIGIN;
const TEST_ORIGIN = WORKER.env.test.vars.SITE_ORIGIN;
const PROD_ORIGIN = WORKER.env.prod.vars.SITE_ORIGIN;
/** An origin with the site's user and the stand-in site password in it, as the iPhone is given it. */
const withPassword = (origin: string): string => origin.replace('https://', 'https://shytalk:site-pw@');

/**
 * The phone run (shyden-labs/ShyTalk#112 AC4, AC6): one command runs the smoke
 * suite on the OnePlus (Playwright over adb) and its Appium copy on the iPhone
 * Air, then holds both phones to the CI browsers' total with nothing skipped
 * or failed. Every process and request is stood in here.
 */

const page = { freshStart: () => Promise.resolve() } as unknown as SafariPage;
const passing = (title: string): IphoneCase => ({ title, run: () => Promise.resolve() });
const failing = (title: string, message: string): IphoneCase => ({ title, run: () => Promise.reject(new Error(message)) });
/** A case running `n` passing checks, then failing with `message` if one is given. */
const checking = (title: string, n: number, message?: string): IphoneCase => ({
  title,
  run: (_page, check = countingCheck()) => {
    for (let i = 0; i < n; i++) check.ok(true);
    return message === undefined ? Promise.resolve() : Promise.reject(new Error(message));
  },
});

/** A Playwright JSON report of `titles` on the OnePlus, each with `status`. */
const oneplusReport = (titles: string[], status = 'expected') => ({
  suites: [{ title: 'site.spec.ts', specs: titles.map((title) => ({ title, tests: [{ projectName: 'oneplus', status }] })) }],
});

describe('runCases', () => {
  it('runs every case in order, past a failure, recording each outcome and why', async () => {
    const results = await runCases([passing('a'), failing('b', 'expected 200, got 404'), passing('c')], page);
    expect(results).toEqual([
      { title: 'a', status: 'expected', assertions: 0 },
      { title: 'b', status: 'unexpected', error: 'expected 200, got 404', assertions: 0 },
      { title: 'c', status: 'expected', assertions: 0 },
    ]);
  });

  it('counts the checks each case ran, apart, a failed case counting those before it failed (shyden-labs/ShyTalk#180)', async () => {
    const results = await runCases([checking('a', 3), checking('b', 2, 'no visible navigation'), checking('c', 1)], page);
    expect(results.map(({ title, assertions }) => [title, assertions])).toEqual([
      ['a', 3],
      ['b', 2],
      ['c', 1],
    ]);
  });
});

describe('runCases: each case starts fresh', () => {
  it('starts each case from a fresh page, as each Playwright test gets a fresh context: run 8 left Safari signed in (#190)', async () => {
    const steps: string[] = [];
    const fresh = { freshStart: () => (steps.push('fresh'), Promise.resolve()) } as unknown as SafariPage;
    const stepping = (title: string): IphoneCase => ({ title, run: () => (steps.push(title), Promise.resolve()) });
    await runCases([stepping('a'), stepping('b')], fresh);
    expect(steps).toEqual(['fresh', 'a', 'fresh', 'b']);
  });

  it('records a case whose fresh start fails as failed, naming why, and runs the next', async () => {
    const fresh = { freshStart: () => Promise.reject(new Error('cookies not cleared')) } as unknown as SafariPage;
    const results = await runCases([passing('a'), passing('b')], fresh);
    expect(results).toEqual([
      { title: 'a', status: 'unexpected', error: 'cookies not cleared', assertions: 0 },
      { title: 'b', status: 'unexpected', error: 'cookies not cleared', assertions: 0 },
    ]);
  });
});

describe('phoneVerdict', () => {
  it('passes when both phones ran the CI total and every test passed, printing each total', () => {
    const verdict = phoneVerdict(
      oneplusReport(['a', 'b']),
      { a: 3, b: 1 },
      [
        { title: 'a', status: 'expected', assertions: 3 },
        { title: 'b', status: 'expected', assertions: 1 },
      ],
      2,
    );
    expect(verdict).toEqual({
      lines: [
        'oneplus: 2 tests, 0 skipped',
        'iphone-air: 2 tests, 0 skipped',
        'assertions in "a": oneplus 3, iphone-air 3',
        'assertions in "b": oneplus 1, iphone-air 1',
      ],
      errors: [],
    });
  });

  it('fails on a test whose checks the phones counted differently, or one phone did not count (shyden-labs/ShyTalk#180)', () => {
    const verdict = phoneVerdict(
      oneplusReport(['a', 'b']),
      { a: 3 },
      [
        { title: 'a', status: 'expected', assertions: 2 },
        { title: 'b', status: 'expected', assertions: 1 },
      ],
      2,
    );
    expect(verdict.errors).toEqual([
      '"a" ran different numbers of assertions: oneplus 3, iphone-air 2',
      '"b" ran different numbers of assertions: oneplus none, iphone-air 1',
    ]);
  });

  it('fails on a phone short of the CI total', () => {
    const verdict = phoneVerdict(oneplusReport(['a', 'b']), { a: 0 }, [{ title: 'a', status: 'expected', assertions: 0 }], 2);
    expect(verdict.errors).toContain('iphone-air ran 1 tests, the CI browsers each run 2');
  });

  it('fails naming each failed test on either phone, with the iPhone’s reason', () => {
    const verdict = phoneVerdict(
      oneplusReport(['a'], 'unexpected'),
      { a: 0 },
      [{ title: 'a', status: 'unexpected', error: 'no visible navigation', assertions: 0 }],
      1,
    );
    expect(verdict.errors).toEqual(['oneplus failed "a"', 'iphone-air failed "a": no visible navigation']);
  });

  it('fails on a skipped test, and on a flaky one, which a retry would hide', () => {
    expect(
      phoneVerdict(oneplusReport(['a'], 'skipped'), { a: 0 }, [{ title: 'a', status: 'expected', assertions: 0 }], 1).errors,
    ).toContain('oneplus skipped "a"');
    expect(phoneVerdict(oneplusReport(['a'], 'flaky'), { a: 0 }, [{ title: 'a', status: 'expected', assertions: 0 }], 1).errors).toContain(
      'oneplus failed "a"',
    );
  });
});

describe('capabilities', () => {
  it('asks Appium for Safari on that iPhone, signed by this Mac’s team, with both logs and never the performance log', () => {
    const caps = capabilities('00008150-ABC');
    expect(caps).toMatchObject({
      platformName: 'iOS',
      browserName: 'Safari',
      'appium:automationName': 'XCUITest',
      'appium:udid': '00008150-ABC',
      'appium:xcodeOrgId': '2YV2Y2GFD3',
      'appium:xcodeSigningId': 'Apple Development',
      'appium:updatedWDABundleId': 'com.shyden.WebDriverAgentRunner',
      'appium:showSafariConsoleLog': true,
      // A press is a real tap on the screen, never a script's click (global rule 2026-10-31).
      'appium:nativeWebTap': true,
      'appium:showSafariNetworkLog': true,
    });
    // Measured 2026-11-06: the performance log crashes appium-xcuitest-driver 11.11.2.
    expect(caps).not.toHaveProperty('appium:enablePerformanceLogging');
  });

  it('gives the real iPhone its own local WebDriverAgent port, never the simulators’ 8100 (shyden-labs/ShyTalk#224)', () => {
    // 2026-11-16: a simulator's WebDriverAgent held the Mac's port 8100 and the iPhone's session was refused.
    expect(capabilities('00008150-ABC')).toMatchObject({ 'appium:wdaLocalPort': WDA_LOCAL_PORT });
    expect(WDA_LOCAL_PORT).toBe(8199);
  });
});

/** Every step the run takes, as a stand-in that logs each one. */
function deps(overrides: Partial<PhoneDeps> = {}): PhoneDeps & { steps: string[] } {
  const steps: string[] = [];
  const step =
    <T = undefined>(name: string, answer?: T) =>
    (...args: unknown[]): Promise<T> => {
      steps.push(`${name} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`.trim());
      return Promise.resolve(answer as T);
    };
  return {
    steps,
    mailboxPassword: step('mailbox password', 'secret'),
    sitePassword: step('site password', 'site-pw'),
    forward: step('forward', 'http://127.0.0.1:9333'),
    unforward: step('unforward'),
    playwright: step('playwright', 0),
    readOneplusReport: () => (steps.push('read report'), Promise.resolve(oneplusReport(['a']))),
    readOneplusCounts: () => (steps.push('read counts'), Promise.resolve({ a: 2 })),
    iphoneUdid: step('udid', 'UDID-1'),
    startAppium: step('start appium'),
    openSession: step('open session', 's1'),
    page: (_session: string, address: string) => (steps.push(`page ${address}`), page),
    closeSession: step('close session'),
    stopAppium: step('stop appium'),
    cases: [checking('a', 2)],
    print: (line: string) => void steps.push(`print ${line}`),
    ...overrides,
  };
}

describe('runPhones', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hands the test mailbox’s password from the Keychain to both phones’ runs', async () => {
    vi.stubEnv('TEST_MAILBOX_PASSWORD', undefined);
    const seen: (string | undefined)[] = [];
    const d = deps({
      playwright: () => (seen.push(process.env.TEST_MAILBOX_PASSWORD), Promise.resolve(0)),
      readOneplusCounts: () => Promise.resolve({ a: 0 }),
      cases: [{ title: 'a', run: () => (seen.push(process.env.TEST_MAILBOX_PASSWORD), Promise.resolve()) }],
    });
    await expect(runPhones(DEV_ORIGIN, d)).resolves.toBe(0);
    expect(seen).toEqual(['secret', 'secret']);
  });

  it.each([
    [DEV_ORIGIN, 'dev'],
    [TEST_ORIGIN, 'test'],
  ])(
    'tells both phones’ runs that %s was built for %s, so a preview’s addresses are checked on it (shyden-labs/ShyTalk#198)',
    async (address, environment) => {
      vi.stubEnv('SITE_ENVIRONMENT', undefined);
      const seen: (string | undefined)[] = [];
      const d = deps({
        playwright: () => (seen.push(process.env.SITE_ENVIRONMENT), Promise.resolve(0)),
        readOneplusCounts: () => Promise.resolve({ a: 0 }),
        cases: [{ title: 'a', run: () => (seen.push(process.env.SITE_ENVIRONMENT), Promise.resolve()) }],
      });
      await expect(runPhones(address, d)).resolves.toBe(0);
      expect(seen).toEqual([environment, environment]);
    },
  );

  it('refuses an address that no environment serves, naming it, before touching a phone', async () => {
    const d = deps();
    await expect(runPhones('https://site.example', d)).resolves.toBe(1);
    expect(d.steps).toEqual(['print phone-smoke: https://site.example is the SITE_ORIGIN of no environment in workers/web/wrangler.json']);
  });

  it('hands the environment’s site password from the Keychain to the OnePlus’s Playwright (shyden-labs/ShyTalk#262)', async () => {
    vi.stubEnv('SMOKE_SITE_PASSWORD', undefined);
    const seen: (string | undefined)[] = [];
    const d = deps({ playwright: () => (seen.push(process.env.SMOKE_SITE_PASSWORD), Promise.resolve(0)) });
    await expect(runPhones(TEST_ORIGIN, d)).resolves.toBe(0);
    expect(seen).toEqual(['site-pw']);
    expect(d.steps).toContain('site password test');
    expect(d.steps).toContain(`page ${withPassword(TEST_ORIGIN)}`);
  });

  it('asks the Keychain for no site password on production, which asks for none (shyden-labs/ShyTalk#262)', async () => {
    vi.stubEnv('SMOKE_SITE_PASSWORD', undefined);
    const seen: (string | undefined)[] = [];
    const d = deps({ playwright: () => (seen.push(process.env.SMOKE_SITE_PASSWORD), Promise.resolve(0)) });
    await expect(runPhones(PROD_ORIGIN, d)).resolves.toBe(0);
    expect(seen).toEqual([undefined]);
    expect(d.steps.filter((line) => line.startsWith('site password'))).toEqual([]);
    expect(d.steps).toContain(`page ${PROD_ORIGIN}`);
  });

  it('fails naming why, before touching a phone, when the Keychain gives no site password (shyden-labs/ShyTalk#262)', async () => {
    const d = deps({ sitePassword: () => Promise.reject(new Error('security: item not found')) });
    await expect(runPhones(DEV_ORIGIN, d)).resolves.toBe(1);
    expect(d.steps).toEqual(['mailbox password', 'print phone-smoke: security: item not found']);
  });

  it('fails naming why, before touching a phone, when the Keychain gives no password', async () => {
    const d = deps({ mailboxPassword: () => Promise.reject(new Error('security: item not found')) });
    await expect(runPhones(DEV_ORIGIN, d)).resolves.toBe(1);
    expect(d.steps).toEqual(['print phone-smoke: security: item not found']);
  });

  it('runs the OnePlus, then the iPhone, then prints the verdict, and passes', async () => {
    const d = deps();
    await expect(runPhones(DEV_ORIGIN, d)).resolves.toBe(0);
    expect(d.steps).toEqual([
      'mailbox password',
      'site password dev',
      'forward',
      `playwright ${DEV_ORIGIN} http://127.0.0.1:9333`,
      'unforward',
      'read report',
      'read counts',
      'udid',
      'start appium',
      "print phone-smoke: Appium's full log: test-results/appium.log",
      'open session UDID-1',
      `page ${withPassword(DEV_ORIGIN)}`,
      'close session s1',
      'stop appium',
      'print iphone-air: a passed',
      'print oneplus: 1 tests, 0 skipped',
      'print iphone-air: 1 tests, 0 skipped',
      'print assertions in "a": oneplus 2, iphone-air 2',
    ]);
  });

  it('refuses an address that is not https, before touching a phone', async () => {
    const d = deps();
    await expect(runPhones('http://site.example', d)).resolves.toBe(1);
    expect(d.steps).toEqual(['print phone-smoke: the address must start with https://, not http://site.example']);
  });

  it('gives the reason of a case that fails with something other than an Error', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point: a case rejecting with a bare string
    const d = deps({ cases: [{ title: 'a', run: () => Promise.reject('the page went away') }] });
    await expect(runPhones(DEV_ORIGIN, d)).resolves.toBe(1);
    expect(d.steps).toContain('print iphone-air: a FAILED: the page went away');
    expect(d.steps).toContain('print phone-smoke: iphone-air failed "a": the page went away');
  });

  it('fails, printing why, when a phone fails a test', async () => {
    const d = deps({ cases: [failing('a', 'no visible navigation')] });
    await expect(runPhones(DEV_ORIGIN, d)).resolves.toBe(1);
    expect(d.steps).toContain('print iphone-air: a FAILED: no visible navigation');
    expect(d.steps).toContain('print phone-smoke: iphone-air failed "a": no visible navigation');
    // The iPhone's reason is Appium's last word; its full log holds what led there (shyden-labs/ShyTalk#221).
    expect(d.steps.at(-1)).toBe("print phone-smoke: the iPhone's failures in Appium's full log: test-results/appium.log");
  });

  it('names no Appium log when only the OnePlus failed (shyden-labs/ShyTalk#221)', async () => {
    const d = deps({ readOneplusReport: () => Promise.resolve(oneplusReport(['a'], 'unexpected')) });
    await expect(runPhones(DEV_ORIGIN, d)).resolves.toBe(1);
    expect(d.steps.some((s) => s.includes("the iPhone's failures"))).toBe(false);
  });

  it('removes the adb forward when Playwright cannot run, and fails naming why', async () => {
    const d = deps({ playwright: () => Promise.reject(new Error('npx not found')) });
    await expect(runPhones(DEV_ORIGIN, d)).resolves.toBe(1);
    expect(d.steps).toEqual(['mailbox password', 'site password dev', 'forward', 'unforward', 'print phone-smoke: npx not found']);
  });

  it('closes the session and stops Appium when a case throws outside its checks', async () => {
    const d = deps({
      page: () => {
        throw new Error('Safari went away');
      },
    });
    await expect(runPhones(DEV_ORIGIN, d)).resolves.toBe(1);
    expect(d.steps.slice(-3)).toEqual([
      'close session s1',
      'stop appium',
      "print phone-smoke: Safari went away (Appium's full log: test-results/appium.log)",
    ]);
  });

  it('stops Appium when no session opens', async () => {
    const d = deps({ openSession: () => Promise.reject(new Error('WebDriverAgent did not start')) });
    await expect(runPhones(DEV_ORIGIN, d)).resolves.toBe(1);
    expect(d.steps.slice(-2)).toEqual([
      'stop appium',
      "print phone-smoke: WebDriverAgent did not start (Appium's full log: test-results/appium.log)",
    ]);
    expect(d.steps.some((s) => s.startsWith('close session'))).toBe(false);
  });

  it('fails when the OnePlus run itself failed, even if its report reads clean', async () => {
    const d = deps({ playwright: () => Promise.resolve(1) });
    await expect(runPhones(DEV_ORIGIN, d)).resolves.toBe(1);
    expect(d.steps).toContain('print phone-smoke: Playwright exited 1 on the OnePlus');
  });

  it('fails naming the test when the iPhone ran a different number of checks than the OnePlus (shyden-labs/ShyTalk#180)', async () => {
    const d = deps({ cases: [checking('a', 1)] });
    await expect(runPhones(DEV_ORIGIN, d)).resolves.toBe(1);
    expect(d.steps).toContain('print phone-smoke: "a" ran different numbers of assertions: oneplus 2, iphone-air 1');
  });

  it('fails naming why when the OnePlus counts cannot be read', async () => {
    const d = deps({ readOneplusCounts: () => Promise.reject(new Error('ENOENT: phone-oneplus-assertions.json')) });
    await expect(runPhones(DEV_ORIGIN, d)).resolves.toBe(1);
    expect(d.steps.at(-1)).toBe('print phone-smoke: ENOENT: phone-oneplus-assertions.json');
  });

  it('runs the iPhone cases against the address it was given, carrying the site password (shyden-labs/ShyTalk#262)', async () => {
    const pageFor = vi.fn(() => page);
    await runPhones(TEST_ORIGIN, deps({ page: pageFor }));
    expect(pageFor).toHaveBeenCalledWith('s1', withPassword(TEST_ORIGIN));
  });
});
