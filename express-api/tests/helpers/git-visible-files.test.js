/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded binary `git` with literal argv (`init`, `add`) to build
 * a throwaway repository for the planted cases; no user-controlled command and
 * no PATH manipulation. Matches the firebase-admin-namespace-surface convention. */
/**
 * git-visible-files.test.js — SHY-0642.
 *
 * `gitVisibleFiles` is the file set the floored guards count: what git tracks
 * plus what it would track, never a git-ignored file. Each case builds a real
 * repository in a temp folder, because the ignore rules are git's own.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitVisibleFiles } = require('./git-visible-files');

function write(root, rel, body = 'x\n') {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

describe('SHY-0642 — gitVisibleFiles lists what git tracks or would track', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0642-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    write(root, '.gitignore', 'secret.json\nbuild/\n');
    write(root, 'src/tracked.js');
    execFileSync('git', ['add', '.gitignore', 'src/tracked.js'], { cwd: root });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('a tracked file and the ignore file itself are listed', () => {
    expect([...gitVisibleFiles(root)].sort()).toEqual([
      '.gitignore',
      path.join('src', 'tracked.js'),
    ]);
  });

  test('an untracked file that is not ignored is listed', () => {
    write(root, 'src/new.js');
    expect(gitVisibleFiles(root).has(path.join('src', 'new.js'))).toBe(true);
  });

  test.each([
    ['a file matched by the top-level .gitignore', 'src/secret.json', null],
    ['a file under an ignored folder', 'src/build/out.js', null],
    [
      'a file matched by a nested .gitignore',
      'src/deep/local.md',
      ['src/deep/.gitignore', 'local.md\n'],
    ],
    [
      'a file matched by .git/info/exclude',
      'src/excluded.js',
      ['.git/info/exclude', 'excluded.js\n'],
    ],
  ])('%s is not listed', (_form, rel, rule) => {
    if (rule) write(root, ...rule);
    write(root, rel);
    const visible = gitVisibleFiles(root);
    expect({ listed: visible.has(path.join(...rel.split('/'))), size: visible.size }).toEqual({
      listed: false,
      // The two files of the fixture, plus a nested .gitignore when planted.
      size: rule && !rule[0].startsWith('.git/') ? 3 : 2,
    });
  });

  test('a tracked file that matches an ignore rule is still listed', () => {
    write(root, 'src/secret.json');
    execFileSync('git', ['add', '-f', 'src/secret.json'], { cwd: root });
    expect(gitVisibleFiles(root).has(path.join('src', 'secret.json'))).toBe(true);
  });

  test('called on a subfolder, it lists only that folder, relative to it', () => {
    write(root, 'src/nested/new.js');
    write(root, 'other.js');
    expect([...gitVisibleFiles(path.join(root, 'src'))].sort()).toEqual([
      path.join('nested', 'new.js'),
      'tracked.js',
    ]);
  });

  test('given folders, it lists only the files under them', () => {
    write(root, 'src/nested/new.js');
    write(root, 'other/new.js');
    write(root, 'third/new.js');
    expect([...gitVisibleFiles(root, ['src/nested', 'other'])].sort()).toEqual([
      path.join('other', 'new.js'),
      path.join('src', 'nested', 'new.js'),
    ]);
  });

  test('a given name is literal: a star in it is not a wildcard', () => {
    write(root, 'notes/a*.md');
    write(root, 'notes/ab.md');
    expect([...gitVisibleFiles(root, ['notes/a*.md'])]).toEqual([path.join('notes', 'a*.md')]);
  });

  test('a name with a space and a non-ASCII letter comes back as written', () => {
    write(root, 'src/ünï code.js');
    expect(gitVisibleFiles(root).has(path.join('src', 'ünï code.js'))).toBe(true);
  });
});

describe('SHY-0642 — gitVisibleFiles fails rather than guess', () => {
  test('a folder outside any repository throws, naming the folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0642-bare-'));
    try {
      expect(() => gitVisibleFiles(dir)).toThrow(
        new RegExp(
          `git ls-files failed in ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: .*not a git repository`,
          'i',
        ),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a folder that does not exist throws, naming the folder', () => {
    const dir = path.join(os.tmpdir(), 'shy0642-missing-folder');
    expect(() => gitVisibleFiles(dir)).toThrow(
      /git ls-files failed in .*shy0642-missing-folder: no such folder$/,
    );
  });
});
