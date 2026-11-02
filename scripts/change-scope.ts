/**
 * The docs-only fast path: a pull request that changes only Markdown or
 * non-code files under docs/ (a renamed file counts by both its old and new
 * path) skips the steps a docs change cannot affect, while every job
 * still runs and reports, so the required checks never wait. A push is never
 * docs-only, and an error reading the change counts as code, so the fast path
 * can only ever run more checks than it should, never fewer.
 *
 *   node scripts/change-scope.ts     # writes scope=docs-only|code to $GITHUB_OUTPUT
 *
 * Needs `fetch-depth: 2`: a pull request's checkout is its merge commit, whose
 * first parent is the base.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { runIfEntry } from './cli.ts';

export type Scope = 'docs-only' | 'code';

/** Files typecheck and lint cover, or code may import: never docs, even under docs/. */
const CODE_FILE = /\.(?:[cm]?[jt]sx?|json)$/;

function isDocs(path: string): boolean {
  return path.endsWith('.md') || (path.startsWith('docs/') && !CODE_FILE.test(path));
}

/** What a change touches, from the event that ran and its changed paths. */
export function changeScope(event: string, paths: string[]): Scope {
  if (event !== 'pull_request' || paths.length === 0) return 'code';
  return paths.every(isDocs) ? 'docs-only' : 'code';
}

export function main(): number {
  const output = process.env.GITHUB_OUTPUT || '';
  if (output === '') throw new Error('GITHUB_OUTPUT is not set: run this as a workflow step');
  let scope: Scope;
  try {
    const diff = execFileSync('git', ['diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD'], { encoding: 'utf8' });
    scope = changeScope(
      process.env.GITHUB_EVENT_NAME || '',
      diff.split('\n').filter((p) => p !== ''),
    );
  } catch (error) {
    console.log(`change-scope: ${(error as Error).message}; treating the change as code`);
    scope = 'code';
  }
  appendFileSync(output, `scope=${scope}\n`);
  return 0;
}

await runIfEntry(import.meta.url, main);
