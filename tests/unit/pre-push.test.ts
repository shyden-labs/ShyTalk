import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { CHECKS, commitsToCheck, main, parseUpdates, type Update } from '../../scripts/pre-push.ts';

// git, npm and the temporary worktree are stood in: a unit test starts no process and writes no file.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  mkdtempSync: vi.fn(),
  readFileSync: vi.fn(),
  symlinkSync: vi.fn(),
}));
const run = vi.mocked(execFileSync);
const mkdtemp = vi.mocked(mkdtempSync);
const symlink = vi.mocked(symlinkSync);
const read = vi.mocked(readFileSync);

/**
 * The pre-push hook checks the commits being pushed, not the working tree
 * (issue shyden-labs/repo-template#65): an error committed under a fixed but uncommitted working tree,
 * or sitting in an earlier commit of the push, is refused. Each pushed commit
 * is checked out into its own temporary worktree, where format, lint and
 * typecheck run.
 */

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const ZERO = '0'.repeat(40);
const line = (localSha: string, remoteSha: string, ref = 'refs/heads/feature') => `${ref} ${localSha} ${ref} ${remoteSha}`;

describe('parseUpdates', () => {
  it('reads each line git gives the hook, skipping the trailing newline', () => {
    expect(parseUpdates(`${line(B, A)}\n${line(C, ZERO, 'refs/heads/other')}\n`)).toEqual([
      { localRef: 'refs/heads/feature', localSha: B, remoteRef: 'refs/heads/feature', remoteSha: A },
      { localRef: 'refs/heads/other', localSha: C, remoteRef: 'refs/heads/other', remoteSha: ZERO },
    ]);
  });

  it('reads nothing from an empty push', () => {
    expect(parseUpdates('')).toEqual([]);
  });

  it.each([
    ['three fields', `refs/heads/x ${A} refs/heads/x`],
    ['five fields', `${line(B, A)} extra`],
    ['a short sha', `refs/heads/x ${A.slice(1)} refs/heads/x ${B}`],
    ['an upper-case sha', `refs/heads/x ${A.toUpperCase()} refs/heads/x ${B}`],
  ])('refuses a line with %s, naming it', (_, text) => {
    expect(() => parseUpdates(text)).toThrow(`pre-push: cannot read the update "${text}"`);
  });
});

describe('commitsToCheck', () => {
  // Each case reads exactly one update; parseUpdates' own tests pin how many a text yields.
  const one = (text: string): Update => (parseUpdates(text) as [Update])[0];
  const git = vi.fn<(args: string[]) => string>();
  beforeEach(() => git.mockReset());

  it('lists the commits between the remote tip and the pushed tip, oldest first', () => {
    git.mockReturnValueOnce(`${B}\n${C}\n`);
    expect(commitsToCheck(one(line(C, A)), 'origin', git)).toEqual([B, C]);
    expect(git).toHaveBeenCalledWith(['rev-list', '--reverse', `${A}..${C}`]);
  });

  it('lists every commit of a new branch that no branch of the remote holds', () => {
    git.mockReturnValueOnce(`${B}\n`);
    expect(commitsToCheck(one(line(B, ZERO)), 'origin', git)).toEqual([B]);
    expect(git).toHaveBeenCalledWith(['rev-list', '--reverse', B, '--not', '--remotes=origin']);
  });

  it('checks nothing for a deleted branch, asking git nothing', () => {
    expect(commitsToCheck(one(line(ZERO, A)), 'origin', git)).toEqual([]);
    expect(git).not.toHaveBeenCalled();
  });
});

