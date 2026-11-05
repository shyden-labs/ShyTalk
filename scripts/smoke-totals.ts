/**
 * Compares the smoke's totals across its targets (shyden-labs/ShyTalk#109):
 * one suite, run unchanged on every target, so every target runs the same
 * number of tests and skips none. Prints each target's total and fails,
 * naming why, if a target is missing or unlisted, the totals differ, or any
 * test was skipped. Reads Playwright's JSON report (tests/smoke/playwright.config.ts).
 *
 *   node scripts/smoke-totals.ts
 */
import { readFileSync } from 'node:fs';
import { runIfEntry } from './cli.ts';
import { SMOKE_TARGETS } from '../tests/smoke/targets.ts';

/** Where the smoke's JSON reporter writes, relative to the repository root. */
export const SMOKE_REPORT = 'test-results/smoke-report.json';

interface Run {
  projectName: string;
  status: string;
}
interface Spec {
  title: string;
  tests: Run[];
}

function notReport(): never {
  throw new Error('not a Playwright JSON report');
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isRun = (value: unknown): value is Run =>
  isObject(value) && typeof value.projectName === 'string' && typeof value.status === 'string';
const isSpec = (value: unknown): value is Spec =>
  isObject(value) && typeof value.title === 'string' && Array.isArray(value.tests) && value.tests.every(isRun);

/** Every spec in the report, nested suites included, checked for the shape this reads. */
function specsOf(suites: unknown): Spec[] {
  if (!Array.isArray(suites)) notReport();
  return suites.flatMap((suite: unknown): Spec[] => {
    if (!isObject(suite)) notReport();
    const specs = suite.specs ?? [];
    if (!Array.isArray(specs) || !specs.every(isSpec)) notReport();
    return [...specs, ...specsOf(suite.suites ?? [])];
  });
}

export function smokeTotals(report: unknown, targets: readonly string[]): { lines: string[]; errors: string[] } {
  if (!isObject(report)) notReport();
  const specs = specsOf(report.suites);
  const counts = targets.map((name) => ({ name, total: 0, skipped: [] as string[] }));
  const byName = new Map(counts.map((count) => [count.name, count]));
  const unlisted = new Set<string>();
  for (const spec of specs) {
    for (const { projectName, status } of spec.tests) {
      const count = byName.get(projectName);
      if (count === undefined) {
        unlisted.add(projectName);
        continue;
      }
      count.total += 1;
      if (status === 'skipped') count.skipped.push(spec.title);
    }
  }
  const lines = counts.map(({ name, total, skipped }) => `${name}: ${String(total)} tests, ${String(skipped.length)} skipped`);
  const errors = counts.filter(({ total }) => total === 0).map(({ name }) => `${name} ran no tests`);
  for (const name of unlisted) errors.push(`${name} ran but is not a listed target`);
  if (new Set(counts.map(({ total }) => total)).size > 1) {
    errors.push(`the totals differ: ${counts.map(({ name, total }) => `${name} ${String(total)}`).join(', ')}`);
  }
  for (const { name, skipped } of counts) for (const title of skipped) errors.push(`${name} skipped "${title}"`);
  return { lines, errors };
}

export function main(): number {
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(SMOKE_REPORT, 'utf8'));
  } catch (error) {
    console.error(`smoke-totals: cannot read ${SMOKE_REPORT}: ${(error as Error).message}`);
    return 1;
  }
  const { lines, errors } = smokeTotals(report, SMOKE_TARGETS);
  for (const line of lines) console.log(`smoke-totals: ${line}`);
  for (const line of errors) console.error(`smoke-totals: ${line}`);
  return errors.length === 0 ? 0 : 1;
}

await runIfEntry(import.meta.url, main);
