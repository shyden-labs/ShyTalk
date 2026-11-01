import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { withoutYamlComments, withoutYamlQuotes, yamlBlock as topLevel } from './source-text.ts';

/**
 * The daily door count's two workflows (decision 197; plan 2 Task E6 Step 5,
 * shyden-labs/ShyTalk#31; the global prod-cron rule). Schedules run on the
 * default branch, `develop`, so a scheduled trigger only dispatches the real
 * job with `--ref main`; the job runs in `prod-cron`, which allows `main`
 * alone. Read from comment-stripped, quote-free text.
 */

const read = (file: string) => withoutYamlQuotes(withoutYamlComments(readFileSync(`.github/workflows/${file}`, 'utf8')));

describe('door-count-trigger', () => {
  const trigger = () => read('door-count-trigger.yml');

  it('runs once a day, and by hand', () => {
    expect(topLevel(trigger(), 'on').split('\n')).toEqual(['on:', '  schedule:', '    - cron: 17 0 * * *', '  workflow_dispatch:']);
  });

  it('only dispatches door-count on main, holding no credential but its own token', () => {
    const text = trigger();
    expect(text).toContain('gh workflow run door-count.yml --ref main');
    expect(text).not.toContain('environment:');
    expect(text).not.toContain('secrets.');
    expect(topLevel(text, 'permissions').split('\n')).toEqual(['permissions:', '  actions: write']);
  });
});

describe('door-count', () => {
  const job = () => read('door-count.yml');

  it('runs only when dispatched', () => {
    expect(topLevel(job(), 'on').split('\n')).toEqual(['on:', '  workflow_dispatch:']);
  });

  it('runs from main alone, in prod-cron', () => {
    const jobs = topLevel(job(), 'jobs').split('\n');
    expect(jobs).toContain('    if: ${{ github.ref == refs/heads/main }}');
    expect(jobs.filter((line) => /^ {4}environment:/.test(line))).toEqual(['    environment: prod-cron']);
  });

  it('reads the count with the analytics token and opens an issue for ShydenMcM when the count step fails', () => {
    const text = job();
    expect(text).toContain('CLOUDFLARE_ANALYTICS_TOKEN: ${{ secrets.CLOUDFLARE_ANALYTICS_TOKEN }}');
    expect(text).toContain('run: node scripts/door-count.ts');
    expect(text).toContain('if: ${{ failure() }}');
    expect(text).toContain('gh issue create');
    expect(text).toContain('--assignee ShydenMcM');
    expect(topLevel(text, 'permissions').split('\n')).toEqual(['permissions:', '  contents: read', '  issues: write']);
  });

  it('is the only workflow naming prod-cron', () => {
    const naming = readdirSync('.github/workflows')
      .filter((file) => read(file).includes('prod-cron'))
      .sort();
    expect(naming).toEqual(['door-count.yml']);
  });
});