describe('main', () => {
  const ROOT = '/repo';
  const TMP = '/tmp/pre-push-1';
  let calls: { cmd: string; args: string[]; cwd: string | undefined }[];
  let err: string[];
  /** Stands in git and npm; `failing` names the commit on which `failCheck` fails. */
  const serve = (revList: string, failing?: string, failCheck = 'lint') => {
    let checkedOut = '';
    run.mockImplementation(((cmd: string, args: string[], options?: { cwd?: string }) => {
      calls.push({ cmd, args, cwd: options?.cwd });
      if (cmd === 'git' && args[0] === 'rev-parse') return `${ROOT}\n`;
      if (cmd === 'git' && args[0] === 'rev-list') return revList;
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') checkedOut = args[4] as string;
      if (cmd === 'npm' && checkedOut === failing && args[2] === failCheck) throw new Error(`${failCheck} exited 1`);
      return '';
    }) as never);
  };

  beforeEach(() => {
    run.mockReset();
    mkdtemp.mockReset().mockReturnValue(TMP);
    symlink.mockReset();
    calls = [];
    err = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((t) => (err.push(String(t)), true));
  });
  afterEach(() => vi.restoreAllMocks());

  it('refuses to run without the remote name git passes', () => {
    expect(() => main([], '')).toThrow('usage: node scripts/pre-push.ts <remote> <url>, with the updates on stdin');
  });

  it('checks the pushed commit in its own worktree, never the working tree', () => {
    serve(`${B}\n`);
    expect(main(['origin', 'url'], line(B, A))).toBe(0);
    expect(calls.filter(({ cmd }) => cmd === 'npm')).toEqual(
      CHECKS.map((check) => ({ cmd: 'npm', args: ['run', '--silent', check], cwd: TMP })),
    );
    expect(calls.find(({ args }) => args[1] === 'add')).toEqual({ cmd: 'git', args: ['worktree', 'add', '--detach', TMP, B], cwd: ROOT });
    expect(symlink).toHaveBeenCalledWith(`${ROOT}/node_modules`, `${TMP}/node_modules`);
  });

  it('runs format, lint and typecheck, in that order', () => {
    expect(CHECKS).toEqual(['format:check', 'lint', 'typecheck']);
  });

  // The error is committed; the working tree was fixed but not committed. Only the commit is checked, so it is found.
  it('refuses an error committed under a clean working tree, naming the commit and the check', () => {
    serve(`${B}\n`, B);
    expect(() => main(['origin', 'url'], line(B, A))).toThrow(`pre-push: lint failed on ${B.slice(0, 12)}: nothing pushed`);
  });

  it('refuses an error in an earlier commit of the push, though the tip is clean', () => {
    serve(`${B}\n${C}\n`, B, 'typecheck');
    expect(() => main(['origin', 'url'], line(C, A))).toThrow(`pre-push: typecheck failed on ${B.slice(0, 12)}: nothing pushed`);
  });

  it('checks every commit of the push, oldest first, each once across refs', () => {
    serve(`${B}\n${C}\n`);
    main(['origin', 'url'], `${line(C, A)}\n${line(C, A, 'refs/heads/copy')}\n`);
    expect(calls.filter(({ args }) => args[1] === 'add').map(({ args }) => args[4])).toEqual([B, C]);
  });

  it('removes each worktree, after a failure too', () => {
    serve(`${B}\n`, B, 'format:check');
    expect(() => main(['origin', 'url'], line(B, A))).toThrow('format:check failed');
    expect(calls.at(-1)).toEqual({ cmd: 'git', args: ['worktree', 'remove', '--force', TMP], cwd: ROOT });
  });

  it('says what it checked', () => {
    serve(`${B}\n${C}\n`);
    main(['origin', 'url'], line(C, A));
    expect(err).toEqual([`pre-push: format, lint and typecheck passed on 2 pushed commit(s)\n`]);
  });

  it('reads the updates from stdin when none are passed, as the hook runs it', () => {
    serve(`${B}\n`);
    read.mockReturnValueOnce(line(B, A));
    expect(main(['origin', 'url'])).toBe(0);
    expect(read).toHaveBeenCalledWith(0, 'utf8');
    expect(calls.filter(({ args }) => args[1] === 'add').map(({ args }) => args[4])).toEqual([B]);
  });

  it('passes a push of no new commits, saying so', () => {
    serve('');
    expect(main(['origin', 'url'], line(A, A))).toBe(0);
    expect(calls.filter(({ cmd }) => cmd === 'npm')).toEqual([]);
    expect(err).toEqual([`pre-push: format, lint and typecheck passed on 0 pushed commit(s)\n`]);
  });
});
