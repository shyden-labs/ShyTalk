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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertionTotals, smokeTotals } from '../../scripts/smoke-totals.ts';
import { countingCheck } from './check.ts';
import { environmentAt, type WranglerOrigins } from '../../apps/web/src/preview.ts';
import type { IphoneCase, SafariPage } from './iphone-cases.ts';

/** The Worker's settings, whose `SITE_ORIGIN` names each environment's address. */
const WRANGLER = fileURLToPath(new URL('../../workers/web/wrangler.json', import.meta.url));

/** One case's result: a failed case always carries its reason. */
export type CaseResult = {
  title: string;
  /** The checks the case ran, failed ones too (shyden-labs/ShyTalk#180 AC7). */
  assertions: number;
} & ({ status: 'expected' } | { status: 'unexpected'; error: string });

interface Report {
  suites: { title: string; specs: { title: string; tests: { projectName: string; status: string }[] }[] }[];
}

export interface PhoneDeps {
  /** The test mailbox's password, from this Mac's Keychain (service shytalk-test-mailbox). */
  mailboxPassword(): Promise<string>;
  /** An environment's site password, from this Mac's Keychain (service shytalk-<environment>-site-password). */
  sitePassword(environment: string): Promise<string>;
  /** One of DEV's own secrets, from this Mac's Keychain (service shytalk-dev-<name>-secret, shyden-labs/ShyTalk#379). */
  devSecret(name: DevSecret): Promise<string>;
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

/**
 * DEV's secrets the phones sign deliveries with, each given as the variable tests/smoke/targets.ts reads: the live
 * roadmap's board delivery and the ShyDesk suspension of the sign-in journey (shyden-labs/ShyTalk#379).
 */
export const DEV_SECRETS = {
  'roadmap-webhook': 'SMOKE_ROADMAP_WEBHOOK_SECRET',
  'shydesk-callback': 'SMOKE_SHYDESK_CALLBACK_SECRET',
} as const;
export type DevSecret = keyof typeof DEV_SECRETS;

/** Sets each of DEV's secrets from the Keychain, or fails naming every one missing, never a value. */
async function giveDevSecrets(d: PhoneDeps): Promise<void> {
  const missing: string[] = [];
  for (const [name, variable] of Object.entries(DEV_SECRETS) as [DevSecret, string][]) {
    try {
      process.env[variable] = await d.devSecret(name);
    } catch {
      missing.push(`shytalk-dev-${name}-secret (${variable})`);
    }
  }
  if (missing.length > 0) throw new Error(`DEV's secrets are missing from this Mac's Keychain: ${missing.join(', ')}`);
}

/** Appium's full log, at debug level, for each run: the console keeps only its warnings (shyden-labs/ShyTalk#221). */
export const APPIUM_LOG = 'test-results/appium.log';

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
      results.push({ title, status: 'unexpected', error: error instanceof Error ? error.message : String(error), assertions: check.count });
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
  for (const result of iphone) if (result.status === 'unexpected') errors.push(`iphone-air failed "${result.title}": ${result.error}`);
  return { lines, errors };
}

/**
 * The real iPhone's local WebDriverAgent port: a simulator's WebDriverAgent takes the Mac's 8100, which
 * refused the iPhone's session on 2026-11-16 (shyden-labs/ShyTalk#224).
 */
export const WDA_LOCAL_PORT = 8199;

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
    'appium:wdaLocalPort': WDA_LOCAL_PORT,
    'appium:newCommandTimeout': 120,
  };
}

export async function runPhones(address: string, d: PhoneDeps): Promise<number> {
  if (!address.startsWith('https://')) {
    d.print(`phone-smoke: the address must start with https://, not ${address}`);
    return 1;
  }
  // The iPhone's cases and the OnePlus's Playwright check each preview's addresses on the origin the deployed site
  // was built for (shyden-labs/ShyTalk#198).
  let environment: string;
  try {
    environment = environmentAt(address, JSON.parse(readFileSync(WRANGLER, 'utf8')) as WranglerOrigins);
    process.env.SITE_ENVIRONMENT = environment;
  } catch (error) {
    d.print(`phone-smoke: ${(error as Error).message}`);
    return 1;
  }
  const errors: string[] = [];
  let appiumStarted = false;
  try {
    // Both phones' closed-testing journey reads its mail from the real test mailbox (shyden-labs/ShyTalk#150):
    // the OnePlus's Playwright inherits this environment, and the iPhone's cases run in this process.
    process.env.TEST_MAILBOX_PASSWORD = await d.mailboxPassword();
    // DEV and TEST ask for their site password with the browser's own box (shyden-labs/ShyTalk#262): the OnePlus's
    // Playwright answers it from this environment. Production asks for none. The iPhone gets no password: Safari
    // opened no page given it in the address (2026-11-20), so it waits for the shared device runner (Shyden's ruling).
    if (environment !== 'prod') process.env.SMOKE_SITE_PASSWORD = await d.sitePassword(environment);
    // On DEV the phones sign a board delivery and a ShyDesk suspension with DEV's own secrets (shyden-labs/ShyTalk#379).
    if (environment === 'dev') await giveDevSecrets(d);
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
    appiumStarted = true;
    d.print(`phone-smoke: Appium's full log: ${APPIUM_LOG}`);
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
    for (const result of iphone)
      d.print(result.status === 'expected' ? `iphone-air: ${result.title} passed` : `iphone-air: ${result.title} FAILED: ${result.error}`);
    const verdict = phoneVerdict(oneplus, oneplusCounts, iphone, d.cases.length);
    for (const line of verdict.lines) d.print(line);
    errors.push(...verdict.errors);
    // The iPhone's reason is Appium's last word; its full log holds what led there.
    if (iphone.some(({ status }) => status !== 'expected')) errors.push(`the iPhone's failures in Appium's full log: ${APPIUM_LOG}`);
  } catch (error) {
    d.print(`phone-smoke: ${(error as Error).message}${appiumStarted ? ` (Appium's full log: ${APPIUM_LOG})` : ''}`);
    return 1;
  }
  for (const error of errors) d.print(`phone-smoke: ${error}`);
  return errors.length === 0 ? 0 : 1;
}
