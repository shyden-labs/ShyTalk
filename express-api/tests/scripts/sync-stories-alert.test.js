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

  test('the alert runs after the sync, only when it failed', () => {
    expect(alert.needs).toEqual(['sync']);
    expect(alert.if).toMatch(/^\$\{\{\s*failure\(\)\s*\}\}$/);
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
