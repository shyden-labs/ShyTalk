/**
 * The phone run (shyden-labs/ShyTalk#112): the smoke suite on Chrome on the
 * OnePlus (Playwright over adb, tests/smoke/oneplus.config.ts) and its Appium
 * copy on Safari on the iPhone Air (tests/phones/iphone-cases.ts), both
 * against one deployed address (Shyden's choice 2026-11-06: TEST before each
 * release, DEV until TEST serves pages). It fails unless both phones ran the
 * CI browsers' total and every test passed, with nothing skipped.
 *
 * The steps that touch a phone or a process are `PhoneDeps`
 * (tests/phones/devices.ts gives the real ones), so the order and the
 * clean-up are unit-tested.
 */
import { assertionTotals, smokeTotals } from '../../scripts/smoke-totals.ts';
import { countingCheck } from './check.ts';
import type { IphoneCase, SafariPage } from './iphone-cases.ts';

export interface CaseResult {
  title: string;
  status: 'expected' | 'unexpected';
  error?: string;
  /** The checks the case ran, failed ones too (shyden-labs/ShyTalk#180 AC7). */
  assertions: number;
}

interface Report {
  suites: { title: string; specs: { title: string; tests: { projectName: string; status: string }[] }[] }[];
}

export interface PhoneDeps {
  /** The test mailbox's password, from this Mac's Keychain (service shytalk-test-mailbox). */
  mailboxPassword(): Promise<string>;
  /** Forwards Chrome's DevTools socket on the OnePlus; answers the endpoint. */
  forward(): Promise<string>;
  unforward(): Promise<void>;
  /** Runs the Playwright suite on the OnePlus; answers its exit code. */
  playwright(address: string, endpoint: string): Promise<number>;
  readOneplusReport(): Promise<Report>;
  /** The checks each test ran on the OnePlus, from tests/smoke/assertion-counts.ts. */
  readOneplusCounts(): Promise<Record<string, number>>;
  iphoneUdid(): Promise<string>;
  startAppium(): Promise<void>;
  openSession(udid: string): Promise<string>;
  page(session: string, address: string): SafariPage;
  closeSession(session: string): Promise<void>;
  stopAppium(): Promise<void>;
  cases: IphoneCase[];
  print(line: string): void;
}

export const PHONES = ['oneplus', 'iphone-air'] as const;

/** Every case in order, each counting its own checks, a failure recorded with its reason and the run carried on. */
export async function runCases(cases: IphoneCase[], page: SafariPage): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const { title, run } of cases) {
    const check = countingCheck();
    try {
      await page.freshStart();
      await run(page, check);
      results.push({ title, status: 'expected', assertions: check.count });
    } catch (error) {
      results.push({ title, status: 'unexpected', error: (error as Error).message, assertions: check.count });
    }
  }
  return results;
}

/**
 * Both phones' totals against the CI browsers' `expected`, every failed test on either, named, and each test's checks
 * on both phones, which must be equal (shyden-labs/ShyTalk#180 AC7).
 */
export function phoneVerdict(
  oneplus: Report,
  oneplusCounts: Record<string, number>,
  iphone: CaseResult[],
  expected: number,
): { lines: string[]; errors: string[] } {
  const report: Report = {
    suites: [
      ...oneplus.suites,
      { title: 'iphone-cases', specs: iphone.map(({ title, status }) => ({ title, tests: [{ projectName: 'iphone-air', status }] })) },
    ],
  };
  const { lines, errors } = smokeTotals(report, PHONES, expected);
  const counts = assertionTotals(
    { oneplus: oneplusCounts, 'iphone-air': Object.fromEntries(iphone.map(({ title, assertions }) => [title, assertions])) },
    PHONES,
  );
  lines.push(...counts.lines);
  errors.push(...counts.errors);
  for (const suite of oneplus.suites) {
    for (const { title, tests } of suite.specs) {
      if (tests.some(({ status }) => status === 'unexpected' || status === 'flaky')) errors.push(`oneplus failed "${title}"`);
    }
  }
  for (const { title, status, error } of iphone) if (status === 'unexpected') errors.push(`iphone-air failed "${title}": ${error ?? ''}`);
  return { lines, errors };
}

/** Safari on that iPhone, WebDriverAgent signed by this Mac's Apple Development identity (measured 2026-11-06). */
export function capabilities(udid: string): Record<string, unknown> {
  return {
    platformName: 'iOS',
    browserName: 'Safari',
    'appium:automationName': 'XCUITest',
    'appium:udid': udid,
    'appium:xcodeOrgId': '2YV2Y2GFD3',
    'appium:xcodeSigningId': 'Apple Development',
    'appium:updatedWDABundleId': 'com.shyden.WebDriverAgentRunner',
    'appium:showSafariConsoleLog': true,
    'appium:showSafariNetworkLog': true,
    // A press is a real tap on the screen, never a script's click (global rule 2026-10-31).
    'appium:nativeWebTap': true,
    'appium:wdaLaunchTimeout': 240_000,
    'appium:newCommandTimeout': 120,
  };
}

export async function runPhones(address: string, d: PhoneDeps): Promise<number> {
  if (!address.startsWith('https://')) {
    d.print(`phone-smoke: the address must start with https://, not ${address}`);
    return 1;
  }
  const errors: string[] = [];
  try {
    // Both phones' closed-testing journey reads its mail from the real test mailbox (shyden-labs/ShyTalk#150):
    // the OnePlus's Playwright inherits this environment, and the iPhone's cases run in this process.
    process.env.TEST_MAILBOX_PASSWORD = await d.mailboxPassword();
    const endpoint = await d.forward();
    let code: number;
    try {
      code = await d.playwright(address, endpoint);
    } finally {
      await d.unforward();
    }
    if (code !== 0) errors.push(`Playwright exited ${String(code)} on the OnePlus`);
    const oneplus = await d.readOneplusReport();
    const oneplusCounts = await d.readOneplusCounts();
    const udid = await d.iphoneUdid();
    await d.startAppium();
    let iphone: CaseResult[];
    try {
      const session = await d.openSession(udid);
      try {
        iphone = await runCases(d.cases, d.page(session, address));
      } finally {
        await d.closeSession(session);
      }
    } finally {
      await d.stopAppium();
    }
    for (const { title, status, error } of iphone)
      d.print(status === 'expected' ? `iphone-air: ${title} passed` : `iphone-air: ${title} FAILED: ${error ?? ''}`);
    const verdict = phoneVerdict(oneplus, oneplusCounts, iphone, d.cases.length);
    for (const line of verdict.lines) d.print(line);
    errors.push(...verdict.errors);
  } catch (error) {
    d.print(`phone-smoke: ${(error as Error).message}`);
    return 1;
  }
  for (const error of errors) d.print(`phone-smoke: ${error}`);
  return errors.length === 0 ? 0 : 1;
}
