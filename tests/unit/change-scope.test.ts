import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { changeScope, main } from '../../scripts/change-scope.ts';

// git and the output file are stood in: a unit test starts no process and writes nothing.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ appendFileSync: vi.fn() }));
const git = vi.mocked(execFileSync);
const write = vi.mocked(appendFileSync);

describe('changeScope', () => {
  it('calls a pull request that changes only Markdown and docs/ docs-only', () => {
    expect(changeScope('pull_request', ['README.md', 'docs/setup/guide.txt', 'notes/plan.md'])).toBe('docs-only');
  });

  it('calls a pull request that changes code "code"', () => {
    expect(changeScope('pull_request', ['scripts/cli.ts'])).toBe('code');
  });

  it('calls a mixed pull request "code"', () => {
    expect(changeScope('pull_request', ['README.md', 'package.json'])).toBe('code');
  });

  it('never calls a push docs-only', () => {
    expect(changeScope('push', ['README.md'])).toBe('code');
  });

  it('calls a pull request with no changed paths "code"', () => {
    expect(changeScope('pull_request', [])).toBe('code');
  });

  it('does not take a file merely named docs for the docs folder', () => {
    expect(changeScope('pull_request', ['scripts/docs.ts', 'src/docs/x.ts'])).toBe('code');
  });

  // typecheck and lint cover every .ts and .js file, docs/ included, and code may import JSON from anywhere.
  it.each(['docs/a.ts', 'docs/a.tsx', 'docs/a.mts', 'docs/a.cts', 'docs/a.js', 'docs/a.jsx', 'docs/a.mjs', 'docs/a.cjs', 'docs/a.json'])(
    'calls code under docs/ "code": %s',
    (path) => {
      expect(changeScope('pull_request', ['docs/guide.md', path])).toBe('code');
    },
  );
});

describe('main', () => {
  beforeEach(() => {
    git.mockReset();
    write.mockReset();
    vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request');
    vi.stubEnv('GITHUB_OUTPUT', '/out');
  });

  it('writes docs-only for a docs pull request, read from the merge commit’s first parent, a rename listed as both its paths', () => {
    git.mockReturnValueOnce('README.md\ndocs/a.md\n');
    expect(main()).toBe(0);
    expect(git).toHaveBeenCalledWith('git', ['diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD'], { encoding: 'utf8' });
    expect(write).toHaveBeenCalledWith('/out', 'scope=docs-only\n');
  });

  it('writes code, naming the error, when git fails', () => {
    git.mockImplementationOnce(() => {
      throw new Error('fatal: bad revision HEAD^1');
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main()).toBe(0);
    expect(write).toHaveBeenCalledWith('/out', 'scope=code\n');
    expect(log).toHaveBeenCalledWith('change-scope: fatal: bad revision HEAD^1; treating the change as code');
    log.mockRestore();
  });

  it('writes code when the event name is unset, since only a pull request can be docs-only', () => {
    vi.stubEnv('GITHUB_EVENT_NAME', '');
    git.mockReturnValueOnce('README.md\n');
    expect(main()).toBe(0);
    expect(write).toHaveBeenCalledWith('/out', 'scope=code\n');
  });

  it('fails when there is no output file to write to', () => {
    vi.stubEnv('GITHUB_OUTPUT', '');
    expect(() => main()).toThrow('GITHUB_OUTPUT is not set');
  });
});
