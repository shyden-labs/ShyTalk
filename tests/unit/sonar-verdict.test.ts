import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedCode, main, parseReportTask, verdict } from '../../scripts/sonar-verdict.ts';

/**
 * SonarCloud's quality gate, read for the analysis this run's scan made
 * (issue shyden-labs/repo-template#27; Shyden 2026-10-18: "don't pass if it doesn't run", "make sure we
 * check the results and fail the workflow if it fails"). Green only on OK;
 * every other answer, and every answer that cannot be read, fails by name.
 * HTTP and the wait are stood in: nothing reaches the network.
 */

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(() => Promise.resolve()) }));
const waited = vi.mocked(sleep);

const REPORT = [
  'projectKey=shyden-labs_app',
  'serverUrl=https://sonarcloud.io',
  'dashboardUrl=https://sonarcloud.io/dashboard?id=x&pullRequest=7',
  'ceTaskId=AX1',
].join('\n');

describe('parseReportTask', () => {
  it("reads the scan's task id, server and dashboard", () => {
    expect(parseReportTask(REPORT)).toEqual({
      projectKey: 'shyden-labs_app',
      serverUrl: 'https://sonarcloud.io',
      ceTaskId: 'AX1',
      dashboardUrl: 'https://sonarcloud.io/dashboard?id=x&pullRequest=7',
    });
  });

  it.each([['projectKey'], ['ceTaskId'], ['serverUrl'], ['dashboardUrl']])('refuses a report with no %s', (key) => {
    const text = REPORT.split('\n')
      .filter((l) => !l.startsWith(`${key}=`))
      .join('\n');
    expect(() => parseReportTask(text)).toThrow(`sonar-verdict: the scan's report-task.txt has no ${key}; the scan did not finish`);
  });
});

describe('verdict', () => {
  it('passes OK', () => {
    expect(verdict({ status: 'OK', conditions: [] })).toEqual({ ok: true, lines: ['quality gate: OK'] });
  });

  it('fails ERROR, naming each failed condition with its value and threshold', () => {
    expect(
      verdict({
        status: 'ERROR',
        conditions: [
          { status: 'ERROR', metricKey: 'new_coverage', comparator: 'LT', errorThreshold: '85', actualValue: '82.5' },
          { status: 'OK', metricKey: 'new_bugs', comparator: 'GT', errorThreshold: '0', actualValue: '0' },
          { status: 'ERROR', metricKey: 'new_violations', comparator: 'GT', actualValue: '3' },
        ],
      }),
    ).toEqual({
      ok: false,
      lines: ['quality gate: ERROR', 'new_coverage is 82.5, which fails LT 85', 'new_violations is 3, which fails GT (no threshold given)'],
    });
  });

  it('fails ERROR even when no condition is listed', () => {
    expect(verdict({ status: 'ERROR' })).toEqual({ ok: false, lines: ['quality gate: ERROR'] });
  });

  it.each([['WARN'], ['NONE'], [undefined]])('fails the status %s, which is not a pass', (status) => {
    expect(verdict(status === undefined ? { conditions: [] } : { status, conditions: [] })).toEqual({
      ok: false,
      lines: [`quality gate: ${String(status)}, not OK`],
    });
  });
});

