'use strict';

/**
 * Loaded by the rules red-first step's base-rules run only (SHY-0657), via
 * `--setupFilesAfterEnv`; never named in jest.config.js, which a guard pins.
 * It changes one thing: an assertSucceeds that the rules refuse fails under
 * ALLOW_REFUSED, so the step can read an ALLOW test's refusal exactly. Every
 * other export of the library is the real one, untouched.
 */

jest.mock('@firebase/rules-unit-testing', () => {
  const actual = jest.requireActual('@firebase/rules-unit-testing');
  const { markRefusals } = require('./red-first-refusal.js');
  return { ...actual, assertSucceeds: markRefusals(actual.assertSucceeds) };
});
