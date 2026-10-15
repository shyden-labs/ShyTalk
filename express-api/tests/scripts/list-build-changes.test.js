'use strict';

/**
 * list-build-changes.test.js — SHY-0361.
 *
 * `scripts/list-build-changes.js` lists the first-parent commits a dev deploy
 * carries, each with the areas scripts/deploy-scope.sh says it touches, for
 * scripts/tester-notes.js. Loaded in-process: `git` and the classifier are
 * stand-ins, so no process starts.
 */

const { listChanges, parseScope } = require('../../../scripts/list-build-changes.js');

/** A stand-in git answering from a table keyed by its joined arguments. */
function fakeGit(table) {
  const calls = [];
  const git = (args) => {
    const key = args.join(' ');
    calls.push(key);
    if (!(key in table)) throw new Error(`unexpected git ${key}`);
    return table[key];
  };
  return { git, calls };
}

describe('parseScope', () => {
  test("returns the areas set true, in the classifier's order", () => {
    expect(
      parseScope('backend=true\nweb=false\nandroid=true\nios=false\nreason=derived-from-diff\n'),
    ).toEqual(['backend', 'android']);
  });

  test('no area true is an empty list', () => {
    expect(
      parseScope('backend=false\nweb=false\nandroid=false\nios=false\nreason=derived-from-diff\n'),
    ).toEqual([]);
  });

  test('refuses output with an area missing, naming it', () => {
    expect(() =>
      parseScope('backend=true\nweb=false\nandroid=true\nreason=derived-from-diff\n'),
    ).toThrow(/ios/);
  });

  test('refuses output whose reason is not a derived diff', () => {
    expect(() =>
      parseScope(
        'backend=true\nweb=true\nandroid=true\nios=true\nreason=no-diff-available-failing-safe\n',
      ),
    ).toThrow(/no-diff-available-failing-safe/);
  });
});

describe('listChanges', () => {
  test('an unresolved baseline lists nothing and says so', () => {
    const { git, calls } = fakeGit({});
    expect(listChanges({ baseline: 'unresolved', git, classify: () => [] })).toBe('#unresolved\n');
    expect(calls).toEqual([]);
  });

  test('an empty baseline is unresolved too', () => {
    const { git } = fakeGit({});
    expect(listChanges({ baseline: '', git, classify: () => [] })).toBe('#unresolved\n');
  });

  test('lists each first-parent commit newest first with its areas and subject', () => {
    const { git } = fakeGit({
      'log --first-parent --format=%H base1..HEAD': 'c2\nc1\n',
      'diff --name-only c2^1 c2': 'app/src/A.kt\nexpress-api/src/b.js\n',
      'log -1 --format=%s c2': 'SHY-0583: x (#2)\n',
      'diff --name-only c1^1 c1': '.project/stories/SHY-0583.md\n',
      'log -1 --format=%s c1': 'docs: file SHY-0583 (#1)\n',
    });
    const classify = (paths) => (paths[0].startsWith('app/') ? ['backend', 'android'] : []);
    expect(listChanges({ baseline: 'base1', git, classify })).toBe(
      '#baseline base1\nc2\tbackend,android\tSHY-0583: x (#2)\nc1\tdocs\tdocs: file SHY-0583 (#1)\n',
    );
  });

  test("hands the classifier exactly the commit's changed paths", () => {
    const seen = [];
    const { git } = fakeGit({
      'log --first-parent --format=%H b..HEAD': 'c1\n',
      'diff --name-only c1^1 c1': 'a\nb\n',
      'log -1 --format=%s c1': 's\n',
    });
    listChanges({ baseline: 'b', git, classify: (p) => (seen.push(p), []) });
    expect(seen).toEqual([['a', 'b']]);
  });

  test('a commit that changes no file touches no area and is not classified', () => {
    const { git } = fakeGit({
      'log --first-parent --format=%H b..HEAD': 'c1\n',
      'diff --name-only c1^1 c1': '',
      'log -1 --format=%s c1': 'empty\n',
    });
    const classify = () => {
      throw new Error('must not classify an empty change');
    };
    expect(listChanges({ baseline: 'b', git, classify })).toBe('#baseline b\nc1\t-\tempty\n');
  });

  test('a commit touching only .project/ is marked docs and not classified', () => {
    const { git } = fakeGit({
      'log --first-parent --format=%H b..HEAD': 'c1\n',
      'diff --name-only c1^1 c1': '.project/stories/SHY-0565-x.md\n.project/board-items.json\n',
      'log -1 --format=%s c1': 'docs: SHY-0565 Done (#1)\n',
    });
    const classify = () => {
      throw new Error('must not classify story paperwork');
    };
    expect(listChanges({ baseline: 'b', git, classify })).toBe(
      '#baseline b\nc1\tdocs\tdocs: SHY-0565 Done (#1)\n',
    );
  });

  test('a commit touching .project/ and code is classified as code', () => {
    const { git } = fakeGit({
      'log --first-parent --format=%H b..HEAD': 'c1\n',
      'diff --name-only c1^1 c1': '.project/stories/SHY-0583-x.md\nscripts/x.js\n',
      'log -1 --format=%s c1': 'SHY-0583: x (#1)\n',
    });
    expect(listChanges({ baseline: 'b', git, classify: () => [] })).toBe(
      '#baseline b\nc1\t-\tSHY-0583: x (#1)\n',
    );
  });

  test('no commits since the baseline is a resolved, empty list', () => {
    const { git } = fakeGit({ 'log --first-parent --format=%H b..HEAD': '' });
    expect(listChanges({ baseline: 'b', git, classify: () => [] })).toBe('#baseline b\n');
  });

  test('a git failure is not swallowed', () => {
    const { git } = fakeGit({});
    expect(() => listChanges({ baseline: 'b', git, classify: () => [] })).toThrow(/unexpected git/);
  });
});
