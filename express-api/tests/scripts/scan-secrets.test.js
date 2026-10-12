/**
 * scan-secrets.test.js — SHY-0565.
 *
 * The pre-commit secret scan reads the staged diff through
 * scripts/scan-secrets.js. Shyden allowed ONE value by name (2026-10-12):
 * the local emulator persona password `localdev123`, and only in files under
 * `local/`. Every other credential shape is refused wherever it appears.
 *
 * findSecrets() is a pure function over diff text, so each case hands it a
 * diff string: no process, no git. Every planted credential is assembled
 * from pieces at run time, so this file itself passes the scan it tests
 * (the last describe proves it).
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
const SCANNER = path.join(REPO, 'scripts/scan-secrets.js');
const { findSecrets } = require(SCANNER);

const PW = ['pass', 'word'].join('');
const LOCAL_VALUE = ['local', 'dev123'].join('');

// The hook with every shell comment line removed, so a construct named only
// in a comment cannot satisfy the pin.
const HOOK_CODE = fs
  .readFileSync(path.join(REPO, '.husky/pre-commit'), 'utf8')
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

function diffOf(file, ...added) {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1,0 +1,1 @@',
    ...added.map((line) => `+${line}`),
  ].join('\n');
}

describe('SHY-0565 — the local persona value is allowed by exact value, under local/ only', () => {
  test('the value in local/seed.js, object form, is allowed', () => {
    expect(findSecrets(diffOf('local/seed.js', `    ${PW}: "${LOCAL_VALUE}",`))).toEqual({
      scanned: 1,
      findings: [],
    });
  });

  test('the value in a nested local/ file, assignment form, is allowed', () => {
    expect(findSecrets(diffOf('local/tools/personas.js', `  ${PW} = '${LOCAL_VALUE}';`))).toEqual({
      scanned: 1,
      findings: [],
    });
  });

  test('the same value outside local/ is refused', () => {
    expect(findSecrets(diffOf('express-api/src/seed.js', `    ${PW}: "${LOCAL_VALUE}",`))).toEqual({
      scanned: 1,
      findings: [`express-api/src/seed.js: ${PW}: "${LOCAL_VALUE}`],
    });
  });

  test('a path that climbs out of local/ is refused', () => {
    const file = 'local/../express-api/src/seed.js';
    expect(findSecrets(diffOf(file, `    ${PW}: "${LOCAL_VALUE}",`)).findings).toEqual([
      `${file}: ${PW}: "${LOCAL_VALUE}`,
    ]);
  });

  test('a longer value that starts with the allowed one is refused under local/', () => {
    expect(findSecrets(diffOf('local/seed.js', `    ${PW}: "${LOCAL_VALUE}4",`)).findings).toEqual([
      `local/seed.js: ${PW}: "${LOCAL_VALUE}4`,
    ]);
  });

  test('another value under local/ is refused', () => {
    expect(findSecrets(diffOf('local/seed.js', `    ${PW}: "hunter2hunter2",`)).findings).toEqual([
      `local/seed.js: ${PW}: "hunter2hunter2`,
    ]);
  });
});

describe('SHY-0565 — every credential shape the hook refused is still refused', () => {
  const KEY_TAIL = 'A'.repeat(33);
  const PRIVATE_KEY = ['-----BEGIN RSA PRIVATE', 'KEY-----'].join(' ');
  const cases = [
    [
      'a password literal in any case',
      'express-api/src/a.js',
      `${PW.toUpperCase()} = 'correcthorse'`,
      `${PW.toUpperCase()} = 'correcthorse`,
    ],
    ['a Google API key', 'public/a.js', `key: "AIzaSy${KEY_TAIL}"`, `AIzaSy${KEY_TAIL}`],
    ['an OpenAI-style key', 'scripts/a.js', `k = "sk-${'b'.repeat(48)}"`, `sk-${'b'.repeat(48)}`],
    ['a GitHub token', '.github/a.yml', `token: ghp_${'c'.repeat(36)}`, `ghp_${'c'.repeat(36)}`],
    ['an AWS access key', 'local/a.sh', `AKIA${'D'.repeat(16)}`, `AKIA${'D'.repeat(16)}`],
    ['a private key header', 'local/key.pem', PRIVATE_KEY, PRIVATE_KEY],
  ];

  test.each(cases)('%s is refused', (_name, file, line, found) => {
    expect(findSecrets(diffOf(file, line))).toEqual({
      scanned: 1,
      findings: [`${file}: ${found}`],
    });
  });
});

describe('SHY-0565 — the pre-commit hook runs this scan and blocks on it', () => {
  test('the staged diff is written once and fed to the scanner once', () => {
    expect({
      diff: occurrences(HOOK_CODE, 'git diff --cached --diff-filter=d -U0 > "$SECRETS_DIFF"'),
      scan: occurrences(
        HOOK_CODE,
        'SECRETS_FOUND=$(node scripts/scan-secrets.js < "$SECRETS_DIFF")',
      ),
    }).toEqual({ diff: 1, scan: 1 });
  });

  test('a finding (exit 1) and a failed scan (any other non-zero) both block', () => {
    expect({
      failed: occurrences(
        HOOK_CODE,
        'if [ "$SECRETS_STATUS" -ne 0 ] && [ "$SECRETS_STATUS" -ne 1 ]; then',
      ),
      found: occurrences(HOOK_CODE, 'if [ "$SECRETS_STATUS" -eq 1 ]; then'),
      // The three block exits of the secret-scan section, before the next check.
      exits: occurrences(HOOK_CODE.split('UNSAFE_URLS=$(')[0], '  exit 1\n'),
    }).toEqual({ failed: 1, found: 1, exits: 3 });
  });

  test('the old inline pattern, which read no file names, is gone', () => {
    expect(occurrences(HOOK_CODE, "grep -iE '(AIzaSy")).toBe(0);
  });
});

describe('SHY-0565 — what the scan reads', () => {
  test('a removed line and the +++ header are not read as added lines', () => {
    const diff = [
      'diff --git a/express-api/src/a.js b/express-api/src/a.js',
      '--- a/express-api/src/a.js',
      '+++ b/express-api/src/a.js',
      '@@ -1,1 +1,1 @@',
      `-    ${PW}: "removedsecret",`,
      '+    const ok = 1;',
    ].join('\n');
    expect(findSecrets(diff)).toEqual({ scanned: 1, findings: [] });
  });

  test('added lines are counted across every file in the diff', () => {
    const diff = [diffOf('local/seed.js', 'a', 'b'), diffOf('scripts/x.js', 'c')].join('\n');
    expect(findSecrets(diff)).toEqual({ scanned: 3, findings: [] });
  });

  test('an added line before any file header is refused as unreadable', () => {
    expect(() => findSecrets(`+    ${PW}: "${LOCAL_VALUE}",`)).toThrow(
      'scan-secrets: an added line appears before any +++ file header',
    );
  });
});

describe('SHY-0565 — the scanner and this test can themselves be committed', () => {
  test.each([
    ['the scanner', 'scripts/scan-secrets.js', SCANNER],
    ['this test', 'express-api/tests/scripts/scan-secrets.test.js', __filename],
  ])('%s passes the scan as a whole new file', (_name, rel, abs) => {
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    expect(findSecrets(diffOf(rel, ...lines))).toEqual({ scanned: lines.length, findings: [] });
  });
});
