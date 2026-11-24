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
 * condition with its value and threshold. It then reads the analysis's
 * source lines (`ncloc`, issue #240): none on a branch analysis fails, since the
 * scan read no source code; a pull request's analysis counts only the files it
 * changed, so there none fails only when it changed code outside tests/ (the list
 * SONAR_CHANGED_FILES names; Shyden 2026-11-17). A missing token, an API error, a
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
export function parseReportTask(text: string): { projectKey: string; serverUrl: string; ceTaskId: string; dashboardUrl: string } {
  const values = new Map(text.split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const get = (key: string) => values.get(key) ?? fail(`the scan's report-task.txt has no ${key}; the scan did not finish`);
  return { projectKey: get('projectKey'), serverUrl: get('serverUrl'), ceTaskId: get('ceTaskId'), dashboardUrl: get('dashboardUrl') };
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

const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** The changed files SonarCloud measures as source code: code files outside tests/. */
export function changedCode(files: string[]): string[] {
  return files.filter((f) => CODE.test(f) && !f.startsWith('tests/'));
}

/** Fails when the analysis measured no source lines where it should have measured some. */
function requireSourceLines(ncloc: string | undefined, pullRequest: string, branch: string | undefined): void {
  if (ncloc !== undefined && Number(ncloc) > 0) return;
  const measured = `measured no source lines (ncloc ${ncloc ?? 'missing'}): the scan read no source code, so the gate judged nothing`;
  if (pullRequest === '') fail(`the analysis of branch ${String(branch)} ${measured}`);
  const list = process.env.SONAR_CHANGED_FILES;
  if (!list || !existsSync(list)) {
    fail("SONAR_CHANGED_FILES names no file of the pull request's changed files; cannot judge whether no source lines means no scan");
  }
  const code = changedCode(readFileSync(list, 'utf8').split('\n'));
  if (code.length > 0) fail(`pull request ${pullRequest} changed code outside tests/ (${code.join(', ')}), but its analysis ${measured}`);
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
  type Task = { status: string; analysisId?: string; pullRequest?: string; branch?: string; errorMessage?: string };
  // A poll: each look waits for the one before, and the stated ceiling fails naming the cause (#245).
  const settled = async (waited: number): Promise<Task> => {
    const looked = ((await get(`${report.serverUrl}/api/ce/task?id=${report.ceTaskId}`, token)) as { task: Task }).task;
    if (looked.status !== 'PENDING' && looked.status !== 'IN_PROGRESS') return looked;
    if (waited >= ceiling) fail(`task ${report.ceTaskId} is still ${looked.status} after ${ceiling} s; no verdict to read`);
    await sleep(STEP_MS);
    return settled(waited + STEP_MS / 1000);
  };
  const task = await settled(0);
  if (task.status !== 'SUCCESS') {
    const why = task.errorMessage ? ' (' + task.errorMessage + ')' : '';
    fail(`task ${report.ceTaskId} ended ${task.status}${why}; no verdict to read`);
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
  const scope = pullRequest === '' ? `branch=${String(task.branch)}` : `pullRequest=${pullRequest}`;
  const measures = (
    (await get(`${report.serverUrl}/api/measures/component?component=${report.projectKey}&metricKeys=ncloc&${scope}`, token)) as {
      component: { measures: { metric: string; value: string }[] };
    }
  ).component.measures;
  requireSourceLines(measures.find((m) => m.metric === 'ncloc')?.value, pullRequest, task.branch);
  return { ...verdict(status), dashboardUrl: report.dashboardUrl };
}

await runIfEntry(import.meta.url, main);
