'use strict';

/**
 * rules-fixtures-never-deployed.test.js — SHY-0657.
 *
 * The red-first CI step re-proves recorded cases against old rules kept as
 * test input (`tests/firestore-rules/red-first-fixtures.json`): SHY-0653's
 * four refusals against the rules before its fix. Those old rules are weaker
 * than the live ones, so they must never reach a deploy. Rules deploys run
 * `firebase deploy`, which reads its rules path from firebase.json, so every
 * Firebase config git sees must name only the live `firestore.rules`, and nothing on
 * the deploy side (.github, scripts, express-api/scripts) may name a fixture.
 * Each fixture's tests must exist as DENY tests, and its bytes must stay the
 * recorded ones.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { extractTests } = require('../firestore-rules/_helpers/rules-test-names.js');
const { gitVisibleFiles } = require('../helpers/git-visible-files.js');

const API = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(API, '..');
const FIXTURES = path.join(API, 'tests', 'firestore-rules', 'red-first-fixtures.json');
const fixtures = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));
// A Firebase CLI config: firebase.json, or firebase.<name>.json passed by --config.
const FIREBASE_CONFIG = /^firebase(\.[\w-]+)?\.json$/;

// The files git tracks or would track (SHY-0642), so the population is CI's on
// every machine: a git-ignored emulator export on the Mac never counts.
const visible = (within) => [...gitVisibleFiles(REPO, within)].sort();

// Every fixture rules path or file name `text` mentions.
function namesAFixture(text) {
  return fixtures
    .flatMap((f) => [f.rules, path.basename(f.rules)])
    .filter((needle) => text.includes(needle));
}

// Every way a fixture entry breaks the rule; empty when it holds.
function fixtureFindings(fixture, sources) {
  const out = [];
  for (const t of fixture.tests) {
    const source = sources[t.file];
    if (source === undefined) {
      out.push(`${t.file} does not exist`);
      continue;
    }
    const match = extractTests(source, t.file).find((s) => s.fullName === t.fullName);
    if (!match) out.push(`${t.file}: no test is named "${t.fullName}"`);
    else if (!match.title.startsWith('DENY: '))
      out.push(`${t.file}: "${t.fullName}" is not a DENY test`);
  }
  return out;
}

describe('every Firebase config names only the live rules', () => {
  const configs = visible().filter((f) => FIREBASE_CONFIG.test(path.basename(f)));

  test('the population includes firebase.json', () => {
    expect(configs).toContain('firebase.json');
  });

  test('a config is firebase.json or firebase.<name>.json, never an emulator export', () => {
    const names = [
      'firebase.json',
      'firebase.prod.json',
      'firebase-export-metadata.json',
      'firebase.json.bak',
    ];
    expect(names.filter((n) => FIREBASE_CONFIG.test(n))).toEqual([
      'firebase.json',
      'firebase.prod.json',
    ]);
  });

  test.each(configs)('%s', (config) => {
    const json = JSON.parse(fs.readFileSync(path.join(REPO, config), 'utf8'));
    const rules = [json.firestore]
      .flat()
      .filter(Boolean)
      .map((f) => f.rules);
    expect({ config, rules }).toEqual({ config, rules: rules.map(() => 'firestore.rules') });
  });
});

describe('nothing on the deploy side names a fixture', () => {
  const deploySide = visible(['.github', 'scripts', path.join('express-api', 'scripts')]);

  test('the scan covers every file that deploys rules', () => {
    expect(deploySide).toEqual(
      expect.arrayContaining([
        '.github/actions/deploy-firebase-rules/action.yml',
        '.github/workflows/deploy-dev.yml',
        '.github/workflows/deploy-prod.yml',
      ]),
    );
  });

  test('the scanner sees a fixture where one is named', () => {
    expect(namesAFixture(fs.readFileSync(FIXTURES, 'utf8'))).toEqual([
      'tests/firestore-rules/fixtures/firestore.rules.pre-shy-0653',
      'firestore.rules.pre-shy-0653',
    ]);
  });

  test('no deploy-side file names one', () => {
    const hits = deploySide
      .map((f) => ({ file: f, names: namesAFixture(fs.readFileSync(path.join(REPO, f), 'utf8')) }))
      .filter((h) => h.names.length > 0);
    expect({ scanned: deploySide.length > 0, hits }).toEqual({ scanned: true, hits: [] });
  });
});

describe('each fixture', () => {
  test('is SHY-0653 alone today', () => {
    expect(fixtures.map((f) => [f.story, f.tests.length])).toEqual([['SHY-0653', 4]]);
  });

  test('SHY-0653 keeps the bytes of firestore.rules at 1ca1299476d', () => {
    const bytes = fs.readFileSync(path.join(API, fixtures[0].rules));
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(
      'ded15febcc124e5185ed7ebc179f11f2e7a46c91946ab85e396185776d1a2046',
    );
  });

  test.each(fixtures.map((f) => [f.story, f]))(
    '%s names DENY tests that exist',
    (_story, fixture) => {
      const sources = Object.fromEntries(
        fixture.tests
          .map((t) => t.file)
          .filter((f) => fs.existsSync(path.join(API, f)))
          .map((f) => [f, fs.readFileSync(path.join(API, f), 'utf8')]),
      );
      expect(fixtureFindings(fixture, sources)).toEqual([]);
    },
  );

  test('a fixture naming a test that is not there is caught', () => {
    const source =
      "test('DENY: a', async () => { await assertFails(x()); });\ntest('ALLOW: b', () => {});";
    const fixture = {
      tests: [
        { file: 'a.test.js', fullName: 'DENY: gone' },
        { file: 'a.test.js', fullName: 'ALLOW: b' },
        { file: 'missing.test.js', fullName: 'DENY: a' },
      ],
    };
    expect(fixtureFindings(fixture, { 'a.test.js': source })).toEqual([
      'a.test.js: no test is named "DENY: gone"',
      'a.test.js: "ALLOW: b" is not a DENY test',
      'missing.test.js does not exist',
    ]);
  });
});
