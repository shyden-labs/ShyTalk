import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutYamlComments, withoutYamlQuotes, yamlBlock as topLevel } from './source-text.ts';

/**
 * The doors deploy only through `production` (plan 2 Task E6 Step 2,
 * shyden-labs/ShyTalk#31; decisions 207, 216, 217): from `main`, with Shyden's
 * approval, each door with its own secret. Read from comment-stripped,
 * quote-free text, so a comment cannot stand in for a line.
 */

const WORKFLOW = '.github/workflows/deploy-doors.yml';
const workflow = () => withoutYamlQuotes(withoutYamlComments(readFileSync(WORKFLOW, 'utf8')));
const jobs = () => topLevel(workflow(), 'jobs').split('\n');

describe('deploy-doors', () => {
  // The door imports packages/mail and packages/environment (ShyTalk#88), so
  // a change there redeploys it too.
  it('runs on a push to main touching the door or a package it imports, and otherwise only by hand', () => {
    expect(topLevel(workflow(), 'on').split('\n')).toEqual([
      'on:',
      '  push:',
      '    branches: [main]',
      '    paths: [workers/door/**, packages/mail/**, packages/environment/**, .github/workflows/deploy-doors.yml]',
      '  workflow_dispatch:',
    ]);
  });

  it('has one job, in the production environment, which needs his approval', () => {
    expect(jobs().filter((line) => /^ {2}\S/.test(line))).toEqual(['  deploy-doors:']);
    expect(jobs().filter((line) => /^ {4}environment:/.test(line))).toEqual(['    environment: production']);
  });

  it('refuses to run from any branch but main', () => {
    expect(jobs()).toContain('    if: ${{ github.ref == refs/heads/main }}');
  });

  it.each(['test', 'dev'])('deploys the %s door and sets its secret, failing when the secret is missing', (name) => {
    const upper = name.toUpperCase();
    const text = jobs().join('\n');
    expect(text).toContain(`DOOR_SECRET_${upper}: \${{ secrets.DOOR_SECRET_${upper} }}`);
    expect(text).toContain(`if [ -z $DOOR_SECRET_${upper} ]; then`);
    expect(text).toContain(`npx wrangler deploy --env ${name} ||`);
    expect(text).toContain(`printf %s $DOOR_SECRET_${upper} | npx wrangler secret put DOOR_SECRET --env ${name} ||`);
  });

  it('checks both secrets before deploying either door', () => {
    const text = jobs().join('\n');
    const lastCheck = Math.max(text.indexOf('if [ -z $DOOR_SECRET_TEST ]'), text.indexOf('if [ -z $DOOR_SECRET_DEV ]'));
    expect(lastCheck).toBeGreaterThan(-1);
    expect(text.indexOf('npx wrangler deploy')).toBeGreaterThan(lastCheck);
  });

  // ShyTalk#88: each door sends its environment's mail, so each holds that
  // environment's mail secret, checked with the door secrets before any deploy.
  it('checks both mail secrets before deploying either door, failing by name', () => {
    const text = jobs().join('\n');
    const lastCheck = Math.max(text.indexOf('if [ -z $MAIL_SECRET_TEST ]'), text.indexOf('if [ -z $MAIL_SECRET_DEV ]'));
    expect(text.indexOf('if [ -z $MAIL_SECRET_TEST ]')).toBeGreaterThan(-1);
    expect(text.indexOf('if [ -z $MAIL_SECRET_DEV ]')).toBeGreaterThan(-1);
    expect(text.indexOf('npx wrangler deploy')).toBeGreaterThan(lastCheck);
    expect(text).toContain('::error title=MAIL_SECRET_TEST missing::');
    expect(text).toContain('::error title=MAIL_SECRET_DEV missing::');
  });

  it.each([
    ['test', 'MAIL_SECRET_TEST'],
    ['dev', 'MAIL_SECRET_DEV'],
  ])('puts the %s mail secret from %s', (name, variable) => {
    const text = jobs().join('\n');
    expect(text).toContain(`${variable}: \${{ secrets.${variable} }}`);
    expect(text).toContain(`printf %s $${variable} | npx wrangler secret put MAIL_SECRET --env ${name} ||`);
  });

  it('deploys from the door folder and nothing else', () => {
    expect(jobs()).toContain('        working-directory: workers/door');
    expect(workflow()).not.toContain('workers/web');
  });
});
