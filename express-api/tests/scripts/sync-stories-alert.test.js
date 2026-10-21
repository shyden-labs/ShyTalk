/**
 * sync-stories-alert.test.js — SHY-0545.
 *
 * After the organisation rename the story sync failed on every develop push
 * for five days and nobody was told. These pins hold the fix:
 *
 *   1. the sync's default project owner is the current organisation;
 *   2. a failed sync runs a separate alert job that opens (or comments on)
 *      one issue assigned to the operator, with its own narrow token, so the
 *      alert does not depend on the token the sync itself uses;
 *   3. report links name the Pages custom domain, not the owner's Pages
 *      address, which only redirects there over plain http.
 *
 * Spec: .project/stories/SHY-0545-the-story-sync-reaches-the-renamed-organisation.md
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const WORKFLOW = '.github/workflows/sync-stories-to-issues.yml';
const REPORTS = 'https://reports.shytalk.shyden.co.uk/';

describe('SHY-0545 — the sync names the current organisation', () => {
  test('the default project owner is shyden-labs', () => {
    expect(read('scripts/sync-stories-to-issues.sh')).toContain(
      'PROJECT_OWNER="${PROJECT_OWNER:-shyden-labs}"',
    );
  });

  test('the workflow does not override the owner with another login', () => {
    expect(read(WORKFLOW)).not.toMatch(/PROJECT_OWNER\s*:/);
  });
});

describe('SHY-0545 — a failed sync tells the operator', () => {
  const doc = yaml.load(read(WORKFLOW));
  const alert = doc.jobs.alert;
  const run = (alert?.steps ?? []).map((s) => s.run ?? '').join('\n');
  const env = Object.assign({}, ...(alert?.steps ?? []).map((s) => s.env ?? {}));

  test('the workflow has exactly the sync and alert jobs', () => {
    expect(Object.keys(doc.jobs).sort()).toEqual(['alert', 'sync']);
  });

  test('the alert runs after the sync when it failed or was cut short', () => {
    // SHY-0686: GitHub reports a timed-out job as cancelled, which failure()
    // does not match: two syncs hit the limit on 2026-10-21 and nobody was told.
    expect(alert.needs).toEqual(['sync']);
    expect(alert.if).toMatch(/^\$\{\{\s*failure\(\)\s*\|\|\s*cancelled\(\)\s*\}\}$/);
  });

  test("the alert's token can write issues and read run jobs, nothing else", () => {
    expect(alert.permissions).toEqual({ issues: 'write', actions: 'read' });
  });

  test('the workflow-level permissions are unchanged and the sync job adds none', () => {
    expect(doc.permissions).toEqual({ contents: 'read' });
    expect(doc.jobs.sync.permissions).toBeUndefined();
  });

  test("the alert uses the run's own token, not the sync's project token", () => {
    expect(env.GH_TOKEN).toBe('${{ github.token }}');
    expect(JSON.stringify(alert)).not.toContain('GH_PAT_PROJECT');
  });

  test('the alert names the run and is assigned to the operator', () => {
    expect(env.RUN_URL).toBe(
      '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
    );
    expect(run).toMatch(/gh issue create[\s\S]*--assignee ShydenMcM/);
  });

  test('a second failure comments on the open issue instead of opening another', () => {
    expect(run).toMatch(/gh issue list[\s\S]*--state open/);
    expect(run).toMatch(/gh issue comment/);
  });

  test('the alert names the failed job and step, read from the run itself', () => {
    expect(run).toMatch(/actions\/runs\/\$\{?RUN_ID\}?\/jobs/);
  });

  test('the alert step fails loudly', () => {
    expect(run.startsWith('set -euo pipefail\n')).toBe(true);
  });
});

describe('SHY-0545 — report links name the Pages custom domain', () => {
  test.each([
    ['.github/actions/publish-gh-pages/action.yml', 1],
    ['.github/workflows/allure-report.yml', 2],
  ])('%s links the reports host %i time(s) and no Pages address', (rel, times) => {
    const text = read(rel);
    expect({
      reportsLinks: text.split(REPORTS).length - 1,
      pagesHost: /github\.io/.test(text),
    }).toEqual({
      reportsLinks: times,
      pagesHost: false,
    });
  });
});

describe('SHY-0686 — a push syncs only what it changed, and a full pass runs daily', () => {
  const doc = yaml.load(read(WORKFLOW));
  const sync = doc.jobs.sync;
  const syncStep = sync.steps.find((s) => s.name === 'Sync stories to GitHub Issues');
  const script = syncStep?.run ?? '';

  test('an unset project token fails the step instead of passing it', () => {
    const start = script.indexOf('if [ -z "${GH_PAT_PROJECT:-}" ]');
    const branch = script.slice(start, script.indexOf('fi', start));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(branch).toContain('::error::');
    expect(branch).toContain('exit 1');
    expect(branch).not.toContain('exit 0');
  });

  test('a push passes its before commit and the checked-out head to --changed', () => {
    expect(syncStep.env.BEFORE).toBe('${{ github.event.before }}');
    expect(syncStep.env.EVENT).toBe('${{ github.event_name }}');
    expect(script).toMatch(/args=\(--changed "\$BEFORE" "\$\(git rev-parse HEAD\)"\)/);
  });

  test('the before commit is fetched before the diff', () => {
    expect(script).toMatch(
      /git fetch --no-tags --depth=1 origin "\$BEFORE"[\s\S]*args=\(--changed/,
    );
  });

  test('a push with no before commit (a new branch, all zeros) runs the full pass', () => {
    expect(script).toMatch(/0{40}[\s\S]*args=\(--all\)/);
  });

  test('a daily full pass runs on a schedule', () => {
    expect(doc.on.schedule).toEqual([{ cron: '17 3 * * *' }]);
  });

  test('a push sync keeps its 15-minute limit; the full pass has its own', () => {
    expect(String(sync['timeout-minutes'])).toMatch(
      /^\$\{\{\s*github\.event_name == 'push' && 15 \|\| \d+\s*\}\}$/,
    );
  });
});

describe('SHY-0686 — the alert names a cut-short job and step', () => {
  const doc = yaml.load(read(WORKFLOW));
  const alertRun = doc.jobs.alert.steps.map((s) => s.run ?? '').join('\n');
  test('jobs and steps that were cancelled are named, not only failed ones', () => {
    const either = /select\(\.conclusion == "failure" or \.conclusion == "cancelled"\)/g;
    expect(alertRun.match(either)).toHaveLength(2);
  });
});

describe('SHY-0686 — the sync step is told the limit it runs under', () => {
  const doc = yaml.load(read(WORKFLOW));
  const step = doc.jobs.sync.steps.find((s) => s.name === 'Sync stories to GitHub Issues');
  test('SYNC_LIMIT_MINUTES is the job timeout, the same expression', () => {
    expect(step.env.SYNC_LIMIT_MINUTES).toBe(String(doc.jobs.sync['timeout-minutes']));
  });
});
