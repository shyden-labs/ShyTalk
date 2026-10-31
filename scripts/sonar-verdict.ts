/**
 * Reads SonarCloud's quality-gate verdict for the analysis THIS run's scan
 * made, and passes only on OK (issue shyden-labs/repo-template#27; Shyden 2026-10-18: "don't pass if it
 * doesn't run", "make sure we check the results and fail the workflow if it
 * fails"):
 *
 *   node scripts/sonar-verdict.ts .scannerwork/report-task.txt
 *
 * The scan writes its Compute Engine task id to report-task.txt; this reads
 * that task (`api/ce/task`), waits while it is pending up to a stated ceiling
 * (SONAR_CEILING_SECONDS, 300 by default, 5 s at a time: one wait, no retry),
 * then reads the gate of the analysis it made (`api/qualitygates/project_status
 * ?analysisId=`), never the project's latest. ERROR fails naming each failed
 * condition with its value and threshold. A missing token, an API error, a
 * failed task, no analysis, a task for another pull request, or any status but
 * OK fails closed, naming what was missing. Auth is `Authorization: Bearer`.
 *
 * Unconfirmed until the first real scan (docs/sonarcloud.md): that the scan
 * action writes `.scannerwork/report-task.txt` with these keys, and that the
 * task names its pull request. Each fails closed by name if it does not.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { runIfEntry } from './cli.ts';

interface Condition {
  status: string;
  metricKey: string;
  comparator?: string;
  errorThreshold?: string;
  actualValue?: string;
}

interface ProjectStatus {
  status?: string;
  conditions?: Condition[];
}

const STEP_MS = 5000;

function fail(message: string): never {
  throw new Error(`sonar-verdict: ${message}`);
}

/** The scan's task id, server and dashboard, from report-task.txt (`key=value` lines). */
export function parseReportTask(text: string): { serverUrl: string; ceTaskId: string; dashboardUrl: string } {
  const values = new Map(text.split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const get = (key: string) => values.get(key) ?? fail(`the scan's report-task.txt has no ${key}; the scan did not finish`);
  return { serverUrl: get('serverUrl'), ceTaskId: get('ceTaskId'), dashboardUrl: get('dashboardUrl') };
}

/** Green only on OK; ERROR names each failed condition with its value and threshold. */
export function verdict(status: ProjectStatus): { ok: boolean; lines: string[] } {
  if (status.status === 'OK') return { ok: true, lines: ['quality gate: OK'] };
  if (status.status !== 'ERROR') return { ok: false, lines: [`quality gate: ${String(status.status)}, not OK`] };
  const failed = (status.conditions ?? []).filter((c) => c.status === 'ERROR');
  return {
    ok: false,
    lines: [
      'quality gate: ERROR',
      ...failed.map(
        (c) =>
          `${c.metricKey} is ${String(c.actualValue)}, which fails ${String(c.comparator)} ${c.errorThreshold ?? '(no threshold given)'}`,
      ),
    ],
  };
}

async function get(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) fail(`GET ${url} answered ${response.status}; no verdict to read`);
  return response.json();
}

/** Adds a section to the job's summary, when the job has one. */
function summary(body: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `### SonarCloud\n\n${body}\n`);
}

export async function main(args: string[]): Promise<number> {
  const [path, ...rest] = args;
  if (path === undefined || rest.length > 0) throw new Error('usage: node scripts/sonar-verdict.ts <.scannerwork/report-task.txt>');
  try {
    const { ok, lines, dashboardUrl } = await judge(path);
    summary(`The scan ran. ${lines.join('; ')}\n\n${dashboardUrl}`);
    for (const line of lines) (ok ? process.stdout : process.stderr).write(`sonar-verdict: ${line}\n`);
    process.stdout.write(`sonar-verdict: ${dashboardUrl}\n`);
    return ok ? 0 : 1;
  } catch (error) {
    summary(`No verdict: ${(error as Error).message}`);
    throw error;
  }
}

/** This scan's verdict, or a throw naming why there is none. */
async function judge(path: string): Promise<{ ok: boolean; lines: string[]; dashboardUrl: string }> {
  const token = process.env.SONAR_TOKEN;
  if (!token) {
    return fail(
      'SONAR_TOKEN is empty; set it as an Actions secret, and as a Dependabot secret for Dependabot pull requests (docs/sonarcloud.md)',
    );
  }
  if (!existsSync(path)) fail(`no report-task.txt at ${path}: the scan did not run`);
  const report = parseReportTask(readFileSync(path, 'utf8'));
  const ceiling = Number(process.env.SONAR_CEILING_SECONDS || 300);
  let task: { status: string; analysisId?: string; pullRequest?: string; errorMessage?: string };
  for (let waited = 0; ; waited += STEP_MS / 1000) {
    task = ((await get(`${report.serverUrl}/api/ce/task?id=${report.ceTaskId}`, token)) as { task: typeof task }).task;
    if (task.status !== 'PENDING' && task.status !== 'IN_PROGRESS') break;
    if (waited >= ceiling) fail(`task ${report.ceTaskId} is still ${task.status} after ${ceiling} s; no verdict to read`);
    await sleep(STEP_MS);
  }
  if (task.status !== 'SUCCESS') {
    fail(`task ${report.ceTaskId} ended ${task.status}${task.errorMessage ? ` (${task.errorMessage})` : ''}; no verdict to read`);
  }
  if (task.analysisId === undefined) fail(`task ${report.ceTaskId} made no analysis; no verdict to read`);
  const pullRequest = process.env.SONAR_PULL_REQUEST || '';
  if (pullRequest !== '' && task.pullRequest !== pullRequest) {
    fail(`task ${report.ceTaskId} analysed pull request ${String(task.pullRequest)}, not ${pullRequest}: a verdict for another commit`);
  }
  const status = (
    (await get(`${report.serverUrl}/api/qualitygates/project_status?analysisId=${task.analysisId}`, token)) as {
      projectStatus: ProjectStatus;
    }
  ).projectStatus;
  return { ...verdict(status), dashboardUrl: report.dashboardUrl };
}

await runIfEntry(import.meta.url, main);
