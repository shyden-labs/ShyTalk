/**
 * Every dependency install in CI, failing on any warning npm prints (issue
 * shyden-labs/repo-template#140; global rule: warnings are build failures):
 *
 *   node scripts/npm-ci.ts
 *
 * Runs `npm ci`, passes its output through, then fails naming each warning
 * line (`npm warn`, `npm WARN`, deprecations, node's own warnings). A failing
 * install, a killed npm or one that never started fails closed, naming why.
 * It runs before the install, so it imports nothing outside node.
 */
import { spawnSync } from 'node:child_process';
import { runIfEntry } from './cli.ts';

const WARNING = [/^npm warn\b/i, /^\(node:\d+\) (?:\[\w+\] )?\w*Warning\b/];

/** Each line of npm's output that is a warning. */
export function warnings(output: string): string[] {
  return output.split('\n').filter((line) => WARNING.some((w) => w.test(line)));
}

export function main(): number {
  const run = spawnSync('npm', ['ci'], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  if (run.error) throw new Error(`npm ci did not run: ${run.error.message}`);
  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);
  if (run.status !== 0) throw new Error(`npm ci exited ${run.status ?? `on ${String(run.signal)}`}`);
  const found = warnings(`${run.stdout}\n${run.stderr}`);
  if (found.length > 0) throw new Error(`npm ci printed ${found.length} warning(s):\n${found.join('\n')}`);
  return 0;
}

await runIfEntry(import.meta.url, main);
