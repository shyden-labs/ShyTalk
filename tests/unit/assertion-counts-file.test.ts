import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import AssertionCounts from '../smoke/assertion-counts.ts';

let folder: string | undefined;
afterEach(() => {
  if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
});

describe('the smoke’s assertion counter, given no writer', () => {
  it('writes its counts to the output file itself, making the folders it needs', () => {
    folder = mkdtempSync(join(tmpdir(), 'assertion-counts-'));
    const outputFile = join(folder, 'test-results', 'nested', 'counts.json');
    const reporter = new AssertionCounts({ outputFile });
    reporter.onStepEnd({ title: 'a', parent: { project: () => ({ name: 'chromium' }) } }, undefined, { category: 'expect' });
    reporter.onEnd();
    expect(JSON.parse(readFileSync(outputFile, 'utf8'))).toEqual({ chromium: { a: 1 } });
  });
});

describe('the smoke’s assertion counter, for a test outside any project', () => {
  it('counts it under an empty target name', () => {
    const written: string[] = [];
    const reporter = new AssertionCounts({ outputFile: '/out/counts.json', write: (_, text) => written.push(text) });
    reporter.onStepEnd({ title: 'a', parent: { project: () => undefined } }, undefined, { category: 'expect' });
    reporter.onEnd();
    expect(written.map((text) => JSON.parse(text) as unknown)).toEqual([{ '': { a: 1 } }]);
  });
});
