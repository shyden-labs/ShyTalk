/**
 * root-firebase-peer.test.js — SHY-0568.
 *
 * Dependabot's #2190 moved the root `firebase` to 13.0.0 while the root
 * `@firebase/rules-unit-testing` 5.0.2 peers `firebase ^12`, so every root
 * `npm ci` failed with ERESOLVE (the dev deploy's smoke, integration,
 * Playwright and QA-runner jobs all install there). No PR check installs the
 * root packages (SHY-0569), so nothing saw it. This test reads the root
 * lockfile in-process: the firebase it locks must satisfy the peer range the
 * locked rules-unit-testing declares, and a range it cannot read fails.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const REPO = path.resolve(__dirname, '../../..');

function lockedRoot() {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'package-lock.json'), 'utf8')).packages;
}

// A caret range on a major ("^12.0.0") is the only shape this reads.
function caretMajor(range) {
  const m = /^\^(\d+)\.\d+\.\d+$/.exec(range ?? '');
  if (!m)
    throw new Error(`root-firebase-peer: cannot read the peer range ${JSON.stringify(range)}`);
  return Number(m[1]);
}

function majorOf(version) {
  return Number(String(version).split('.')[0]);
}

describe('SHY-0568 — the root install resolves', () => {
  test('the locked root firebase satisfies the locked rules-unit-testing peer range', () => {
    const packages = lockedRoot();
    const testing = packages['node_modules/@firebase/rules-unit-testing'];
    const firebase = packages['node_modules/firebase'];
    expect({
      peerMajor: caretMajor(testing?.peerDependencies?.firebase),
      firebaseMajor: majorOf(firebase?.version),
    }).toEqual({
      peerMajor: majorOf(firebase?.version),
      firebaseMajor: caretMajor(testing?.peerDependencies?.firebase),
    });
  });

  test('a peer range in a shape the reader does not know is refused', () => {
    expect(() => caretMajor('>=12 <14')).toThrow(
      'root-firebase-peer: cannot read the peer range ">=12 <14"',
    );
  });

  test('a missing peer range is refused', () => {
    expect(() => caretMajor(undefined)).toThrow(
      'root-firebase-peer: cannot read the peer range undefined',
    );
  });
});

describe('SHY-0568 — Dependabot does not reopen the firebase major on its own', () => {
  test('the root npm entry ignores firebase majors until SHY-0570', () => {
    const config = yaml.load(fs.readFileSync(path.join(REPO, '.github/dependabot.yml'), 'utf8'));
    const roots = config.updates.filter(
      (u) => u['package-ecosystem'] === 'npm' && u.directory === '/',
    );
    expect(roots).toHaveLength(1);
    expect(roots[0].ignore).toContainEqual({
      'dependency-name': 'firebase',
      'update-types': ['version-update:semver-major'],
    });
  });
});