describe('main', () => {
  let dir: string;
  let out: string[];
  let err: string[];
  let fetched: string[];
  beforeEach(() => {
    waited.mockClear();
    dir = mkdtempSync(join(tmpdir(), 'sonar-verdict-'));
    writeFileSync(join(dir, 'report-task.txt'), REPORT);
    writeFileSync(join(dir, 'changed-files.txt'), 'scripts/a.ts\n');
    out = [];
    err = [];
    fetched = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((t) => (out.push(String(t)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation((t) => (err.push(String(t)), true));
    // Every variable the reader reads is set here: CI sets GITHUB_STEP_SUMMARY in every job,
    // and a test that inherits it judges (and writes to) the runner's own summary.
    vi.stubEnv('SONAR_TOKEN', 'tok');
    vi.stubEnv('SONAR_PULL_REQUEST', '7');
    vi.stubEnv('SONAR_CHANGED_FILES', join(dir, 'changed-files.txt'));
    vi.stubEnv('SONAR_CEILING_SECONDS', '');
    vi.stubEnv('GITHUB_STEP_SUMMARY', '');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Answers each GET in turn with the given status and JSON body, recording the URL and the token sent. */
  const answer = (...replies: [number, unknown][]) => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: { headers: { Authorization: string } }) => {
        fetched.push(`${url} ${init.headers.Authorization}`);
        const [status, body] = replies.shift() as [number, unknown];
        return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) });
      }),
    );
  };
  const task = (status: string, over: object = {}) =>
    [200, { task: { id: 'AX1', status, analysisId: 'AN1', pullRequest: '7', ...over } }] as [number, unknown];
  const gate = (status: string, conditions: object[] = []) => [200, { projectStatus: { status, conditions } }] as [number, unknown];
  /** The analysis's measured source lines (ncloc); no value means SonarCloud measured none. */
  const lines = (ncloc?: string) =>
    [200, { component: { measures: ncloc === undefined ? [] : [{ metric: 'ncloc', value: ncloc }] } }] as [number, unknown];
  const run = () => main([join(dir, 'report-task.txt')]);

  it.each([[[]], [['a', 'b']]])('refuses the arguments %j', async (args) => {
    await expect(main(args)).rejects.toThrow('usage: node scripts/sonar-verdict.ts <.scannerwork/report-task.txt>');
  });

  it('fails, naming the key and where it is set, when the token is missing', async () => {
    vi.stubEnv('SONAR_TOKEN', '');
    await expect(run()).rejects.toThrow(
      'sonar-verdict: SONAR_TOKEN is empty; set it as an Actions secret, and as a Dependabot secret for Dependabot pull requests (docs/sonarcloud.md)',
    );
  });

  it("reads this scan's task, then the gate of the analysis it made, and passes OK", async () => {
    answer(task('SUCCESS'), gate('OK'), lines('1200'));
    expect(await run()).toBe(0);
    expect(fetched).toEqual([
      'https://sonarcloud.io/api/ce/task?id=AX1 Bearer tok',
      'https://sonarcloud.io/api/qualitygates/project_status?analysisId=AN1 Bearer tok',
      'https://sonarcloud.io/api/measures/component?component=shyden-labs_app&metricKeys=ncloc&pullRequest=7 Bearer tok',
    ]);
    expect(out).toEqual(['sonar-verdict: quality gate: OK\n', 'sonar-verdict: https://sonarcloud.io/dashboard?id=x&pullRequest=7\n']);
  });

  it('fails closed, saying the scan did not run, when it wrote no report', async () => {
    await expect(main([join(dir, 'missing.txt')])).rejects.toThrow(
      `sonar-verdict: no report-task.txt at ${join(dir, 'missing.txt')}: the scan did not run`,
    );
  });

  it("writes the verdict and the link to the job's summary", async () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', join(dir, 'summary.md'));
    answer(task('SUCCESS'), gate('OK'), lines('1200'));
    await run();
    expect(readFileSync(join(dir, 'summary.md'), 'utf8')).toBe(
      '### SonarCloud\n\nThe scan ran. quality gate: OK\n\nhttps://sonarcloud.io/dashboard?id=x&pullRequest=7\n',
    );
  });

  it("writes why there is no verdict to the job's summary, then fails", async () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', join(dir, 'summary.md'));
    answer(task('FAILED', { errorMessage: 'boom' }));
    await expect(run()).rejects.toThrow('ended FAILED');
    expect(readFileSync(join(dir, 'summary.md'), 'utf8')).toBe(
      '### SonarCloud\n\nNo verdict: sonar-verdict: task AX1 ended FAILED (boom); no verdict to read\n',
    );
  });

  it('waits for a pending task within the ceiling, five seconds at a time', async () => {
    answer(task('PENDING'), task('IN_PROGRESS'), task('SUCCESS'), gate('OK'), lines('1200'));
    expect(await run()).toBe(0);
    expect(waited.mock.calls).toEqual([[5000], [5000]]);
  });

  it('fails closed, naming the status, when the task is still pending at the ceiling', async () => {
    vi.stubEnv('SONAR_CEILING_SECONDS', '10');
    answer(task('PENDING'), task('PENDING'), task('PENDING'));
    await expect(run()).rejects.toThrow('sonar-verdict: task AX1 is still PENDING after 10 s; no verdict to read');
  });

  it('fails ERROR, naming each failed condition', async () => {
    answer(
      task('SUCCESS'),
      gate('ERROR', [{ status: 'ERROR', metricKey: 'new_coverage', comparator: 'LT', errorThreshold: '85', actualValue: '82.5' }]),
      lines('1200'),
    );
    expect(await run()).toBe(1);
    expect(err).toEqual(['sonar-verdict: quality gate: ERROR\n', 'sonar-verdict: new_coverage is 82.5, which fails LT 85\n']);
  });

  it('fails closed on a task that failed or was cancelled', async () => {
    answer(task('FAILED', { errorMessage: 'Fail to extract report' }));
    await expect(run()).rejects.toThrow('sonar-verdict: task AX1 ended FAILED (Fail to extract report); no verdict to read');
  });

  it('fails closed on a task cancelled with no message', async () => {
    answer(task('CANCELED'));
    await expect(run()).rejects.toThrow('sonar-verdict: task AX1 ended CANCELED; no verdict to read');
  });

  it('fails closed on a task with no analysis', async () => {
    answer(task('SUCCESS', { analysisId: undefined }));
    await expect(run()).rejects.toThrow('sonar-verdict: task AX1 made no analysis; no verdict to read');
  });

  it("fails closed on a task for another pull request's analysis", async () => {
    answer(task('SUCCESS', { pullRequest: '6' }));
    await expect(run()).rejects.toThrow('sonar-verdict: task AX1 analysed pull request 6, not 7: a verdict for another commit');
  });

  it('accepts a task that names no pull request when none is expected', async () => {
    vi.stubEnv('SONAR_PULL_REQUEST', '');
    answer(task('SUCCESS', { pullRequest: undefined, branch: 'develop' }), gate('OK'), lines('1200'));
    expect(await run()).toBe(0);
  });

  it.each([
    ['the task', [[401, {}]], 'sonar-verdict: GET https://sonarcloud.io/api/ce/task?id=AX1 answered 401; no verdict to read'],
    [
      'the gate',
      [task('SUCCESS'), [404, {}]],
      'sonar-verdict: GET https://sonarcloud.io/api/qualitygates/project_status?analysisId=AN1 answered 404; no verdict to read',
    ],
    [
      'the measured lines',
      [task('SUCCESS'), gate('OK'), [500, {}]],
      'sonar-verdict: GET https://sonarcloud.io/api/measures/component?component=shyden-labs_app&metricKeys=ncloc&pullRequest=7 answered 500; no verdict to read',
    ],
  ])('fails closed on an API error reading %s', async (_what, replies, message) => {
    answer(...(replies as [number, unknown][]));
    await expect(run()).rejects.toThrow(message);
  });

  // Issue #240: the gate passed for weeks on an analysis of tests alone. A branch analysis
  // measures the whole branch, so no source lines there means the scan read no source code.
  describe('on a branch analysis', () => {
    beforeEach(() => vi.stubEnv('SONAR_PULL_REQUEST', ''));
    const branchTask = () => task('SUCCESS', { pullRequest: undefined, branch: 'develop' });

    it('reads the source lines of that branch, and passes when there are some', async () => {
      answer(branchTask(), gate('OK'), lines('1200'));
      expect(await run()).toBe(0);
      expect(fetched[2]).toBe(
        'https://sonarcloud.io/api/measures/component?component=shyden-labs_app&metricKeys=ncloc&branch=develop Bearer tok',
      );
    });

    it.each([
      ['measured no source lines', undefined, 'missing'],
      ['measured 0 source lines', '0', '0'],
    ])('fails, naming why, when it %s', async (_what, ncloc, shown) => {
      answer(branchTask(), gate('OK'), lines(ncloc));
      await expect(run()).rejects.toThrow(
        `sonar-verdict: the analysis of branch develop measured no source lines (ncloc ${shown}): the scan read no source code, so the gate judged nothing`,
      );
    });
  });

  // Issue #240: a pull request's analysis counts only the files it changed (measured 2026-11-17,
  // shyden-labs/repo-template PR 189: 2 files changed, 1 counted), so no source lines is wrong only
  // when it changed code outside tests/ (Shyden 2026-11-17: "Develop full, PR by diff").
  describe('on a pull request analysis', () => {
    it.each([
      ['measured no source lines', undefined, 'missing'],
      ['measured 0 source lines', '0', '0'],
    ])('fails, naming the code it changed, when it %s', async (_what, ncloc, shown) => {
      writeFileSync(join(dir, 'changed-files.txt'), 'docs/a.md\nscripts/a.ts\napps/web/src/b.tsx\n');
      answer(task('SUCCESS'), gate('OK'), lines(ncloc));
      await expect(run()).rejects.toThrow(
        `sonar-verdict: pull request 7 changed code outside tests/ (scripts/a.ts, apps/web/src/b.tsx), but its analysis measured no source lines (ncloc ${shown}): the scan read no source code, so the gate judged nothing`,
      );
    });

    it('passes with no source lines when it changed no code outside tests/', async () => {
      writeFileSync(join(dir, 'changed-files.txt'), 'docs/a.md\ntests/unit/a.test.ts\n');
      answer(task('SUCCESS'), gate('OK'), lines(undefined));
      expect(await run()).toBe(0);
    });

    it.each([
      ['was given no list of the changed files', ''],
      ['was given a list that does not exist', 'missing.txt'],
    ])('fails closed when it %s', async (_what, list) => {
      vi.stubEnv('SONAR_CHANGED_FILES', list && join(dir, list));
      answer(task('SUCCESS'), gate('OK'), lines(undefined));
      await expect(run()).rejects.toThrow(
        "sonar-verdict: SONAR_CHANGED_FILES names no file of the pull request's changed files; cannot judge whether no source lines means no scan",
      );
    });
  });
});

describe('changedCode', () => {
  it('keeps the code files outside tests/, in order', () => {
    expect(
      changedCode([
        'scripts/a.ts',
        'tests/unit/a.test.ts',
        'docs/a.md',
        '.github/workflows/ci.yml',
        'apps/web/src/b.tsx',
        'workers/c.js',
        'eslint.config.mjs',
        'x.cjs',
        'y.mts',
        'z.cts',
        'w.jsx',
        '',
      ]),
    ).toEqual(['scripts/a.ts', 'apps/web/src/b.tsx', 'workers/c.js', 'eslint.config.mjs', 'x.cjs', 'y.mts', 'z.cts', 'w.jsx']);
  });

  it('keeps nothing from tests/ alone, nor a file whose name only starts with tests', () => {
    expect(changedCode(['tests/a.ts', 'tests-helper.ts', 'apps/tests/b.ts'])).toEqual(['tests-helper.ts', 'apps/tests/b.ts']);
  });
});
