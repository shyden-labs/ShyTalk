'use strict';

/**
 * rules-source.unit.test.js — SHY-0657.
 *
 * Every emulator rules test reads the rules it loads from one place,
 * `tests/firestore-rules/_helpers/rules-source.js`. With no override that is
 * the repo's live `firestore.rules`; the red-first CI step sets
 * SHYTALK_RULES_UNDER_TEST to the base branch's rules, as test input only, so
 * the live file is never swapped out. An override that names nothing, or an
 * empty file, throws: a run against "no rules" must never look like a run
 * against the base rules. Loaded in-process; the file system is stood in.
 */

const path = require('path');
const {
  RULES_OVERRIDE_ENV,
  LIVE_RULES_PATH,
  rulesPath,
  loadRules,
} = require('../firestore-rules/_helpers/rules-source.js');

const OVERRIDE = '/runner/tmp/base/firestore.rules';
const existsOnly =
  (...paths) =>
  (p) =>
    paths.includes(p);

describe('rulesPath', () => {
  test('names the override env SHYTALK_RULES_UNDER_TEST', () => {
    expect(RULES_OVERRIDE_ENV).toBe('SHYTALK_RULES_UNDER_TEST');
  });

  test('is the repo root firestore.rules when no override is set', () => {
    expect(LIVE_RULES_PATH).toBe(path.resolve(__dirname, '..', '..', '..', 'firestore.rules'));
    expect(rulesPath({ env: {}, exists: existsOnly(LIVE_RULES_PATH) })).toBe(LIVE_RULES_PATH);
  });

  test('is the override path when it names an existing file', () => {
    const env = { SHYTALK_RULES_UNDER_TEST: OVERRIDE };
    expect(rulesPath({ env, exists: existsOnly(OVERRIDE) })).toBe(OVERRIDE);
  });

  test('throws naming the env and the path when the override names nothing', () => {
    const env = { SHYTALK_RULES_UNDER_TEST: OVERRIDE };
    expect(() => rulesPath({ env, exists: existsOnly() })).toThrow(
      `SHYTALK_RULES_UNDER_TEST names ${OVERRIDE}, which does not exist`,
    );
  });

  test('treats an empty override as set, and throws', () => {
    expect(() => rulesPath({ env: { SHYTALK_RULES_UNDER_TEST: '' }, exists: () => true })).toThrow(
      'SHYTALK_RULES_UNDER_TEST is set but empty',
    );
  });
});

describe('loadRules', () => {
  test('returns the text of the file rulesPath names', () => {
    const env = { SHYTALK_RULES_UNDER_TEST: OVERRIDE };
    const readFile = (p, enc) => (p === OVERRIDE && enc === 'utf8' ? 'rules_version = "2";' : null);
    expect(loadRules({ env, exists: existsOnly(OVERRIDE), readFile })).toBe('rules_version = "2";');
  });

  test('throws naming the path when the file holds only whitespace', () => {
    const env = { SHYTALK_RULES_UNDER_TEST: OVERRIDE };
    expect(() => loadRules({ env, exists: existsOnly(OVERRIDE), readFile: () => ' \n' })).toThrow(
      `${OVERRIDE} is empty`,
    );
  });
});
