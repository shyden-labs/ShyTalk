/**
 * The static checks on every commit being pushed (issue shyden-labs/repo-template#65), run by
 * `.githooks/pre-push`:
 *
 *   node scripts/pre-push.ts <remote> <url>     (git's updates on stdin)
 *
 * The hook used to check the working tree, so an error committed under a
 * fixed but uncommitted tree, or sitting in an earlier commit of the push,
 * went through. Here each pushed commit is checked out into its own temporary
 * worktree, sharing the repository's node_modules, and format, lint and
 * typecheck run there, oldest commit first. The first failure stops the push,
 * naming the commit and the check. No test suite runs (global rule
 * 2026-10-12); CI runs every suite on the pull request.
 *
 * Trust: each commit is checked with its own npm scripts and configs, as CI
 * would check it, so pushing runs code from every pushed commit, earlier ones
 * included, on this machine. A malicious script in a middle commit of someone
 * else's branch, removed again by a later one, would run on push. Shyden
 * chose to keep this and document it (2026-10-23, after a security review):
 * these repositories take no unreviewed outside commits. Review another
 * person's commits before pushing them.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIfEntry } from './cli.ts';

/** The npm scripts run on each commit, in this order. */
export const CHECKS = ['format:check', 'lint', 'typecheck'];

export interface Update {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

const SHA = /^[0-9a-f]{40}$/;
const ZERO = '0'.repeat(40);

/** Each line git writes to the hook: `<local ref> <local sha> <remote ref> <remote sha>`. Anything else is refused. */
export function parseUpdates(stdin: string): Update[] {
  return stdin
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const fields = line.split(' ');
      const [localRef, localSha, remoteRef, remoteSha] = fields as [string, string, string, string];
      if (fields.length !== 4 || !SHA.test(localSha) || !SHA.test(remoteSha)) {
        throw new Error(`pre-push: cannot read the update "${line}"`);
      }
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

/**
 * The commits an update pushes, oldest first: those after the remote's tip,
 * or, for a new branch, every one that no branch of the remote holds. A
 * deleted branch pushes none.
 */
export function commitsToCheck(update: Update, remote: string, git: (args: string[]) => string): string[] {
  if (update.localSha === ZERO) return [];
  const range = update.remoteSha === ZERO ? [update.localSha, '--not', `--remotes=${remote}`] : [`${update.remoteSha}..${update.localSha}`];
  return git(['rev-list', '--reverse', ...range])
    .split('\n')
    .filter((sha) => sha !== '');
}

/** Runs each check on one commit in a temporary worktree, removed afterwards whatever happened. */
function checkCommit(sha: string, root: string, git: (args: string[]) => string): void {
  const dir = mkdtempSync(join(tmpdir(), 'pre-push-'));
  git(['worktree', 'add', '--detach', dir, sha]);
  try {
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
    for (const check of CHECKS) {
      try {
        execFileSync('npm', ['run', '--silent', check], { cwd: dir, stdio: 'inherit' });
      } catch {
        throw new Error(`pre-push: ${check} failed on ${sha.slice(0, 12)}: nothing pushed`);
      }
    }
  } finally {
    git(['worktree', 'remove', '--force', dir]);
  }
}

/** `stdin` is what git wrote to the hook; a test passes it, the hook leaves it to be read. */
export function main(args: string[], stdin: string = readFileSync(0, 'utf8')): number {
  const [remote] = args;
  if (remote === undefined) throw new Error('usage: node scripts/pre-push.ts <remote> <url>, with the updates on stdin');
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const git = (gitArgs: string[]) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' });
  const commits = [...new Set(parseUpdates(stdin).flatMap((update) => commitsToCheck(update, remote, git)))];
  for (const sha of commits) checkCommit(sha, root, git);
  process.stderr.write(`pre-push: format, lint and typecheck passed on ${commits.length} pushed commit(s)\n`);
  return 0;
}

await runIfEntry(import.meta.url, main);
