'use strict';

/**
 * red-first-refusal.unit.test.js — SHY-0657.
 *
 * Every firestore.rules change must be proven (Shyden, 2026-10-21): a
 * loosening by an ALLOW test that the base rules refuse. assertSucceeds only
 * returns its request, so on refusal jest would print whatever the Firestore
 * error says. In the red-first base run only, `red-first-setup.js` wraps
 * assertSucceeds with `markRefusals`, which rethrows a refusal under one fixed
 * marker the step reads. The refusal test is the library's own, copied from
 * assertFails (@firebase/rules-unit-testing 5.0.2), so both judge alike.
 * In-process; every error is built here.
 */

const {
  ALLOW_REFUSED,
  isPermissionDenied,
  markRefusals,
} = require('../firestore-rules/_helpers/red-first-refusal.js');

const err = (fields) => Object.assign(new Error(fields.message ?? ''), fields);

describe('isPermissionDenied', () => {
  test.each([
    ['code permission-denied', { code: 'permission-denied' }],
    ['code PERMISSION_DENIED', { code: 'PERMISSION_DENIED' }],
    ['message permission_denied', { message: '7 PERMISSION_DENIED: false for create' }],
    ['message permission denied', { message: 'Permission denied' }],
    ['message unauthorized (storage)', { message: 'Firebase Storage: (storage/unauthorized)' }],
  ])('a refusal: %s', (_name, fields) => {
    expect(isPermissionDenied(err(fields))).toBe(true);
  });

  test.each([
    ['ECONNREFUSED', { message: 'connect ECONNREFUSED 127.0.0.1:8080' }],
    ['an empty error', {}],
    ['a code that only mentions permission', { code: 'failed-precondition', message: 'index' }],
  ])('not a refusal: %s', (_name, fields) => {
    expect(isPermissionDenied(err(fields))).toBe(false);
  });

  test('null and a thrown string are not refusals', () => {
    expect([isPermissionDenied(null), isPermissionDenied('PERMISSION_DENIED')]).toEqual([
      false,
      false,
    ]);
  });
});

describe('markRefusals', () => {
  const real = (pr) => pr;
  const wrapped = markRefusals(real);

  test('a request that succeeds resolves to the same value', async () => {
    await expect(wrapped(Promise.resolve('doc'))).resolves.toBe('doc');
  });

  test('a refused request rejects under the fixed marker, with the error text after it', async () => {
    const refusal = err({ code: 'permission-denied', message: "false for 'create' @ L884" });
    await expect(wrapped(Promise.reject(refusal))).rejects.toThrow(
      `${ALLOW_REFUSED} false for 'create' @ L884`,
    );
  });

  test('any other failure rejects with the very same error, unmarked', async () => {
    const other = err({ message: 'connect ECONNREFUSED 127.0.0.1:8080' });
    await expect(wrapped(Promise.reject(other))).rejects.toBe(other);
  });

  test('the marker is the exact fixed text the step reads', () => {
    expect(ALLOW_REFUSED).toBe('Refused with PERMISSION_DENIED on these rules (red-first).');
  });
});
