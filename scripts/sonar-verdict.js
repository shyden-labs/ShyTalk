'use strict';

/**
 * sonar-verdict.js — SHY-0625.
 *
 * Turns this run's SonarCloud analysis into a pass or a fail. The scanner only
 * uploads; it is told not to wait for the quality gate (`sonar.qualitygate.wait`
 * stays false in build.gradle.kts, because the free plan refused that wait on
 * non-main branches). So this step reads the result itself:
 *
 *   report-task.txt (written by the scanner) -> ceTaskId
 *   api/ce/task?id=           -> wait until SUCCESS -> analysisId
 *   api/qualitygates/project_status?analysisId= -> OK, or fail naming why
 *   api/project_pull_requests/list -> on a PR, SonarCloud analysed THIS commit
 *
 * Anything it cannot read fails the step; nothing here passes on a guess.
 * Usage (CI): node scripts/sonar-verdict.js, with the environment described in
 * `run` below. Pinned by express-api/tests/scripts/sonar-verdict.unit.test.js.
 */

const { pollUntil } = require('../express-api/scripts/drivers/poll-until.js');

const TERMINAL_FAILURES = new Set(['FAILED', 'CANCELED']);
const STILL_RUNNING = new Set(['PENDING', 'IN_PROGRESS']);

/** The keys this step needs from the scanner's report-task.txt. */
function readReportTask(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) values[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  for (const key of ['projectKey', 'ceTaskId', 'serverUrl', 'dashboardUrl']) {
    if (!values[key]) throw new Error(`report-task.txt has no ${key}`);
  }
  return {
    projectKey: values.projectKey,
    ceTaskId: values.ceTaskId,
    serverUrl: values.serverUrl,
    dashboardUrl: values.dashboardUrl,
  };
}

/** GET a SonarCloud API path; any reply but 200 fails at once (no retry). */
async function getJson({ fetch, serverUrl, path, token }) {
  const url = `${serverUrl}/${path}`;
  const reply = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (reply.status !== 200) throw new Error(`${url} answered ${reply.status}`);
  return reply.json();
}

/**
 * Waits for the analysis task to leave SonarCloud's queue: one wait through
 * pollUntil (the repo's one clock wait, SHY-0245), which stops the instant the
 * task is no longer PENDING or IN_PROGRESS, or at the ceiling. A task still
 * running at the ceiling fails naming the task, its last status and the time
 * waited.
 */
async function waitForTask({ fetch, serverUrl, taskId, token, ceilingMs, intervalMs }) {
  const started = Date.now();
  const task = await pollUntil(
    async () =>
      (await getJson({ fetch, serverUrl, path: `api/ce/task?id=${taskId}`, token })).task ?? {},
    (polled) => !STILL_RUNNING.has(polled.status),
    { intervalMs, deadlineMs: ceilingMs },
  );
  const status = task.status;
  const elapsedMs = Date.now() - started;
  if (status === 'SUCCESS') {
    if (!task.analysisId) throw new Error(`SonarCloud task ${taskId} succeeded with no analysisId`);
    return { analysisId: task.analysisId, elapsedMs };
  }
  if (TERMINAL_FAILURES.has(status)) throw new Error(`SonarCloud task ${taskId} ended ${status}`);
  if (STILL_RUNNING.has(status)) {
    throw new Error(
      `SonarCloud task ${taskId} still ${status} after ${Math.round(elapsedMs / 1000)}s ` +
        `(ceiling ${Math.round(ceilingMs / 1000)}s)`,
    );
  }
  throw new Error(`SonarCloud task ${taskId} has unknown status ${status}`);
}

/** The quality gate of one analysis. */
async function readGate({ fetch, serverUrl, analysisId, token }) {
  const body = await getJson({
    fetch,
    serverUrl,
    path: `api/qualitygates/project_status?analysisId=${analysisId}`,
    token,
  });
  const status = body?.projectStatus?.status;
  if (!status) throw new Error(`quality gate for analysis ${analysisId} has no status`);
  return { status, conditions: body.projectStatus.conditions ?? [] };
}

