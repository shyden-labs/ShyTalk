/**
 * Compares the phone run's totals across the phones and against the desktop
 * browsers' total (shyden-labs/ShyTalk#109, #112): one suite runs unchanged on
 * every target, so each runs the same tests and skips none. The desktop
 * browsers are checked by the shared package's `one-suite` in CI
 * (shyden-labs/ShyTalk#239); this stays for the phone run (tests/phones/run.ts)
 * until it moves to the shared device runner (shyden-labs/ShyTalk#238).
 */

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
    errors.push(`the totals differ: ${perTarget.map(({ target, total }) => target + ' ' + String(total)).join(', ')}`);
  }
  if (expected !== undefined) {
    for (const { target, total } of perTarget) {
      if (total !== expected) errors.push(`${target} ran ${String(total)} tests, the CI browsers each run ${String(expected)}`);
    }
  }
  for (const { target, skipped } of perTarget) for (const { title } of skipped) errors.push(`${target} skipped "${title}"`);
  return { lines, errors };
}
