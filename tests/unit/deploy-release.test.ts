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

  it('gives the job no key but its condition, runner, timeout, environment and steps', () => {
    const keys = jobs()
      .filter((line) => /^ {4}\S/.test(line))
      .map((line) => line.trim().split(':')[0]);
    expect(keys).toEqual(['if', 'runs-on', 'timeout-minutes', 'environment', 'steps']);
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

  // shyden-labs/ShyTalk#79: the app's UI document reaches TEST from a release
  // cut and PROD only from main, through the approved `production` run.
  it('publishes the UI document to the target from the repository root, by database id, after the marker and before the Worker deploys', () => {
    const step = deployStep();
    const marker = step.indexOf('if [ $(printf %s $marker | jq --arg t $TARGET [.[0].results[].name] == [$t]) != true ]; then');
    const id = step.indexOf(
      'ui_db=$(npx wrangler d1 info shytalk-$TARGET --env $TARGET --json | jq -er .uuid) || { echo ::error title=deploy-release failed::the shytalk-$TARGET id could not be read; exit 1; }',
    );
    const publish = step.indexOf(
      '(cd $GITHUB_WORKSPACE && UI_ENVIRONMENT=$TARGET UI_DATABASE_NAME=shytalk-$TARGET UI_DATABASE_ID=$ui_db UI_PUBLISHED_BY=ci:deploy-release node scripts/publish-ui.ts) || { echo ::error title=deploy-release failed::the UI document was not published to $TARGET; exit 1; }',
    );
    expect(marker).toBeGreaterThan(-1);
    expect(id).toBeGreaterThan(marker);
    expect(publish).toBeGreaterThan(id);
    expect(step.indexOf('npx wrangler deploy --env $TARGET ||')).toBeGreaterThan(publish);
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

  // Plan 4 Task 8 (shyden-labs/ShyTalk#81): as on DEV, last, a fresh masked
  // announce secret is put in the Worker and the Worker is called with it, on
  // TEST and PROD alike (after the TEST-only door block).
  it('tells open apps the UI version last on TEST and PROD, with a fresh masked secret it puts in the Worker', () => {
    const step = deployStep();
    const doorEnd = step.indexOf('npx wrangler secret put DOOR_SECRET --env test ||');
    const make = step.indexOf(
      'announce_secret=$(openssl rand -hex 32) || { echo ::error title=deploy-release failed::no announce secret was made; exit 1; }',
    );
    const mask = step.indexOf('echo ::add-mask::$announce_secret');
    const put = step.indexOf(
      'printf %s $announce_secret | npx wrangler secret put ANNOUNCE_SECRET --env $TARGET || { echo ::error title=deploy-release failed::the $TARGET announce secret was not set; exit 1; }',
    );
    const call = step.indexOf(
      '(cd $GITHUB_WORKSPACE && ANNOUNCE_ENVIRONMENT=$TARGET ANNOUNCE_SECRET=$announce_secret node scripts/announce-ui.ts) || { echo ::error title=deploy-release failed::open apps on $TARGET were not told the UI version; exit 1; }',
    );
    expect(doorEnd).toBeGreaterThan(-1);
    expect(make).toBeGreaterThan(doorEnd);
    expect(mask).toBeGreaterThan(make);
    expect(put).toBeGreaterThan(mask);
    expect(call).toBeGreaterThan(put);
    // Only the deployed marker follows it in this step (shyden-labs/ShyTalk#88).
    const after = step
      .slice(call)
      .split('\n')
      .filter((line) => line.trim() !== '');
    expect(
      after.slice(
        1,
        after.findIndex((line) => line.startsWith('      - name: ')),
      ),
    ).toEqual(['          echo deployed=true >> $GITHUB_OUTPUT']);
    expect(step).not.toContain('secrets.ANNOUNCE_SECRET');
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

  // shyden-labs/ShyTalk#88: the five Oracle secrets reach only a last step of
  // their own, which runs nothing but `wrangler secret put`, and only after the
  // deploy step deployed (it records `deployed=true` last). The build and the
  // UI scripts never see the private key.
  const ORACLE = ['OCI_TENANCY', 'OCI_USER', 'OCI_FINGERPRINT', 'OCI_PRIVATE_KEY', 'OCI_COMPARTMENT'];
  const SECRETS_STEP = 'Put the Oracle mail secrets';
  const stepNamed = (name: string): string[] => {
    const lines = topLevel(workflow(), 'jobs').split('\n');
    const start = lines.indexOf(`      - name: ${name}`);
    expect(start).toBeGreaterThan(-1);
    const next = lines.findIndex((line, index) => index > start && line.startsWith('      - name: '));
    return lines.slice(start, next === -1 ? undefined : next).filter((line) => line.trim() !== '');
  };

  it('keeps every Oracle secret out of the deploy step', () => {
    expect(stepNamed('Deploy the website').join('\n')).not.toContain('OCI_');
  });

  it('records that it deployed, as the last line of the deploy step', () => {
    const step = stepNamed('Deploy the website');
    expect(step).toContain('        id: deploy');
    expect(step.at(-1)).toBe('          echo deployed=true >> $GITHUB_OUTPUT');
  });

  it('puts the secrets in the last step, only after a deploy, from workers/web', () => {
    const names = topLevel(workflow(), 'jobs')
      .split('\n')
      .filter((line) => line.startsWith('      - name: '));
    expect(names.at(-1)).toBe(`      - name: ${SECRETS_STEP}`);
    const step = stepNamed(SECRETS_STEP);
    expect(step).toContain('        if: steps.deploy.outputs.deployed == true');
    expect(step).toContain('        working-directory: workers/web');
  });

  it('gives that step only the Cloudflare token and the target and the five Oracle secrets', () => {
    const step = stepNamed(SECRETS_STEP);
    expect(step.slice(step.indexOf('        env:') + 1, step.indexOf('        run: |'))).toEqual([
      '          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
      '          TARGET: ${{ github.ref == refs/heads/main && prod || test }}',
      ...ORACLE.map((name) => `          ${name}: \${{ secrets.${name} }}`),
    ]);
  });

  it('runs nothing in that step but the secret puts, stopping by name on a missing one', () => {
    const step = stepNamed(SECRETS_STEP);
    expect(step.slice(step.indexOf('        run: |') + 1)).toEqual([
      `          for name in ${ORACLE.join(' ')}; do`,
      '            if [ -z ${!name} ]; then',
      '              echo ::error title=$name missing::Set $name in this runs GitHub environment (shyden-labs/ShyTalk#88); until then $TARGET sends no mail.',
      '              exit 1',
      '            fi',
      '            printf %s ${!name} | npx wrangler secret put $name --env $TARGET || { echo ::error title=deploy-release failed::the $TARGET $name was not set; exit 1; }',
      '          done',
    ]);
  });

  it('never deploys a door', () => {
    expect(workflow()).not.toContain('workers/door');
  });
});
