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
  for (const line of totals.lines) console.log(`smoke-totals: ${line}`);
  for (const line of totals.errors) console.error(`smoke-totals: ${line}`);
  return totals.errors.length === 0 ? 0 : 1;
}

await runIfEntry(import.meta.url, main);
