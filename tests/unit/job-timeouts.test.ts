import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { withoutYamlComments, yamlBlock } from './source-text.ts';

/**
 * Every CI job fails fast when a step hangs (shyden-labs/ShyTalk#126): with no
 * `timeout-minutes`, a stuck step runs to GitHub's six-hour default. A job
 * that calls a reusable workflow (`uses:`) cannot set one; the workflow it
 * calls sets its own, and is checked here as a file of its own.
 */

const DIR = '.github/workflows';
const WORKFLOWS = readdirSync(DIR).filter((name) => name.endsWith('.yml'));

/** Each job's name, and whether it sets a timeout or calls a reusable workflow. */
function jobs(text: string): { name: string; bounded: boolean }[] {
  // Comments and blank lines go first: a blank or column-0 line would end yamlBlock's block early.
  const block = yamlBlock(withoutYamlComments(text), 'jobs');
  return [...block.matchAll(/^ {2}([A-Za-z0-9_-]+):$/gm)].map(([, name = '']) => {
    const job = yamlBlock(block, name, '  ');
    return { name, bounded: /^ {4}timeout-minutes: \d+$/m.test(job) || /^ {4}uses: /m.test(job) };
  });
}

describe('jobs', () => {
  it('finds a job with no timeout, past a commented-out one and a step’s own, and accepts a reusable call', () => {
    const text = [
      'jobs:',
      '  a:',
      '    # timeout-minutes: 5',
      '    runs-on: x',
      '  b:',
      '    timeout-minutes: 5',
      '',
      '# a column-0 comment between jobs',
      '  c:',
      '    uses: ./w.yml',
      '  d:',
      '    steps:',
      '      - run: x',
      '        timeout-minutes: 5',
    ].join('\n');
    expect(jobs(text)).toEqual([
      { name: 'a', bounded: false },
      { name: 'b', bounded: true },
      { name: 'c', bounded: true },
      { name: 'd', bounded: false },
    ]);
  });
});

describe('every workflow job has a timeout', () => {
  it('reads at least one workflow', () => {
    expect(WORKFLOWS.length).toBeGreaterThan(0);
  });

  it.each(WORKFLOWS)('%s: every job sets timeout-minutes', (file) => {
    const found = jobs(readFileSync(`${DIR}/${file}`, 'utf8'));
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter(({ bounded }) => !bounded).map(({ name }) => name)).toEqual([]);
  });
});
