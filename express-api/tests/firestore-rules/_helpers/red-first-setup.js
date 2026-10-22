'use strict';

/**
 * Loaded by the rules red-first step's base-rules run only (SHY-0657), via
 * `--setupFilesAfterEnv`; never named in jest.config.js, which a guard pins.
 * It changes one thing: an assertSucceeds that the rules refuse fails under
 * ALLOW_REFUSED, so the step can read an ALLOW test's refusal exactly.
 *
 * It wraps the library's own export in place rather than mocking the module:
 * setup files run in each test file's module registry before the test file,
 * so the test's `require` gets this same module object, wrapped, and every
 * other export stays the library's own.
 */

const lib = require('@firebase/rules-unit-testing');
const { markRefusals } = require('./red-first-refusal.js');

lib.assertSucceeds = markRefusals(lib.assertSucceeds);
