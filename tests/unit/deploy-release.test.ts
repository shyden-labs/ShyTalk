import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutYamlComments, withoutYamlQuotes, yamlBlock as topLevel } from './source-text.ts';

/**
 * TEST and PROD deploy the website from a release cut (shyden-labs/ShyTalk#116):
 * a push to `release/*` deploys TEST through `test`, a push to `main` deploys
 * PROD through `production`, which waits for Shyden's approval. Read from
 * comment-stripped, quote-free text, as deploy-dev's test does, so a comment
 * cannot stand in for a line.
 */

const WORKFLOW = '.github/workflows/deploy-release.yml';
const workflow = () => withoutYamlQuotes(withoutYamlComments(readFileSync(WORKFLOW, 'utf8')));
const jobs = () => topLevel(workflow(), 'jobs').split('\n');

const deployStep = (): string => {
  const lines = jobs();
  const start = lines.indexOf('      - name: Deploy the website');
  expect(start).toBeGreaterThan(-1);
  return lines.slice(start).join('\n');
};

describe('deploy-release', () => {
  it('runs on a push to a release cut or to main, on a pull request changing it, and otherwise only by hand', () => {
    expect(topLevel(workflow(), 'on')).toBe(
      [
        'on:',
        '  push:',
        '    branches: [release/**, main]',
        '  pull_request:',
        '    paths: [.github/workflows/deploy-release.yml]',
        '  workflow_dispatch:',
      ].join('\n'),
    );
  });

  // A hand-started run on any other branch skips before asking for approval;
  // what keeps a credential out is each environment's own branch rule.
  it('has one job, run only on a pull request, main or a release cut', () => {
    const lines = jobs();
    expect(lines.filter((line) => /^ {2}\S/.test(line))).toEqual(['  deploy-release:']);
    expect(lines.filter((line) => /^ {4}if:/.test(line))).toEqual([
      '    if: ${{ github.event_name == pull_request || github.ref == refs/heads/main || startsWith(github.ref, refs/heads/release/) }}',
    ]);
  });

  it('gives the job no key but its condition, runner, environment and steps', () => {
    const keys = jobs()
      .filter((line) => /^ {4}\S/.test(line))
      .map((line) => line.trim().split(':')[0]);
    expect(keys).toEqual(['if', 'runs-on', 'environment', 'steps']);
  });

  it('deploys main through production, a release cut through test, and rehearses in release-rehearsal', () => {
    const lines = jobs();
    expect(lines).toContain(
      '    environment: ${{ github.event_name == pull_request && release-rehearsal || github.ref == refs/heads/main && production || test }}',
    );
  });

  // A deploy stopped halfway leaves an environment undefined, so a newer run
  // waits; TEST and PROD never share a queue, nor does a rehearsal.
  it('queues each environment behind its own running deploy', () => {
    expect(topLevel(workflow(), 'concurrency')).toBe(
      [
        'concurrency:',
        '  group: ${{ github.event_name == pull_request && format(deploy-release-rehearsal-{0}, github.event.pull_request.number) || format(deploy-release-{0}, github.ref) }}',
        '  cancel-in-progress: false',
      ].join('\n'),
    );
  });

  it('names the Worker environment prod on main and test otherwise', () => {
    expect(deployStep()).toContain('          TARGET: ${{ github.ref == refs/heads/main && prod || test }}');
  });

  it('builds the website, and a rehearsal only bundles both environments, holding no credential', () => {
    const step = deployStep();
    const build = step.indexOf('npm run build:web ||');
    const rehearsal = step.indexOf('if [ $DEPLOY_REHEARSAL = true ]; then');
    const test = step.indexOf('npx wrangler deploy --dry-run --env test --outdir $RUNNER_TEMP/test ||');
    const prod = step.indexOf('npx wrangler deploy --dry-run --env prod --outdir $RUNNER_TEMP/prod ||');
    const exit = step.indexOf('exit 0', prod);
    const firstCloudCall = step.indexOf('npx wrangler d1');
    expect(build).toBeGreaterThan(-1);
    expect(rehearsal).toBeGreaterThan(build);
    expect(test).toBeGreaterThan(rehearsal);
    expect(prod).toBeGreaterThan(test);
    expect(firstCloudCall).toBeGreaterThan(exit);
  });

  it('readies the database, in order, before the Worker deploys', () => {
    const step = deployStep();
    const order = [
      'info=$(npx wrangler d1 info shytalk-$TARGET --env $TARGET 2>&1) || {',
      '*Couldnt find a D1 DB named shytalk-$TARGET*) npx wrangler d1 create shytalk-$TARGET --location apac ||',
      'npx wrangler d1 migrations apply DB --remote --env $TARGET ||',
      'INSERT INTO environment_marker (name) SELECT $TARGET WHERE NOT EXISTS',
      'marker=$(npx wrangler d1 execute DB --remote --env $TARGET --json --command SELECT name FROM environment_marker) ||',
      'if [ $(printf %s $marker | jq --arg t $TARGET [.[0].results[].name] == [$t]) != true ]; then',
      'npx wrangler deploy --env $TARGET ||',
    ].map((line) => step.indexOf(line));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(step.match(/wrangler d1 create/g)).toHaveLength(1);
  });

  it('stops on any d1 info error other than not-found, with no retry', () => {
    expect(deployStep()).toContain('*) echo ::error title=deploy-release failed::d1 info shytalk-$TARGET failed; exit 1 ;;');
  });

  // The TEST origin refuses every request without its door secret (decision
  // 216); PROD has no door (workers/web/src/web.ts).
  it('puts the door secret on TEST only, after the deploy, failing by name when test lacks it', () => {
    const step = deployStep();
    const deploy = step.indexOf('npx wrangler deploy --env $TARGET ||');
    const onlyTest = step.indexOf('if [ $TARGET = test ]; then');
    const missing = step.indexOf('if [ -z $DOOR_SECRET ]; then');
    const put = step.indexOf('printf %s $DOOR_SECRET | npx wrangler secret put DOOR_SECRET --env test ||');
    expect(deploy).toBeGreaterThan(-1);
    expect(onlyTest).toBeGreaterThan(deploy);
    expect(missing).toBeGreaterThan(onlyTest);
    expect(put).toBeGreaterThan(missing);
    expect(step).toContain('DOOR_SECRET: ${{ secrets.DOOR_SECRET }}');
    expect(step).not.toContain('secret put DOOR_SECRET --env prod');
    expect(step).not.toContain('secret put DOOR_SECRET --env $TARGET');
  });

  // App sign-in answers 503 until the Worker holds Better Auth's secret
  // (shyden-labs/ShyTalk#110); TEST and PROD each need their own.
  it('puts the Better Auth secret on TEST and PROD, after the deploy, failing by name when the environment lacks it', () => {
    const step = deployStep();
    const deploy = step.indexOf('npx wrangler deploy --env $TARGET ||');
    const missing = step.indexOf('if [ -z $BETTER_AUTH_SECRET ]; then');
    const named = step.indexOf(
      'echo ::error title=BETTER_AUTH_SECRET missing::Set BETTER_AUTH_SECRET in this runs GitHub environment (shyden-labs/ShyTalk#110); until then $TARGET app sign-in answers 503.',
    );
    const put = step.indexOf('printf %s $BETTER_AUTH_SECRET | npx wrangler secret put BETTER_AUTH_SECRET --env $TARGET ||');
    expect(deploy).toBeGreaterThan(-1);
    expect(missing).toBeGreaterThan(deploy);
    expect(named).toBeGreaterThan(missing);
    expect(put).toBeGreaterThan(named);
    expect(step).toContain('BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}');
    // Outside the TEST-only door block, so PROD gets it too.
    const onlyTest = step.indexOf('if [ $TARGET = test ]; then');
    expect(onlyTest === -1 || put < onlyTest).toBe(true);
  });

  it('never deploys a door', () => {
    expect(workflow()).not.toContain('workers/door');
  });
});