/** On a PR: SonarCloud's latest analysis of it must be of the commit CI checked out. */
async function checkCommit({ fetch, serverUrl, projectKey, pullRequest, expectedSha, token }) {
  const body = await getJson({
    fetch,
    serverUrl,
    path: `api/project_pull_requests/list?project=${projectKey}`,
    token,
  });
  const entry = (body?.pullRequests ?? []).find((pr) => String(pr.key) === String(pullRequest));
  if (!entry) throw new Error(`SonarCloud lists no PR ${pullRequest}`);
  const sha = entry.commit?.sha;
  if (sha !== expectedSha)
    throw new Error(`SonarCloud analysed ${sha} for PR ${pullRequest}, not ${expectedSha}`);
}

/** Green only on OK; every other status fails with its reasons. */
function verdict({ status, conditions }) {
  if (status === 'OK') return { ok: true, reasons: [] };
  if (status === 'ERROR') {
    const failed = conditions
      .filter((c) => c.status === 'ERROR')
      .map(
        (c) =>
          `${c.metricKey} is ${c.actualValue} (fails when ${c.comparator} ${c.errorThreshold})`,
      );
    return {
      ok: false,
      reasons: failed.length
        ? failed
        : ['quality gate ERROR (SonarCloud listed no failed condition)'],
    };
  }
  return { ok: false, reasons: [`quality gate status ${status} is not OK`] };
}

/**
 * The CI step. Environment: SONAR_TOKEN, REPORT_TASK_PATH,
 * CEILING_SECONDS, EXPECTED_SHA, PR_NUMBER (empty when not a pull request).
 * Returns the exit code; writes the job summary either way.
 */
async function run({ env, fetch, readFile, appendSummary, log }) {
  const lines = [];
  try {
    if (!env.SONAR_TOKEN) {
      throw new Error(
        'SONAR_TOKEN is empty: set it as an Actions secret, and as a Dependabot secret for Dependabot PRs',
      );
    }
    const ceilingSeconds = Number(env.CEILING_SECONDS);
    if (!Number.isInteger(ceilingSeconds) || ceilingSeconds <= 0) {
      throw new Error(
        `CEILING_SECONDS must be a positive whole number, got "${env.CEILING_SECONDS ?? ''}"`,
      );
    }
    const report = readReportTask(readFile(env.REPORT_TASK_PATH));
    lines.push(`Dashboard: ${report.dashboardUrl}`);
    const token = env.SONAR_TOKEN;
    const { analysisId, elapsedMs } = await waitForTask({
      fetch,
      serverUrl: report.serverUrl,
      taskId: report.ceTaskId,
      token,
      ceilingMs: ceilingSeconds * 1000,
      intervalMs: 5000,
    });
    lines.push(
      `Scan: ran; SonarCloud processed analysis ${analysisId} after ${Math.round(elapsedMs / 1000)}s.`,
    );
    if (env.PR_NUMBER) {
      await checkCommit({
        fetch,
        serverUrl: report.serverUrl,
        projectKey: report.projectKey,
        pullRequest: env.PR_NUMBER,
        expectedSha: env.EXPECTED_SHA,
        token,
      });
      lines.push(`Commit: ${env.EXPECTED_SHA} (PR ${env.PR_NUMBER}).`);
    } else {
      lines.push(
        `Commit check: not a pull request: the gate read is analysis ${analysisId} of this run.`,
      );
    }
    const result = verdict(
      await readGate({ fetch, serverUrl: report.serverUrl, analysisId, token }),
    );
    if (result.ok) {
      // The log carries the summary's lines too: the job summary cannot be
      // read back through the API, and the measured wait sets the ceiling.
      const passed = ['SonarCloud quality gate: OK', ...lines].join('\n');
      appendSummary(passed);
      log(passed);
      return 0;
    }
    throw new Error(result.reasons.join('; '));
  } catch (error) {
    appendSummary(
      ['SonarCloud quality gate: FAILED', `Why: ${error.message}`, ...lines].join('\n'),
    );
    log([`::error::SonarCloud quality gate: FAILED: ${error.message}`, ...lines].join('\n'));
    return 1;
  }
}

module.exports = { readReportTask, waitForTask, readGate, checkCommit, verdict, run };

if (require.main === module) {
  const fs = require('node:fs');
  run({
    env: process.env,
    fetch: globalThis.fetch,
    readFile: (path) => fs.readFileSync(path, 'utf8'),
    appendSummary: (text) => fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`),
    log: (text) => process.stdout.write(`${text}\n`),
  }).then((code) => {
    process.exitCode = code;
  });
}
