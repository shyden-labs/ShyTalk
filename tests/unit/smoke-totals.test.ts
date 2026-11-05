import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { readFileSync } from 'node:fs';
import { smokeTotals, main, SMOKE_REPORT } from '../../scripts/smoke-totals.ts';
import { SMOKE_TARGETS } from '../smoke/targets.ts';

// The report file is stood in: a unit test reads nothing from disk.
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));
const read = vi.mocked(readFileSync);

type Status = 'expected' | 'unexpected' | 'flaky' | 'skipped';

/** One spec run on each named target, as Playwright's JSON reporter writes it. */
function spec(title: string, runs: Record<string, Status>) {
  return { title, tests: Object.entries(runs).map(([projectName, status]) => ({ projectName, status })) };
}

const ALL = (status: Status = 'expected') => ({ chromium: status, firefox: status, webkit: status });
const TARGETS = ['chromium', 'firefox', 'webkit'] as const;

describe('smokeTotals', () => {
  it('prints each target with its total, and finds nothing wrong when every target ran the same tests', () => {
    const report = { suites: [{ title: 'site.spec.ts', specs: [spec('a', ALL()), spec('b', ALL())], suites: [] }] };
    expect(smokeTotals(report, TARGETS)).toEqual({
      lines: ['chromium: 2 tests, 0 skipped', 'firefox: 2 tests, 0 skipped', 'webkit: 2 tests, 0 skipped'],
      errors: [],
    });
  });

  it('counts a failed or flaky test in its target total: the run itself reports the failure', () => {
    const report = { suites: [{ title: 'f', specs: [spec('a', ALL('unexpected')), spec('b', ALL('flaky'))] }] };
    expect(smokeTotals(report, TARGETS).errors).toEqual([]);
    expect(smokeTotals(report, TARGETS).lines[0]).toBe('chromium: 2 tests, 0 skipped');
  });

  it('counts specs in nested suites', () => {
    const report = {
      suites: [{ title: 'f', specs: [spec('a', ALL())], suites: [{ title: 'inner', specs: [spec('b', ALL())] }] }],
    };
    expect(smokeTotals(report, TARGETS).lines).toContain('webkit: 2 tests, 0 skipped');
  });

  it('fails when the totals differ, naming every target and its total', () => {
    const report = {
      suites: [{ title: 'f', specs: [spec('a', ALL()), spec('b', { chromium: 'expected', firefox: 'expected' })] }],
    };
    expect(smokeTotals(report, TARGETS).errors).toEqual(['the totals differ: chromium 2, firefox 2, webkit 1']);
  });

  it('fails on a test skipped on one target, naming the target and the test', () => {
    const report = {
      suites: [{ title: 'f', specs: [spec('a', ALL()), spec('b', { chromium: 'expected', firefox: 'expected', webkit: 'skipped' })] }],
    };
    const { lines, errors } = smokeTotals(report, TARGETS);
    expect(lines).toContain('webkit: 2 tests, 1 skipped');
    expect(errors).toEqual(['webkit skipped "b"']);
  });

  it('fails on a target that ran no tests', () => {
    const report = { suites: [{ title: 'f', specs: [spec('a', { chromium: 'expected', firefox: 'expected' })] }] };
    expect(smokeTotals(report, TARGETS).errors).toEqual(['webkit ran no tests', 'the totals differ: chromium 1, firefox 1, webkit 0']);
  });

  it('fails on a target that is not on the list', () => {
    const report = { suites: [{ title: 'f', specs: [spec('a', { ...ALL(), edge: 'expected' })] }] };
    expect(smokeTotals(report, TARGETS).errors).toEqual(['edge ran but is not a listed target']);
  });

  it('fails on a report with no tests at all', () => {
    expect(smokeTotals({ suites: [] }, TARGETS).errors).toEqual(['chromium ran no tests', 'firefox ran no tests', 'webkit ran no tests']);
  });

  it('reads a suite holding only nested suites', () => {
    const report = { suites: [{ title: 'f', suites: [{ title: 'inner', specs: [spec('a', ALL())] }] }] };
    expect(smokeTotals(report, TARGETS).errors).toEqual([]);
  });

  it.each([
    null,
    'text',
    {},
    { suites: 'x' },
    { suites: ['x'] },
    { suites: [{ specs: 'x' }] },
    { suites: [{ specs: ['x'] }] },
    { suites: [{ specs: [{ tests: [] }] }] },
    { suites: [{ specs: [{ title: 'a', tests: 'x' }] }] },
    { suites: [{ specs: [{ title: 'a', tests: ['x'] }] }] },
    { suites: [{ specs: [{ title: 'a', tests: [{ status: 'expected' }] }] }] },
    { suites: [{ specs: [{ title: 'a', tests: [{ projectName: 'webkit' }] }] }] },
    { suites: [{ suites: 'x' }] },
  ])('refuses a report that is not Playwright JSON: %j', (report) => {
    expect(() => smokeTotals(report, TARGETS)).toThrow(/not a Playwright JSON report/);
  });
});

describe('the smoke targets', () => {
  it('are Chromium, Firefox and WebKit (Shyden 2026-11-05, shyden-labs/ShyTalk#109)', () => {
    expect(SMOKE_TARGETS).toEqual(['chromium', 'firefox', 'webkit']);
  });
});

describe('main', () => {
  let log: MockInstance<typeof console.log>;
  let error: MockInstance<typeof console.error>;
  beforeEach(() => {
    read.mockReset();
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('reads the report, prints each target and passes when all agree', () => {
    read.mockReturnValue(JSON.stringify({ suites: [{ title: 'f', specs: [spec('a', ALL())] }] }));
    expect(main()).toBe(0);
    expect(read).toHaveBeenCalledWith(SMOKE_REPORT, 'utf8');
    expect(log.mock.calls.map((call) => String(call[0]))).toEqual([
      'smoke-totals: chromium: 1 tests, 0 skipped',
      'smoke-totals: firefox: 1 tests, 0 skipped',
      'smoke-totals: webkit: 1 tests, 0 skipped',
    ]);
    expect(error).not.toHaveBeenCalled();
  });

  it('prints each fault and fails', () => {
    read.mockReturnValue(
      JSON.stringify({ suites: [{ title: 'f', specs: [spec('a', { chromium: 'expected', firefox: 'expected', webkit: 'skipped' })] }] }),
    );
    expect(main()).toBe(1);
    expect(error.mock.calls.map((call) => String(call[0]))).toEqual(['smoke-totals: webkit skipped "a"']);
  });

  it('fails naming the file when there is no report', () => {
    read.mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });
    expect(main()).toBe(1);
    expect(error.mock.calls.map((call) => String(call[0]))).toEqual([`smoke-totals: cannot read ${SMOKE_REPORT}: ENOENT: no such file`]);
  });
});
