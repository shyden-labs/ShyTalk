'use strict';

/**
 * sonar-verdict.unit.test.js — SHY-0625.
 *
 * `scripts/sonar-verdict.js` is the CI step that turns a SonarCloud analysis
 * into a pass or a fail. It replaced a step that warned and succeeded when the
 * scan never ran, and a scanner setting (`sonar.qualitygate.wait=false`) that
 * never read the quality gate at all. Loaded in-process; `fetch`, the clock and
 * the pause between polls are stand-ins, so no request leaves the test and no
 * test waits.
 */

const {
  readReportTask,
  waitForTask,
  readGate,
  checkCommit,
  verdict,
  run,
} = require('../../../scripts/sonar-verdict.js');

const SERVER = 'https://sonarcloud.io';
const TOKEN = 'sqp_secret_token_value';
const SHA = '0b7339ec1db0000000000000000000000000000a';

/** A `fetch` stand-in answering each URL prefix with the next queued reply. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((prefix) => url.startsWith(`${SERVER}/${prefix}`));
    if (!key) throw new Error(`unexpected URL ${url}`);
    const queue = routes[key];
    const reply = queue.length > 1 ? queue.shift() : queue[0];
    return { status: reply.status ?? 200, json: async () => reply.body };
  };
  return { fetch, calls };
}

/** A clock that moves only when the stand-in pause is called. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

const task = (status, analysisId) => ({ body: { task: { id: 'AX1', status, analysisId } } });

describe('readReportTask', () => {
  const full =
    'projectKey=ShydenMcM_ShyTalk\nserverUrl=https://sonarcloud.io\n' +
    'dashboardUrl=https://sonarcloud.io/dashboard?id=ShydenMcM_ShyTalk&pullRequest=1\n' +
    'ceTaskId=AX1\nceTaskUrl=https://sonarcloud.io/api/ce/task?id=AX1\n';

  test('reads the task id, server and dashboard', () => {
    expect(readReportTask(full)).toEqual({
      projectKey: 'ShydenMcM_ShyTalk',
      ceTaskId: 'AX1',
      serverUrl: 'https://sonarcloud.io',
      dashboardUrl: 'https://sonarcloud.io/dashboard?id=ShydenMcM_ShyTalk&pullRequest=1',
    });
  });

  test('a value holding "=" keeps everything after the first "="', () => {
    expect(readReportTask(full).dashboardUrl).toBe(
      'https://sonarcloud.io/dashboard?id=ShydenMcM_ShyTalk&pullRequest=1',
    );
  });

  test.each(['projectKey', 'ceTaskId', 'serverUrl', 'dashboardUrl'])(
    'fails naming a missing %s',
    (key) => {
      const text = full
        .split('\n')
        .filter((line) => !line.startsWith(`${key}=`))
        .join('\n');
      expect(() => readReportTask(text)).toThrow(`report-task.txt has no ${key}`);
    },
  );
});

describe('waitForTask', () => {
  const wait = (fetch, clock, ceilingMs = 10_000) =>
    waitForTask({
      fetch,
      serverUrl: SERVER,
      taskId: 'AX1',
      token: TOKEN,
      ceilingMs,
      intervalMs: 1_000,
      ...clock,
    });

  test('returns the analysis id when the first poll says SUCCESS', async () => {
    const { fetch } = fakeFetch({ 'api/ce/task': [task('SUCCESS', 'AN1')] });
    await expect(wait(fetch, fakeClock())).resolves.toEqual({ analysisId: 'AN1', elapsedMs: 0 });
  });

  test('waits through PENDING and IN_PROGRESS, then returns the analysis id', async () => {
    const { fetch, calls } = fakeFetch({
      'api/ce/task': [task('PENDING'), task('IN_PROGRESS'), task('SUCCESS', 'AN1')],
    });
    await expect(wait(fetch, fakeClock())).resolves.toEqual({
      analysisId: 'AN1',
      elapsedMs: 2_000,
    });
    expect(calls).toHaveLength(3);
  });

  test('sends the token as a bearer header, never in the URL', async () => {
    const { fetch, calls } = fakeFetch({ 'api/ce/task': [task('SUCCESS', 'AN1')] });
    await wait(fetch, fakeClock());
    expect(calls[0].url).toBe(`${SERVER}/api/ce/task?id=AX1`);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  test('fails when the task FAILED', async () => {
    const { fetch } = fakeFetch({ 'api/ce/task': [task('FAILED')] });
    await expect(wait(fetch, fakeClock())).rejects.toThrow('SonarCloud task AX1 ended FAILED');
  });

  test('fails when the task was CANCELED', async () => {
    const { fetch } = fakeFetch({ 'api/ce/task': [task('CANCELED')] });
    await expect(wait(fetch, fakeClock())).rejects.toThrow('SonarCloud task AX1 ended CANCELED');
  });

  test('fails on a status it does not know', async () => {
    const { fetch } = fakeFetch({ 'api/ce/task': [task('PAUSED')] });
    await expect(wait(fetch, fakeClock())).rejects.toThrow(
      'SonarCloud task AX1 has unknown status PAUSED',
    );
  });

  test('fails at the ceiling naming the task, its last status and the time waited', async () => {
    const { fetch } = fakeFetch({ 'api/ce/task': [task('IN_PROGRESS')] });
    await expect(wait(fetch, fakeClock(), 3_000)).rejects.toThrow(
      'SonarCloud task AX1 still IN_PROGRESS after 3s (ceiling 3s)',
    );
  });

  test('fails at once on a non-200 reply, naming the URL and code', async () => {
    const { fetch, calls } = fakeFetch({ 'api/ce/task': [{ status: 401, body: {} }] });
    await expect(wait(fetch, fakeClock())).rejects.toThrow(
      `${SERVER}/api/ce/task?id=AX1 answered 401`,
    );
    expect(calls).toHaveLength(1);
  });

  test('fails when SUCCESS carries no analysis id', async () => {
    const { fetch } = fakeFetch({ 'api/ce/task': [task('SUCCESS')] });
    await expect(wait(fetch, fakeClock())).rejects.toThrow(
      'SonarCloud task AX1 succeeded with no analysisId',
    );
  });
});

describe('readGate', () => {
  const gate = (fetch) => readGate({ fetch, serverUrl: SERVER, analysisId: 'AN1', token: TOKEN });

  test('returns the status and conditions of that analysis', async () => {
    const conditions = [{ status: 'OK', metricKey: 'new_coverage' }];
    const { fetch, calls } = fakeFetch({
      'api/qualitygates/project_status': [
        { body: { projectStatus: { status: 'OK', conditions } } },
      ],
    });
    await expect(gate(fetch)).resolves.toEqual({ status: 'OK', conditions });
    expect(calls[0].url).toBe(`${SERVER}/api/qualitygates/project_status?analysisId=AN1`);
  });

  test('fails on a non-200 reply', async () => {
    const { fetch } = fakeFetch({ 'api/qualitygates/project_status': [{ status: 403, body: {} }] });
    await expect(gate(fetch)).rejects.toThrow('project_status?analysisId=AN1 answered 403');
  });

  test('fails when the reply has no status', async () => {
    const { fetch } = fakeFetch({
      'api/qualitygates/project_status': [{ body: { projectStatus: {} } }],
    });
    await expect(gate(fetch)).rejects.toThrow('quality gate for analysis AN1 has no status');
  });
});

describe('checkCommit', () => {
  const list = (pullRequests) => ({
    'api/project_pull_requests/list': [{ body: { pullRequests } }],
  });
  const check = (fetch) =>
    checkCommit({
      fetch,
      serverUrl: SERVER,
      projectKey: 'ShydenMcM_ShyTalk',
      pullRequest: '2395',
      expectedSha: SHA,
      token: TOKEN,
    });

  test('passes when SonarCloud analysed the expected commit of the PR', async () => {
    const { fetch } = fakeFetch(list([{ key: '2395', commit: { sha: SHA } }]));
    await expect(check(fetch)).resolves.toBeUndefined();
  });

  test('fails when SonarCloud last analysed another commit', async () => {
    const { fetch } = fakeFetch(list([{ key: '2395', commit: { sha: 'f'.repeat(40) } }]));
    await expect(check(fetch)).rejects.toThrow(
      `SonarCloud analysed ${'f'.repeat(40)} for PR 2395, not ${SHA}`,
    );
  });

  test('fails when SonarCloud lists no such PR', async () => {
    const { fetch } = fakeFetch(list([{ key: '1', commit: { sha: SHA } }]));
    await expect(check(fetch)).rejects.toThrow('SonarCloud lists no PR 2395');
  });

  test('fails on a non-200 reply', async () => {
    const { fetch } = fakeFetch({ 'api/project_pull_requests/list': [{ status: 500, body: {} }] });
    await expect(check(fetch)).rejects.toThrow(
      'project_pull_requests/list?project=ShydenMcM_ShyTalk answered 500',
    );
  });
});

describe('verdict', () => {
  test('OK passes', () => {
    expect(verdict({ status: 'OK', conditions: [] })).toEqual({ ok: true, reasons: [] });
  });

  test('ERROR fails and names each failed condition', () => {
    const conditions = [
      {
        status: 'ERROR',
        metricKey: 'new_coverage',
        comparator: 'LT',
        errorThreshold: '80',
        actualValue: '41.2',
      },
      {
        status: 'OK',
        metricKey: 'new_duplicated_lines_density',
        comparator: 'GT',
        errorThreshold: '3',
        actualValue: '0',
      },
    ];
    expect(verdict({ status: 'ERROR', conditions })).toEqual({
      ok: false,
      reasons: ['new_coverage is 41.2 (fails when LT 80)'],
    });
  });

  test('ERROR with no failed condition listed still fails', () => {
    expect(verdict({ status: 'ERROR', conditions: [] })).toEqual({
      ok: false,
      reasons: ['quality gate ERROR (SonarCloud listed no failed condition)'],
    });
  });

  test('any other status fails, naming it', () => {
    expect(verdict({ status: 'NONE', conditions: [] })).toEqual({
      ok: false,
      reasons: ['quality gate status NONE is not OK'],
    });
  });
});

describe('run', () => {
  const REPORT = `projectKey=ShydenMcM_ShyTalk\nserverUrl=${SERVER}\ndashboardUrl=${SERVER}/dashboard?id=x\nceTaskId=AX1\n`;
  const env = (extra = {}) => ({
    SONAR_TOKEN: TOKEN,
    REPORT_TASK_PATH: 'build/sonar/report-task.txt',
    CEILING_SECONDS: '300',
    EXPECTED_SHA: SHA,
    PR_NUMBER: '2395',
    ...extra,
  });
  const gateReply = (status, conditions = []) => ({
    body: { projectStatus: { status, conditions } },
  });
  const routes = (gate) => ({
    'api/ce/task': [task('SUCCESS', 'AN1')],
    'api/qualitygates/project_status': [gate],
    'api/project_pull_requests/list': [
      { body: { pullRequests: [{ key: '2395', commit: { sha: SHA } }] } },
    ],
  });

  async function go(envVars, routeTable) {
    const out = { summary: [], log: [] };
    const { fetch } = fakeFetch(routeTable);
    const code = await run({
      env: envVars,
      fetch,
      readFile: () => REPORT,
      appendSummary: (text) => out.summary.push(text),
      log: (text) => out.log.push(text),
      ...fakeClock(),
    });
    return { code, text: [...out.summary, ...out.log].join('\n'), summary: out.summary.join('\n') };
  }

  test('a PR whose gate is OK exits 0 and the summary says it ran and passed', async () => {
    const { code, summary } = await go(env(), routes(gateReply('OK')));
    expect(code).toBe(0);
    expect(summary).toContain('SonarCloud quality gate: OK');
    expect(summary).toContain('Scan: ran; SonarCloud processed analysis AN1 after 0s.');
    expect(summary).toContain(`${SERVER}/dashboard?id=x`);
  });

  test('a PR whose gate is ERROR exits 1 and the summary names the failed condition', async () => {
    const failed = [
      {
        status: 'ERROR',
        metricKey: 'new_coverage',
        comparator: 'LT',
        errorThreshold: '80',
        actualValue: '41.2',
      },
    ];
    const { code, summary } = await go(env(), routes(gateReply('ERROR', failed)));
    expect(code).toBe(1);
    expect(summary).toContain('SonarCloud quality gate: FAILED');
    expect(summary).toContain('new_coverage is 41.2 (fails when LT 80)');
  });

  test('an empty token exits 1 naming SONAR_TOKEN and both places it is set', async () => {
    const { code, text } = await go(env({ SONAR_TOKEN: '' }), routes(gateReply('OK')));
    expect(code).toBe(1);
    expect(text).toContain('SONAR_TOKEN is empty');
    expect(text).toContain('Dependabot secret');
  });

  test('a PR verdict for another commit exits 1', async () => {
    const { code, text } = await go(env({ EXPECTED_SHA: 'e'.repeat(40) }), routes(gateReply('OK')));
    expect(code).toBe(1);
    expect(text).toContain(`not ${'e'.repeat(40)}`);
  });

  test('a run with no PR reads the gate of its own analysis and says the commit check does not apply', async () => {
    const { code, summary } = await go(env({ PR_NUMBER: '' }), routes(gateReply('OK')));
    expect(code).toBe(0);
    expect(summary).toContain('not a pull request: the gate read is analysis AN1 of this run');
  });

  test('a missing ceiling exits 1 rather than waiting without end', async () => {
    const { code, text } = await go(env({ CEILING_SECONDS: '' }), routes(gateReply('OK')));
    expect(code).toBe(1);
    expect(text).toContain('CEILING_SECONDS must be a positive whole number');
  });

  test('the token appears in no summary, log or console line, pass or fail', async () => {
    const printed = [];
    const spies = ['log', 'info', 'warn', 'error'].map((name) =>
      jest.spyOn(console, name).mockImplementation((...args) => printed.push(args.join(' '))),
    );
    try {
      const passed = await go(env(), routes(gateReply('OK')));
      const failed = await go(env(), {
        ...routes(gateReply('OK')),
        'api/ce/task': [{ status: 401, body: {} }],
      });
      expect(passed.code).toBe(0);
      expect(failed.code).toBe(1);
      expect([passed.text, failed.text, ...printed].join('\n')).not.toContain(TOKEN);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});
