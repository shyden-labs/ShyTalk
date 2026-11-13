/**
 * Compares the smoke's totals across its targets (shyden-labs/ShyTalk#109):
 * one suite runs unchanged on every target, so each target runs the same
 * number of tests and skips none. Reads Playwright's JSON report
 * (tests/smoke/playwright.config.ts), prints each target's total and fails,
 * naming why, if a target ran nothing, an unlisted target ran, the totals
 * differ, any test was skipped, or the report cannot be read.
 *
 *   node scripts/smoke-totals.ts
 */
import { readFileSync } from 'node:fs';
import { runIfEntry } from './cli.ts';
import { SMOKE_TARGETS } from '../tests/smoke/targets.ts';

/** Where the smoke's JSON reporter writes, relative to the repository root. */
export const SMOKE_REPORT = 'test-results/smoke-report.json';

/** Where the smoke's assertion counter (tests/smoke/assertion-counts.ts) writes. */
export const SMOKE_COUNTS = 'test-results/smoke-assertions.json';

type Counts = Record<string, Record<string, number>>;

/**
 * The assertions each test ran on each target (shyden-labs/ShyTalk#180): one
 * line per test, in the order tests first appear, and a fault for each test
 * whose counts differ or that a target did not count.
 */
export function assertionTotals(counts: Counts, targets: readonly string[]): { lines: string[]; errors: string[] } {
  const titles = [...new Set(targets.flatMap((target) => Object.keys(counts[target] ?? {})))];
  const lines: string[] = [];
  const errors: string[] = [];
  for (const title of titles) {
    const each = targets.map((target) => counts[target]?.[title]);
    const named = targets.map((target, i) => `${target} ${each[i] === undefined ? 'none' : String(each[i])}`).join(', ');
    lines.push(`assertions in "${title}": ${named}`);
    if (new Set(each).size > 1) errors.push(`"${title}" ran different numbers of assertions: ${named}`);
  }
  return { lines, errors };
}

interface Result {
  projectName: string;
  status: string;
}
interface Spec {
  title: string;
  tests: Result[];
}
interface Suite {
  specs?: Spec[];
  suites?: Suite[];
}
interface Report {
  suites: Suite[];
}

/** Every spec in these suites and the suites nested inside them. */
const allSpecs = (suites: Suite[]): Spec[] => suites.flatMap((suite) => [...(suite.specs ?? []), ...allSpecs(suite.suites ?? [])]);

/**
 * `expected`, for the phones (shyden-labs/ShyTalk#112), is the total each CI
 * browser runs: a phone that ran any other number fails, named.
 */
export function smokeTotals(report: Report, targets: readonly string[], expected?: number): { lines: string[]; errors: string[] } {
  const results = allSpecs(report.suites).flatMap((spec) => spec.tests.map((result) => ({ ...result, title: spec.title })));
  const perTarget = targets.map((target) => {
    const mine = results.filter((result) => result.projectName === target);
    return { target, total: mine.length, skipped: mine.filter((result) => result.status === 'skipped') };
  });
  const lines = perTarget.map(({ target, total, skipped }) => `${target}: ${String(total)} tests, ${String(skipped.length)} skipped`);
  const errors = perTarget.filter(({ total }) => total === 0).map(({ target }) => `${target} ran no tests`);
  const unlisted = new Set(results.map((result) => result.projectName).filter((name) => !targets.includes(name)));
  for (const name of unlisted) errors.push(`${name} ran but is not a listed target`);
  if (new Set(perTarget.map(({ total }) => total)).size > 1) {
    errors.push(`the totals differ: ${perTarget.map(({ target, total }) => `${target} ${String(total)}`).join(', ')}`);
  }
  if (expected !== undefined) {
    for (const { target, total } of perTarget) {
      if (total !== expected) errors.push(`${target} ran ${String(total)} tests, the CI browsers each run ${String(expected)}`);
    }
  }
  for (const { target, skipped } of perTarget) for (const { title } of skipped) errors.push(`${target} skipped "${title}"`);
  return { lines, errors };
}

export function main(): number {
  let totals: { lines: string[]; errors: string[] };
  try {
    totals = smokeTotals(JSON.parse(readFileSync(SMOKE_REPORT, 'utf8')) as Report, SMOKE_TARGETS);
  } catch (error) {
    console.error(`smoke-totals: cannot read ${SMOKE_REPORT}: ${(error as Error).message}`);
    return 1;
  }
  let assertions: { lines: string[]; errors: string[] };
  try {
    assertions = assertionTotals(JSON.parse(readFileSync(SMOKE_COUNTS, 'utf8')) as Counts, SMOKE_TARGETS);
  } catch (error) {
    assertions = { lines: [], errors: [`cannot read ${SMOKE_COUNTS}: ${(error as Error).message}`] };
  }
  const lines = [...totals.lines, ...assertions.lines];
  const errors = [...totals.errors, ...assertions.errors];
  for (const line of lines) console.log(`smoke-totals: ${line}`);
  for (const line of errors) console.error(`smoke-totals: ${line}`);
  return errors.length === 0 ? 0 : 1;
}

await runIfEntry(import.meta.url, main);
