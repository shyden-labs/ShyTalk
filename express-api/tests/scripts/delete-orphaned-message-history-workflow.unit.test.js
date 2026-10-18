/**
 * SHY-0631 — the orphaned message history workflow (Shyden, 2026-10-18):
 * dev runs straight away; production waits for his approval in the
 * `production` environment and runs only from `main`. Each run is a dry run
 * unless `apply` is set, and `--apply` always names its own project.
 */
const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const WORKFLOW = join(
  __dirname,
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'delete-orphaned-message-history.yml',
);
const workflow = yaml.load(readFileSync(WORKFLOW, 'utf8'));
const { dev, prod } = workflow.jobs;

/** Every `run:` body of a job, joined. */
const runText = (job) =>
  job.steps
    .filter((step) => step.run)
    .map((step) => step.run)
    .join('\n');

describe('delete-orphaned-message-history workflow', () => {
  test('runs only when dispatched by hand', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  });

  test('defaults to a dry run on dev', () => {
    const { target, apply } = workflow.on.workflow_dispatch.inputs;
    expect(target.default).toBe('dev');
    expect(target.options).toEqual(['dev', 'prod']);
    expect(apply.default).toBe(false);
  });

  test('has exactly a dev job and a prod job', () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual(['dev', 'prod']);
  });

  test('the prod job waits for approval in the production environment', () => {
    expect(prod.environment).toBe('production');
    expect(prod.if).toBe("inputs.target == 'prod'");
  });

  test('the prod job refuses anything but main before it reads a secret', () => {
    const first = prod.steps[0];
    expect(first.env.REF).toBe('${{ github.ref }}');
    expect(first.run).toContain('if [ "$REF" != "refs/heads/main" ]; then');
    expect(first.run).toContain('exit 1');
    expect(JSON.stringify(first)).not.toContain('secrets.');
  });

  test('the dev job runs without an environment and only for dev', () => {
    expect(dev.environment).toBeUndefined();
    expect(dev.if).toBe("inputs.target == 'dev'");
  });

  test('each job reads only its own project’s service account', () => {
    expect(JSON.stringify(dev)).not.toContain('FIREBASE_SERVICE_ACCOUNT_PROD');
    expect(JSON.stringify(prod)).not.toContain('FIREBASE_SERVICE_ACCOUNT_DEV');
  });

  test('--apply names the job’s own project', () => {
    expect(runText(dev)).toContain('args=(--apply --project shytalk-dev)');
    expect(runText(prod)).toContain('args=(--apply --project shytalk-7ba69)');
  });

  test('the inputs reach the shell through env, never inlined', () => {
    for (const job of [dev, prod]) expect(runText(job)).not.toContain('${{');
  });
});
