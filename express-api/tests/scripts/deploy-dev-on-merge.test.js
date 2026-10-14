'use strict';

/**
 * deploy-dev-on-merge.test.js — SHY-0534.
 *
 * Shyden, 2026-10-14: "[Everything] but only if something is touched in every
 * area. be sensible and only deploy what's got changes to it." A push to
 * develop starts Deploy To Dev; a daily run catches anything a push missed;
 * hand dispatch works as before. This file pins the workflow's wiring; the
 * decisions themselves are tested in deploy-plan.test.js and
 * deploy-failure-issue.test.js.
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

const WORKFLOW = join(__dirname, '..', '..', '..', '.github', 'workflows', 'deploy-dev.yml');
const source = readFileSync(WORKFLOW, 'utf8');
const wf = yaml.load(source);
const jobs = wf.jobs;

const step = (job, name) => {
  const found = jobs[job].steps.filter((s) => s.name === name);
  if (found.length !== 1) throw new Error(`${job} has ${found.length} steps named "${name}"`);
  return found[0];
};
const needsOf = (job) => [jobs[job].needs].flat();

const DEPLOY_JOBS = [
  ['deploy-backend-dev', 'backend'],
  ['deploy-web-dev', 'web'],
  ['distribute-android', 'android'],
  ['distribute-ios', 'ios'],
];

describe('triggers', () => {
  test('exactly push, the daily schedule and hand dispatch', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['push', 'schedule', 'workflow_dispatch']);
  });

  test('a push to develop only: no other branch, no tags, no path filter', () => {
    expect(wf.on.push).toEqual({ branches: ['develop'] });
  });

  test('one daily schedule', () => {
    expect(wf.on.schedule).toHaveLength(1);
    expect(wf.on.schedule[0].cron).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });

  test('hand dispatch keeps every input it had', () => {
    expect(Object.keys(wf.on.workflow_dispatch.inputs)).toEqual([
      'ref',
      'backend',
      'web',
      'android-testers',
      'ios-testers',
      'playwright',
      'seed-personas',
      'release-notes',
    ]);
  });
});

describe('permissions and concurrency', () => {
  test('the only new permission is issues: write, for the failure report', () => {
    expect(wf.permissions).toEqual({ contents: 'write', actions: 'read', issues: 'write' });
  });

  test('runs queue in one group and never cancel a running deploy', () => {
    expect(wf.concurrency).toEqual({ group: 'deploy-dev', 'cancel-in-progress': false });
  });
});

describe('one decision point', () => {
  test('the scope job asks scripts/deploy-plan.js, with the event and every input', () => {
    const plan = step('detect-deploy-scope', 'Resolve baseline and classify the change set');
    expect(plan.run).toContain('node scripts/deploy-plan.js');
    expect(plan.env).toMatchObject({
      EVENT: '${{ github.event_name }}',
      INPUT_BACKEND: '${{ inputs.backend }}',
      INPUT_WEB: '${{ inputs.web }}',
      INPUT_ANDROID_TESTERS: '${{ inputs.android-testers }}',
      INPUT_IOS_TESTERS: '${{ inputs.ios-testers }}',
      INPUT_SEED_PERSONAS: '${{ inputs.seed-personas }}',
      INPUT_PLAYWRIGHT: '${{ inputs.playwright }}',
    });
  });

  test('the scope job still classifies with scripts/deploy-scope.sh', () => {
    expect(
      step('detect-deploy-scope', 'Resolve baseline and classify the change set').run,
    ).toContain('bash scripts/deploy-scope.sh');
  });

  test('the baseline is still the last SUCCESSFUL dev deploy, so a failed one is deployed again', () => {
    expect(step('detect-deploy-scope', 'Resolve baseline and classify the change set').run).toMatch(
      /gh run list --workflow deploy-dev\.yml --status success/,
    );
  });

  test('the scope job publishes every decision', () => {
    expect(Object.keys(jobs['detect-deploy-scope'].outputs).sort()).toEqual(
      [
        'android',
        'backend',
        'baseline',
        'changed_android',
        'changed_backend',
        'changed_ios',
        'changed_web',
        'checks',
        'ios',
        'reason',
        'seed',
        'trigger',
        'web',
      ].sort(),
    );
  });

  test.each(DEPLOY_JOBS)("%s runs on the plan's %s decision", (job, area) => {
    expect(jobs[job].if).toContain(`needs.detect-deploy-scope.outputs.${area} == 'true'`);
    expect(needsOf(job)).toContain('detect-deploy-scope');
  });

  test.each(Object.keys(jobs))('job %s reads no dispatch input in its condition', (job) => {
    expect(String(jobs[job].if ?? '')).not.toMatch(/inputs\./);
  });

  test("the persona seed runs on the plan's seed decision, once the backend deployed", () => {
    expect(jobs['seed-dev-personas'].if).toBe(
      "needs.deploy-backend-dev.result == 'success' && needs.detect-deploy-scope.outputs.seed == 'true'",
    );
    expect(needsOf('seed-dev-personas')).toEqual(['deploy-backend-dev', 'detect-deploy-scope']);
  });

  test("the sanity checks run on the plan's checks decision, only after the backend or web deployed", () => {
    const cond = jobs['sanity-check'].if.replace(/\s+/g, ' ');
    expect(cond).toContain("needs.detect-deploy-scope.outputs.checks == 'true'");
    expect(cond).toContain(
      "(needs.deploy-backend-dev.result == 'success' || needs.deploy-web-dev.result == 'success')",
    );
    expect(needsOf('sanity-check')).toContain('detect-deploy-scope');
  });

  test("the smoke tests run on the plan's checks decision", () => {
    expect(jobs['smoke-tests'].if).toContain("needs.detect-deploy-scope.outputs.checks == 'true'");
    expect(needsOf('smoke-tests')).toContain('detect-deploy-scope');
  });
});

describe('a selected area is never skipped for a job it needs that had nothing to do', () => {
  test.each(['deploy-web-dev', 'distribute-android', 'distribute-ios'])(
    '%s opts out of the implicit needs gate and accepts a skipped backend',
    (job) => {
      const cond = jobs[job].if.replace(/\s+/g, ' ');
      expect(cond.startsWith('always() &&')).toBe(true);
      expect(cond).toContain(
        "(needs.deploy-backend-dev.result == 'success' || needs.deploy-backend-dev.result == 'skipped')",
      );
    },
  );
});

describe('one sha per run', () => {
  const refs = [...source.matchAll(/^\s+ref: (.+)$/gm)].map((m) => m[1]);

  test('every checkout pins the commit the run started on (or the typed ref), never a moving branch', () => {
    expect(refs.length).toBeGreaterThanOrEqual(8);
    expect(new Set(refs)).toEqual(new Set(['${{ inputs.ref || github.sha }}']));
  });
});

describe('a failed automatic deploy is reported', () => {
  const report = () => jobs['report-automatic-deploy'];

  test('runs after every other job, whatever they concluded, on automatic runs only', () => {
    expect(report().if.replace(/\s+/g, ' ')).toBe(
      "always() && github.event_name != 'workflow_dispatch'",
    );
    expect(needsOf('report-automatic-deploy').sort()).toEqual(
      Object.keys(jobs)
        .filter((j) => j !== 'report-automatic-deploy')
        .sort(),
    );
  });

  test("hands every job's result to scripts/deploy-failure-issue.js", () => {
    const s = step('report-automatic-deploy', 'Open, update or close the tracking issue');
    expect(s.run).toBe('node scripts/deploy-failure-issue.js');
    expect(s.env).toMatchObject({
      NEEDS: '${{ toJSON(needs) }}',
      GH_TOKEN: '${{ github.token }}',
      RUN_URL:
        '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
      RUN_SHA: '${{ github.sha }}',
      TRIGGER: '${{ github.event_name }}',
    });
  });
});

describe('the run says why it ran', () => {
  test('the summary names the trigger, the baseline and the head', () => {
    const run = step('detect-deploy-scope', 'Summarise').run;
    expect(run).toContain('trigger: \\`${{ steps.scope.outputs.trigger }}\\`');
    expect(run).toContain('baseline: \\`${{ steps.scope.outputs.baseline }}\\`');
    expect(run).toContain('head: \\`${{ github.sha }}\\`');
  });
});
