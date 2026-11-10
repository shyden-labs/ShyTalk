import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutYamlComments, withoutYamlQuotes, yamlBlock as topLevel } from './source-text.ts';

/**
 * A merge into `develop` deploys to dev by a workflow trigger (shyden-labs/repo-template#12; operator
 * 2026-10-14). Read from comment-stripped, quote-free text, so a comment
 * describing the trigger cannot stand in for it, and compared exactly, so a
 * widened trigger fails as surely as a missing one.
 */

const WORKFLOW = '.github/workflows/deploy-dev.yml';
const workflow = () => withoutYamlQuotes(withoutYamlComments(readFileSync(WORKFLOW, 'utf8')));

describe('deploy-dev', () => {
  it('runs on every push to develop, on every pull request as a rehearsal, and otherwise only by hand', () => {
    expect(topLevel(workflow(), 'on')).toBe(
      ['on:', '  push:', '    branches: [develop]', '  pull_request:', '  workflow_dispatch:'].join('\n'),
    );
  });

  // A newer pending run in a group cancels the older pending one, and a
  // cancelled step reads as unrun (shyden-labs/repo-template#35), so a rehearsal never shares develop's group.
  it('queues a deploy behind the running one, and rehearses each pull request in its own group', () => {
    expect(topLevel(workflow(), 'concurrency')).toBe(
      [
        'concurrency:',
        '  group: ${{ github.event_name == pull_request && format(deploy-dev-rehearsal-{0}, github.event.pull_request.number) || deploy-dev }}',
        '  cancel-in-progress: false',
      ].join('\n'),
    );
  });

  // What keeps the credential out of a pull request is dev letting only develop
  // deploy (shyden-labs/repo-template#117); this line only picks an environment a pull request may use.
  it('deploys from the dev environment, and rehearses in dev-rehearsal, which holds no credential', () => {
    const jobs = topLevel(workflow(), 'jobs').split('\n');
    expect(jobs).toContain('    environment: ${{ github.event_name == pull_request && dev-rehearsal || dev }}');
    expect(jobs.filter((line) => /^ {4}environment:/.test(line))).toHaveLength(1);
  });

  // A pull_request event has no `before`, so a rehearsal diffs against the base.
  it('lists what a pull request changes against its base', () => {
    expect(topLevel(workflow(), 'jobs').split('\n')).toContain(
      '          BEFORE: ${{ github.event.before || github.event.pull_request.base.sha }}',
    );
  });

  // The template hosts nothing, so its own develop skips the deploy (shyden-labs/repo-template#43,
  // Shyden 2026-10-27), and a repository made from it, under any other name,
  // runs it. The template's pull requests still rehearse (shyden-labs/repo-template#121, Shyden
  // 2026-10-28), so the rehearsal is proved before a project copies it. One
  // job only: the pull request rehearsal is this same job (shyden-labs/repo-template#35 AC3), so the
  // condition covers it and its steps cannot drift from the deploy.
  it('has one job, deploy-dev, skipped in the template itself except to rehearse a pull request', () => {
    const jobs = topLevel(workflow(), 'jobs').split('\n');
    expect(jobs.filter((line) => /^ {2}\S/.test(line))).toEqual(['  deploy-dev:']);
    expect(jobs.filter((line) => /^ {4}if:/.test(line))).toEqual([
      '    if: ${{ github.repository != shyden-labs/repo-template || github.event_name == pull_request }}',
    ]);
  });

  // No other job key may skip it or pass it on failure (`continue-on-error`).
  it('gives the job no key but its condition, runner, timeout, environment and steps', () => {
    const keys = topLevel(workflow(), 'jobs')
      .split('\n')
      .filter((line) => /^ {4}\S/.test(line))
      .map((line) => line.trim().split(':')[0]);
    expect(keys).toEqual(['if', 'runs-on', 'timeout-minutes', 'environment', 'steps']);
  });

  // The project's own deploy (shyden-labs/ShyTalk#44; decisions 216, 217): the
  // dev origin Worker, only when its files changed; a rehearsal only bundles it,
  // with no credential; never a door, which deploys only through production.
  const deployStep = (): string[] => {
    const jobs = topLevel(workflow(), 'jobs').split('\n');
    const start = jobs.indexOf('      - name: Deploy the changed areas to dev');
    expect(start).toBeGreaterThan(-1);
    return jobs.slice(start);
  };

  it('no longer holds the template placeholder', () => {
    expect(workflow()).not.toContain('deploy-dev is not filled in');
  });

  it('deploys only when the website, its Worker, the migrations, the environment or mail package, the UI document or its publisher changed, or the lockfile or this workflow', () => {
    expect(deployStep()).toContain(
      '          if ! grep -qE ^(apps/web/|workers/web/|migrations/|packages/environment/|packages/mail/|packages/ui-document/|manifests/|scripts/publish-ui\\.ts$|scripts/announce-ui\\.ts$|package-lock\\.json$|\\.github/workflows/deploy-dev\\.yml$) changed-files.txt; then',
    );
  });

  it('builds the website before the Worker bundles it', () => {
    const step = deployStep().join('\n');
    const build = step.indexOf('npm run build:web ||');
    const enter = step.indexOf('cd workers/web');
    expect(build).toBeGreaterThan(-1);
    expect(enter).toBeGreaterThan(build);
  });

  it('only bundles on a rehearsal, and deploys the dev environment otherwise', () => {
    const step = deployStep().join('\n');
    const rehearsal = step.indexOf('if [ $DEPLOY_REHEARSAL = true ]; then');
    const dryRun = step.indexOf('npx wrangler deploy --dry-run --env dev --outdir $RUNNER_TEMP/web');
    const deploy = step.indexOf('npx wrangler deploy --env dev ||');
    expect(rehearsal).toBeGreaterThan(-1);
    expect(dryRun).toBeGreaterThan(rehearsal);
    expect(deploy).toBeGreaterThan(dryRun);
  });

  // #31 AC6 and #51 AC2: the dev origin refuses every request without the door
  // secret, so the deploy sets it from the dev environment (decision 216), and
  // fails naming the missing secret rather than leaving an origin that
  // refuses everything.
  it('sets the door secret after the deploy, and fails naming it when the environment lacks it', () => {
    const step = deployStep().join('\n');
    const deploy = step.indexOf('npx wrangler deploy --env dev ||');
    const missing = step.indexOf('if [ -z $DOOR_SECRET ]; then');
    const put = step.indexOf("printf '%s' $DOOR_SECRET | npx wrangler secret put DOOR_SECRET --env dev ||".replaceAll("'", ''));
    expect(deploy).toBeGreaterThan(-1);
    expect(missing).toBeGreaterThan(deploy);
    expect(put).toBeGreaterThan(missing);
    expect(step).toContain('DOOR_SECRET: ${{ secrets.DOOR_SECRET }}');
  });

  // #76: dev app sign-in answers 503 until the Worker holds Better Auth's
  // secret, so the deploy puts it from the dev environment, after the Worker
  // exists, and stops naming the secret when the environment has none.
  it('puts the Better Auth secret after the deploy, and stops naming it when the environment lacks it', () => {
    const step = deployStep().join('\n');
    const deploy = step.indexOf('npx wrangler deploy --env dev ||');
    const missing = step.indexOf('if [ -z $BETTER_AUTH_SECRET ]; then');
    const put = step.indexOf('printf %s $BETTER_AUTH_SECRET | npx wrangler secret put BETTER_AUTH_SECRET --env dev ||');
    expect(deploy).toBeGreaterThan(-1);
    expect(missing).toBeGreaterThan(deploy);
    expect(put).toBeGreaterThan(missing);
    expect(step).toContain('BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}');
  });

  // shyden-labs/ShyTalk#134: the authenticator app's sign-in answers 503 until
  // the Worker holds TOTP_KEY. It seals stored secrets, so it is kept in the dev
  // environment (never made fresh per deploy) and put after the Worker exists.
  it('puts the authenticator key after the Better Auth secret, and stops naming it when the environment lacks it', () => {
    const step = deployStep().join('\n');
    const betterAuth = step.indexOf('printf %s $BETTER_AUTH_SECRET | npx wrangler secret put BETTER_AUTH_SECRET --env dev ||');
    const missing = step.indexOf('if [ -z $TOTP_KEY ]; then');
    const put = step.indexOf(
      'printf %s $TOTP_KEY | npx wrangler secret put TOTP_KEY --env dev || { echo ::error title=deploy-dev failed::the dev authenticator key was not set; exit 1; }',
    );
    expect(betterAuth).toBeGreaterThan(-1);
    expect(missing).toBeGreaterThan(betterAuth);
    expect(put).toBeGreaterThan(missing);
    expect(step).toContain('TOTP_KEY: ${{ secrets.TOTP_KEY }}');
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
    expect(stepNamed('Deploy the changed areas to dev').join('\n')).not.toContain('OCI_');
  });

  it('records that it deployed, as the last line of the deploy step', () => {
    const step = stepNamed('Deploy the changed areas to dev');
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

  it('gives that step only the Cloudflare token and the five Oracle secrets', () => {
    const step = stepNamed(SECRETS_STEP);
    expect(step.slice(step.indexOf('        env:') + 1, step.indexOf('        run: |'))).toEqual([
      '          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
      ...ORACLE.map((name) => `          ${name}: \${{ secrets.${name} }}`),
    ]);
  });

  it('runs nothing in that step but the secret puts, stopping by name on a missing one', () => {
    const step = stepNamed(SECRETS_STEP);
    expect(step.slice(step.indexOf('        run: |') + 1)).toEqual([
      `          for name in ${ORACLE.join(' ')}; do`,
      '            if [ -z ${!name} ]; then',
      '              echo ::error title=$name missing::Set $name in the dev environment (shyden-labs/ShyTalk#88); until then dev sends no mail.',
      '              exit 1',
      '            fi',
      '            printf %s ${!name} | npx wrangler secret put $name --env dev || { echo ::error title=deploy-dev failed::the dev $name was not set; exit 1; }',
      '          done',
    ]);
  });

  // Plan 4 Task 2 (shyden-labs/ShyTalk#75): before the Worker deploys, its
  // database exists, is migrated and is marked `dev`, or the site answers 503.
  // A rehearsal exits before any of it, holding no credential.
  it('readies the dev database, in order, after the rehearsal exits and before the Worker deploys', () => {
    const step = deployStep().join('\n');
    const order = [
      'if [ $DEPLOY_REHEARSAL = true ]; then',
      'info=$(npx wrangler d1 info shytalk-dev --env dev 2>&1) || {',
      '*Couldnt find a D1 DB named shytalk-dev*) npx wrangler d1 create shytalk-dev --location apac ||',
      'npx wrangler d1 migrations apply DB --remote --env dev ||',
      'npx wrangler d1 execute DB --remote --env dev --command CREATE TABLE IF NOT EXISTS environment_marker (name TEXT NOT NULL); INSERT INTO environment_marker (name) SELECT dev WHERE NOT EXISTS (SELECT 1 FROM environment_marker); ||',
      'marker=$(npx wrangler d1 execute DB --remote --env dev --json --command SELECT name FROM environment_marker) ||',
      'npx wrangler deploy --env dev ||',
    ].map((line) => step.indexOf(line));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('stops naming the error when d1 info fails for any reason but a missing database, with no retry', () => {
    const step = deployStep().join('\n');
    const other = step.indexOf('*) echo ::error title=deploy-dev failed::d1 info shytalk-dev failed; exit 1 ;;');
    expect(other).toBeGreaterThan(step.indexOf('*Couldnt find a D1 DB named shytalk-dev*)'));
    expect(step.match(/wrangler d1 info shytalk-dev --env dev 2>&1/g)).toHaveLength(1);
    expect(step.match(/wrangler d1 create/g)).toHaveLength(1);
  });

  it('stops unless the marker reads back as exactly one row, dev', () => {
    const step = deployStep().join('\n');
    const read = step.indexOf('marker=$(npx wrangler d1 execute DB --remote --env dev --json');
    const check = step.indexOf('if [ $(printf %s $marker | jq -c [.[0].results[].name]) != [dev] ]; then');
    expect(read).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(read);
    expect(step.indexOf('npx wrangler deploy --env dev ||')).toBeGreaterThan(check);
  });

  // shyden-labs/ShyTalk#79: the app's UI document, published to the migrated
  // dev database through a remote binding before the Worker that serves it.
  it('publishes the UI document from the repository root, by database id, after the marker and before the Worker deploys', () => {
    const step = deployStep().join('\n');
    const marker = step.indexOf('if [ $(printf %s $marker | jq -c [.[0].results[].name]) != [dev] ]; then');
    const id = step.indexOf(
      'ui_db=$(npx wrangler d1 info shytalk-dev --env dev --json | jq -er .uuid) || { echo ::error title=deploy-dev failed::the shytalk-dev id could not be read; exit 1; }',
    );
    const publish = step.indexOf(
      '(cd $GITHUB_WORKSPACE && UI_ENVIRONMENT=dev UI_DATABASE_NAME=shytalk-dev UI_DATABASE_ID=$ui_db UI_PUBLISHED_BY=ci:deploy-dev node scripts/publish-ui.ts) || { echo ::error title=deploy-dev failed::the UI document was not published; exit 1; }',
    );
    expect(marker).toBeGreaterThan(-1);
    expect(id).toBeGreaterThan(marker);
    expect(publish).toBeGreaterThan(id);
    expect(step.indexOf('npx wrangler deploy --env dev ||')).toBeGreaterThan(publish);
  });

  // Plan 4 Task 8 (shyden-labs/ShyTalk#81; Shyden 2026-11-07, a secret
  // endpoint): last, the deploy makes a fresh announce secret, masks it, puts
  // it in the Worker and calls the Worker with it, so every open app hears the
  // newest UI version. Nothing is stored: each deploy's secret is new.
  it('tells open apps the UI version last, with a fresh masked secret it puts in the Worker', () => {
    const step = deployStep().join('\n');
    const betterAuth = step.indexOf('printf %s $BETTER_AUTH_SECRET | npx wrangler secret put BETTER_AUTH_SECRET --env dev ||');
    const make = step.indexOf(
      'announce_secret=$(openssl rand -hex 32) || { echo ::error title=deploy-dev failed::no announce secret was made; exit 1; }',
    );
    const mask = step.indexOf('echo ::add-mask::$announce_secret');
    const put = step.indexOf(
      'printf %s $announce_secret | npx wrangler secret put ANNOUNCE_SECRET --env dev || { echo ::error title=deploy-dev failed::the dev announce secret was not set; exit 1; }',
    );
    const call = step.indexOf(
      '(cd $GITHUB_WORKSPACE && ANNOUNCE_ENVIRONMENT=dev ANNOUNCE_SECRET=$announce_secret node scripts/announce-ui.ts) || { echo ::error title=deploy-dev failed::open apps were not told the UI version; exit 1; }',
    );
    expect(betterAuth).toBeGreaterThan(-1);
    expect(make).toBeGreaterThan(betterAuth);
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
    expect(workflow()).not.toContain('secrets.ANNOUNCE_SECRET');
  });

  it('no longer deploys or deletes the echo Worker, which is gone (#31 AC5)', () => {
    expect(workflow()).not.toContain('workers/echo');
    expect(workflow()).not.toContain('-X DELETE');
  });

  it('never deploys a door', () => {
    expect(workflow()).not.toContain('workers/door');
  });
});
