import { describe, it, expect, vi, beforeEach } from 'vitest';
import { accessSync, statSync } from 'node:fs';
import { commandPath } from '../../scripts/command-path.ts';

/**
 * The scripts run `gh`, `git` and `npm` by their full path, found the way the shell finds them (shyden-labs/ShyTalk#353):
 * the first folder on PATH holding an executable file of that name, so the Mac's App router for gh still answers
 * first, and SonarCloud's S4036 sees no command left to PATH at the call.
 */

vi.mock('node:fs', () => ({ accessSync: vi.fn(), statSync: vi.fn(), constants: { X_OK: 1 } }));
const access = vi.mocked(accessSync);
const stat = vi.mocked(statSync);
const realStats = (await vi.importActual<typeof import('node:fs')>('node:fs')).statSync(import.meta.filename);

/** The files that exist, each executable or not, and the folders. */
function disk(files: Record<string, 'run' | 'read' | 'folder'>): void {
  stat.mockImplementation(((path: string) => {
    const kind = files[path];
    if (kind === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    // A real Stats from Node's own fs (this one is stood in), answering isFile as the stand-in disk says.
    return Object.assign(realStats, { isFile: () => kind !== 'folder' });
  }) as typeof statSync);
  access.mockImplementation((path) => {
    // A folder can be entered, so it passes X_OK as a real one does; only isFile tells it apart.
    if (files[String(path)] === 'read' || files[String(path)] === undefined)
      throw Object.assign(new Error(`EACCES: ${String(path)}`), { code: 'EACCES' });
  });
}

describe('commandPath', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('answers the first folder on PATH that holds the command', () => {
    disk({ '/Users/me/.local/bin/gh': 'run', '/opt/homebrew/bin/gh': 'run' });
    expect(commandPath('gh', '/usr/bin:/Users/me/.local/bin:/opt/homebrew/bin')).toBe('/Users/me/.local/bin/gh');
  });

  it('checks the file can be run, as the shell does', () => {
    disk({ '/usr/bin/gh': 'run' });
    commandPath('gh', '/usr/bin');
    expect(access).toHaveBeenCalledWith('/usr/bin/gh', 1);
  });

  it('passes over a file that cannot be run and a folder of the same name', () => {
    disk({ '/a/git': 'read', '/b/git': 'folder', '/c/git': 'run' });
    expect(commandPath('git', '/a:/b:/c')).toBe('/c/git');
  });

  it('skips empty entries in PATH', () => {
    disk({ '/c/npm': 'run' });
    expect(commandPath('npm', '::/c:')).toBe('/c/npm');
  });

  it('reads the process PATH when none is given', () => {
    const before = process.env.PATH;
    process.env.PATH = '/from/env';
    try {
      disk({ '/from/env/gh': 'run' });
      expect(commandPath('gh')).toBe('/from/env/gh');
    } finally {
      process.env.PATH = before;
    }
  });

  it('fails naming the command and the folders searched when none holds it', () => {
    disk({ '/a/gh': 'read' });
    expect(() => commandPath('gh', '/a:/b')).toThrow('gh is not on PATH (searched /a, /b)');
  });

  it('fails naming the command when PATH is unset', () => {
    const before = process.env.PATH;
    delete process.env.PATH;
    try {
      disk({});
      expect(() => commandPath('git')).toThrow('git is not on PATH (searched nothing)');
    } finally {
      process.env.PATH = before;
    }
  });
});
