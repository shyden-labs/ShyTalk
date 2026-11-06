import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { readFileSync } from 'node:fs';
import { smokeTotals, main, SMOKE_REPORT } from '../../scripts/smoke-totals.ts';
import { SMOKE_TARGETS } from '../smoke/targets.ts';

// The report is stood in: a unit test reads nothing from disk.
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));
const read = vi.mocked(readFileSync);

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

describe('main', () => {
  let log: MockInstance<typeof console.log>;
  let error: MockInstance<typeof console.error>;
  const printed = (spy: MockInstance<typeof console.log>) => spy.mock.calls.map((call) => String(call[0]));

  beforeEach(() => {
    read.mockReset();
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('reads the report from the repository root and checks the listed smoke targets', () => {
    read.mockReturnValue(JSON.stringify({ suites: [{ title: 'f', specs: [spec('a', everywhere('expected'))] }] }));
    expect(main()).toBe(0);
    expect(read).toHaveBeenCalledWith('test-results/smoke-report.json', 'utf8');
    expect(SMOKE_REPORT).toBe('test-results/smoke-report.json');
    expect(SMOKE_TARGETS).toEqual(['chromium', 'firefox', 'webkit']);
    expect(printed(log)).toEqual([
      'smoke-totals: chromium: 1 tests, 0 skipped',
      'smoke-totals: firefox: 1 tests, 0 skipped',
      'smoke-totals: webkit: 1 tests, 0 skipped',
    ]);
    expect(error).not.toHaveBeenCalled();
  });

  it('prints the totals and every fault, and fails', () => {
    read.mockReturnValue(
      JSON.stringify({ suites: [{ title: 'f', specs: [spec('a', { chromium: 'expected', firefox: 'expected', webkit: 'skipped' })] }] }),
    );
    expect(main()).toBe(1);
    expect(printed(log)).toContain('smoke-totals: webkit: 1 tests, 1 skipped');
    expect(printed(error)).toEqual(['smoke-totals: webkit skipped "a"']);
  });

  it('fails naming the file when there is no report', () => {
    read.mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });
    expect(main()).toBe(1);
    expect(printed(error)).toEqual(['smoke-totals: cannot read test-results/smoke-report.json: ENOENT: no such file']);
  });

  it.each(['not json', '{}', '{"suites":[{"specs":[{"title":"a"}]}]}'])('fails naming the file on a report it cannot read: %s', (text) => {
    read.mockReturnValue(text);
    expect(main()).toBe(1);
    expect(printed(error)).toHaveLength(1);
    expect(printed(error)[0]).toMatch(/^smoke-totals: cannot read test-results\/smoke-report\.json: /);
  });
});
