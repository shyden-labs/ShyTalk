import { describe, it, expect, vi, afterEach } from 'vitest';
import { runCases, phoneVerdict, capabilities, runPhones, type PhoneDeps } from '../phones/run.ts';
import type { IphoneCase, SafariPage } from '../phones/iphone-cases.ts';

/**
 * The phone run (shyden-labs/ShyTalk#112 AC4, AC6): one command runs the smoke
 * suite on the OnePlus (Playwright over adb) and its Appium copy on the iPhone
 * Air, then holds both phones to the CI browsers' total with nothing skipped
 * or failed. Every process and request is stood in here.
 */

const page = {} as SafariPage;
const passing = (title: string): IphoneCase => ({ title, run: () => Promise.resolve() });
const failing = (title: string, message: string): IphoneCase => ({ title, run: () => Promise.reject(new Error(message)) });

/** A Playwright JSON report of `titles` on the OnePlus, each with `status`. */
const oneplusReport = (titles: string[], status = 'expected') => ({
  suites: [{ title: 'site.spec.ts', specs: titles.map((title) => ({ title, tests: [{ projectName: 'oneplus', status }] })) }],
});

describe('runCases', () => {
  it('runs every case in order, past a failure, recording each outcome and why', async () => {
    const results = await runCases([passing('a'), failing('b', 'expected 200, got 404'), passing('c')], page);
    expect(results).toEqual([
      { title: 'a', status: 'expected' },
      { title: 'b', status: 'unexpected', error: 'expected 200, got 404' },
      { title: 'c', status: 'expected' },
    ]);
  });
});

describe('phoneVerdict', () => {
  it('passes when both phones ran the CI total and every test passed, printing each total', () => {
    const verdict = phoneVerdict(
      oneplusReport(['a', 'b']),
      [
        { title: 'a', status: 'expected' },
        { title: 'b', status: 'expected' },
      ],
      2,
    );
    expect(verdict).toEqual({ lines: ['oneplus: 2 tests, 0 skipped', 'iphone-air: 2 tests, 0 skipped'], errors: [] });
  });

  it('fails on a phone short of the CI total', () => {
    const verdict = phoneVerdict(oneplusReport(['a', 'b']), [{ title: 'a', status: 'expected' }], 2);
    expect(verdict.errors).toContain('iphone-air ran 1 tests, the CI browsers each run 2');
  });

  it('fails naming each failed test on either phone, with the iPhone’s reason', () => {
    const verdict = phoneVerdict(
      oneplusReport(['a'], 'unexpected'),
      [{ title: 'a', status: 'unexpected', error: 'no visible navigation' }],
      1,
    );
    expect(verdict.errors).toEqual(['oneplus failed "a"', 'iphone-air failed "a": no visible navigation']);
  });

  it('fails on a skipped test, and on a flaky one, which a retry would hide', () => {
    expect(phoneVerdict(oneplusReport(['a'], 'skipped'), [{ title: 'a', status: 'expected' }], 1).errors).toContain('oneplus skipped "a"');
    expect(phoneVerdict(oneplusReport(['a'], 'flaky'), [{ title: 'a', status: 'expected' }], 1).errors).toContain('oneplus failed "a"');
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
    forward: step('forward', 'http://127.0.0.1:9333'),
    unforward: step('unforward'),
    playwright: step('playwright', 0),
    readOneplusReport: () => (steps.push('read report'), Promise.resolve(oneplusReport(['a']))),
    iphoneUdid: step('udid', 'UDID-1'),
    startAppium: step('start appium'),
    openSession: step('open session', 's1'),
    page: () => (steps.push('page'), page),
    closeSession: step('close session'),
    stopAppium: step('stop appium'),
    cases: [passing('a')],
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
      cases: [{ title: 'a', run: () => (seen.push(process.env.TEST_MAILBOX_PASSWORD), Promise.resolve()) }],
    });
    await expect(runPhones('https://site.example', d)).resolves.toBe(0);
    expect(seen).toEqual(['secret', 'secret']);
  });

  it('fails naming why, before touching a phone, when the Keychain gives no password', async () => {
    const d = deps({ mailboxPassword: () => Promise.reject(new Error('security: item not found')) });
    await expect(runPhones('https://site.example', d)).resolves.toBe(1);
    expect(d.steps).toEqual(['print phone-smoke: security: item not found']);
  });

  it('runs the OnePlus, then the iPhone, then prints the verdict, and passes', async () => {
    const d = deps();
    await expect(runPhones('https://site.example', d)).resolves.toBe(0);
    expect(d.steps).toEqual([
      'mailbox password',
      'forward',
      'playwright https://site.example http://127.0.0.1:9333',
      'unforward',
      'read report',
      'udid',
      'start appium',
      'open session UDID-1',
      'page',
      'close session s1',
      'stop appium',
      'print iphone-air: a passed',
      'print oneplus: 1 tests, 0 skipped',
      'print iphone-air: 1 tests, 0 skipped',
    ]);
  });

  it('refuses an address that is not https, before touching a phone', async () => {
    const d = deps();
    await expect(runPhones('http://site.example', d)).resolves.toBe(1);
    expect(d.steps).toEqual(['print phone-smoke: the address must start with https://, not http://site.example']);
  });

  it('fails, printing why, when a phone fails a test', async () => {
    const d = deps({ cases: [failing('a', 'no visible navigation')] });
    await expect(runPhones('https://site.example', d)).resolves.toBe(1);
    expect(d.steps).toContain('print iphone-air: a FAILED: no visible navigation');
    expect(d.steps).toContain('print phone-smoke: iphone-air failed "a": no visible navigation');
  });

  it('removes the adb forward when Playwright cannot run, and fails naming why', async () => {
    const d = deps({ playwright: () => Promise.reject(new Error('npx not found')) });
    await expect(runPhones('https://site.example', d)).resolves.toBe(1);
    expect(d.steps).toEqual(['mailbox password', 'forward', 'unforward', 'print phone-smoke: npx not found']);
  });

  it('closes the session and stops Appium when a case throws outside its checks', async () => {
    const d = deps({
      page: () => {
        throw new Error('Safari went away');
      },
    });
    await expect(runPhones('https://site.example', d)).resolves.toBe(1);
    expect(d.steps.slice(-3)).toEqual(['close session s1', 'stop appium', 'print phone-smoke: Safari went away']);
  });

  it('stops Appium when no session opens', async () => {
    const d = deps({ openSession: () => Promise.reject(new Error('WebDriverAgent did not start')) });
    await expect(runPhones('https://site.example', d)).resolves.toBe(1);
    expect(d.steps.slice(-2)).toEqual(['stop appium', 'print phone-smoke: WebDriverAgent did not start']);
    expect(d.steps.some((s) => s.startsWith('close session'))).toBe(false);
  });

  it('fails when the OnePlus run itself failed, even if its report reads clean', async () => {
    const d = deps({ playwright: () => Promise.resolve(1) });
    await expect(runPhones('https://site.example', d)).resolves.toBe(1);
    expect(d.steps).toContain('print phone-smoke: Playwright exited 1 on the OnePlus');
  });

  it('runs the iPhone cases against the address it was given', async () => {
    const pageFor = vi.fn(() => page);
    await runPhones('https://other.example', deps({ page: pageFor }));
    expect(pageFor).toHaveBeenCalledWith('s1', 'https://other.example');
  });
});
