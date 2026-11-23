import { describe, it, expect } from 'vitest';
import { assertionTotals, smokeTotals } from '../../scripts/smoke-totals.ts';

type Status = 'expected' | 'unexpected' | 'flaky' | 'skipped';

const TARGETS = ['chromium', 'firefox', 'webkit'] as const;

/** One spec as Playwright's JSON reporter writes it: a title and one result per project it ran on. */
function spec(title: string, runs: Record<string, Status>) {
  return { title, tests: Object.entries(runs).map(([projectName, status]) => ({ projectName, status })) };
}

/** The same status on every target. */
const everywhere = (status: Status) => ({ chromium: status, firefox: status, webkit: status });

describe('smokeTotals: each target total', () => {
  it('prints every target with its total and skips, and finds nothing wrong when all agree', () => {
    const report = { suites: [{ title: 'site.spec.ts', specs: [spec('a', everywhere('expected')), spec('b', everywhere('expected'))] }] };
    expect(smokeTotals(report, TARGETS)).toEqual({
      lines: ['chromium: 2 tests, 0 skipped', 'firefox: 2 tests, 0 skipped', 'webkit: 2 tests, 0 skipped'],
      errors: [],
    });
  });

  it('counts failed and flaky results too: the smoke step reports those itself', () => {
    const report = { suites: [{ title: 'f', specs: [spec('a', everywhere('unexpected')), spec('b', everywhere('flaky'))] }] };
    expect(smokeTotals(report, TARGETS)).toEqual({
      lines: ['chromium: 2 tests, 0 skipped', 'firefox: 2 tests, 0 skipped', 'webkit: 2 tests, 0 skipped'],
      errors: [],
    });
  });

  it('counts specs inside nested suites, and suites that hold only suites', () => {
    const report = {
      suites: [
        { title: 'f', suites: [{ title: 'inner', specs: [spec('a', everywhere('expected'))] }] },
        { title: 'g', specs: [spec('b', everywhere('expected'))] },
      ],
    };
    expect(smokeTotals(report, TARGETS).lines).toEqual([
      'chromium: 2 tests, 0 skipped',
      'firefox: 2 tests, 0 skipped',
      'webkit: 2 tests, 0 skipped',
    ]);
  });
});

describe('smokeTotals: faults', () => {
  it('fails when the totals differ, naming each target and its total', () => {
    const report = {
      suites: [{ title: 'f', specs: [spec('a', everywhere('expected')), spec('b', { chromium: 'expected', firefox: 'expected' })] }],
    };
    expect(smokeTotals(report, TARGETS).errors).toContain('the totals differ: chromium 2, firefox 2, webkit 1');
  });

  it('fails on a test skipped on one target, naming the target and the test', () => {
    const report = {
      suites: [
        {
          title: 'f',
          specs: [spec('a', everywhere('expected')), spec('b', { chromium: 'expected', firefox: 'expected', webkit: 'skipped' })],
        },
      ],
    };
    expect(smokeTotals(report, TARGETS)).toEqual({
      lines: ['chromium: 2 tests, 0 skipped', 'firefox: 2 tests, 0 skipped', 'webkit: 2 tests, 1 skipped'],
      errors: ['webkit skipped "b"'],
    });
  });

  it('fails on every target that ran no tests', () => {
    expect(smokeTotals({ suites: [] }, TARGETS).errors).toEqual(['chromium ran no tests', 'firefox ran no tests', 'webkit ran no tests']);
  });

  it('names a missing target before the totals that differ because of it', () => {
    const report = { suites: [{ title: 'f', specs: [spec('a', { chromium: 'expected', firefox: 'expected' })] }] };
    expect(smokeTotals(report, TARGETS).errors).toEqual(['webkit ran no tests', 'the totals differ: chromium 1, firefox 1, webkit 0']);
  });

  it('fails on a project that is not a listed target', () => {
    const report = { suites: [{ title: 'f', specs: [spec('a', { ...everywhere('expected'), edge: 'expected' })] }] };
    expect(smokeTotals(report, TARGETS).errors).toEqual(['edge ran but is not a listed target']);
  });
});

describe('smokeTotals: the phones against the CI browsers’ total (shyden-labs/ShyTalk#112)', () => {
  const PHONES = ['oneplus', 'iphone-air'] as const;
  const onPhones = (status: Status) => ({ oneplus: status, 'iphone-air': status });

  it('finds nothing wrong when every phone ran the CI total', () => {
    const report = { suites: [{ title: 'f', specs: [spec('a', onPhones('expected')), spec('b', onPhones('expected'))] }] };
    expect(smokeTotals(report, PHONES, 2).errors).toEqual([]);
  });

  it('fails when the phones agree with each other but not with the CI total, naming each', () => {
    const report = { suites: [{ title: 'f', specs: [spec('a', onPhones('expected'))] }] };
    expect(smokeTotals(report, PHONES, 2).errors).toEqual([
      'oneplus ran 1 tests, the CI browsers each run 2',
      'iphone-air ran 1 tests, the CI browsers each run 2',
    ]);
  });

  it('names only the phone that differs from the CI total', () => {
    const report = { suites: [{ title: 'f', specs: [spec('a', onPhones('expected')), spec('b', { oneplus: 'expected' })] }] };
    expect(smokeTotals(report, PHONES, 2).errors).toContain('iphone-air ran 1 tests, the CI browsers each run 2');
    expect(smokeTotals(report, PHONES, 2).errors).not.toContain('oneplus ran 2 tests, the CI browsers each run 2');
  });
});

describe('assertionTotals: the assertions each test ran, per target (shyden-labs/ShyTalk#180)', () => {
  it('prints each test with every target’s count, in the order the tests first appear, finding nothing wrong when all agree', () => {
    const counts = { chromium: { b: 3, a: 1 }, firefox: { a: 1, b: 3 }, webkit: { b: 3, a: 1 } };
    expect(assertionTotals(counts, TARGETS)).toEqual({
      lines: ['assertions in "b": chromium 3, firefox 3, webkit 3', 'assertions in "a": chromium 1, firefox 1, webkit 1'],
      errors: [],
    });
  });

  it('fails on a test whose counts differ, or that a target did not count, naming every target', () => {
    const counts = { chromium: { a: 2, b: 1 }, firefox: { a: 2 }, webkit: { a: 3, b: 1 } };
    expect(assertionTotals(counts, TARGETS).errors).toEqual([
      '"a" ran different numbers of assertions: chromium 2, firefox 2, webkit 3',
      '"b" ran different numbers of assertions: chromium 1, firefox none, webkit 1',
    ]);
  });

  it('names a target that counted nothing at all against every test', () => {
    expect(assertionTotals({ chromium: { a: 1 }, firefox: { a: 1 } }, TARGETS).errors).toEqual([
      '"a" ran different numbers of assertions: chromium 1, firefox 1, webkit none',
    ]);
  });
});
