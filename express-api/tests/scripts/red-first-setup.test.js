'use strict';

/**
 * red-first-setup.test.js — SHY-0657.
 *
 * `tests/firestore-rules/_helpers/red-first-setup.js` is loaded only in the
 * rules red-first step's base-rules run. Loaded here in an isolated module
 * registry, it must leave assertFails as the library's own and change
 * assertSucceeds in one way: a refusal fails under ALLOW_REFUSED. No
 * emulator: every request is a promise built here. It loads the Firebase SDK,
 * which is beyond the unit CPU limit, so it is not a .unit test. The library
 * is taken in the one form the rules-library guard allows.
 */

const { ALLOW_REFUSED } = require('../firestore-rules/_helpers/red-first-refusal.js');
const { REASON } = require('../../scripts/rules-red-first.js');

// [assertFails, assertSucceeds] as the setup leaves them.
const held = [];
jest.isolateModules(() => {
  require('../firestore-rules/_helpers/red-first-setup.js');
  const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
  held.push(assertFails, assertSucceeds);
});
const [fails, succeeds] = held;

describe('the red-first setup', () => {
  test('a refused assertSucceeds fails under the marker', async () => {
    const refusal = Object.assign(new Error("false for 'create' @ L1"), {
      code: 'permission-denied',
    });
    await expect(succeeds(Promise.reject(refusal))).rejects.toThrow(
      `${ALLOW_REFUSED} false for 'create' @ L1`,
    );
  });

  test('an assertSucceeds that succeeds still resolves to its value', async () => {
    await expect(succeeds(Promise.resolve('doc'))).resolves.toBe('doc');
  });

  test('assertFails is still the library one: a request that succeeds fails with its reason', async () => {
    await expect(fails(Promise.resolve())).rejects.toThrow(REASON);
  });
});
