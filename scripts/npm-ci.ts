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
import { commandPath } from './command-path.ts';
import { runIfEntry } from './cli.ts';

/**
 * npm is stopped after this long, and the stall named (global rule 2026-11-26: a download step runs inside a timeout and
 * names what it was doing; shyden-labs/ShyTalk#375). 53 CI installs measured 2026-11-26 took 4-33 s, median 7.
 */
const LIMIT_SECONDS = 120;

const WARNING = [/^npm warn\b/i, /^\(node:\d+\) (?:\[\w+\] )?\w*Warning\b/];

/** Each line of npm's output that is a warning. */
export function warnings(output: string): string[] {
  return output.split('\n').filter((line) => WARNING.some((w) => w.test(line)));
}

export function main(): number {
  const run = spawnSync(commandPath('npm'), ['ci'], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    timeout: LIMIT_SECONDS * 1000,
    killSignal: 'SIGKILL',
  });
  if ((run.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
    const last =
      `${run.stdout}\n${run.stderr}`
        .split('\n')
        .filter((line) => line.trim() !== '')
        .at(-1) ?? '(nothing printed)';
    process.stdout.write(run.stdout);
    process.stderr.write(run.stderr);
    throw new Error(`npm ci stalled at ${String(LIMIT_SECONDS)} s; its last line was: ${last}`);
  }
  if (run.error) throw new Error(`npm ci did not run: ${run.error.message}`);
  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);
  if (run.status !== 0) throw new Error(`npm ci exited ${run.status ?? 'on ' + String(run.signal)}`);
  const found = warnings(`${run.stdout}\n${run.stderr}`);
  if (found.length > 0) throw new Error(`npm ci printed ${found.length} warning(s):\n${found.join('\n')}`);
  return 0;
}

await runIfEntry(import.meta.url, main);
