'use strict';

/**
 * Marks an ALLOW test's refusal for the rules red-first step (SHY-0657).
 *
 * Every firestore.rules change must be proven (Shyden, 2026-10-21); a
 * loosening is proven by an ALLOW test that the base rules refuse. In that
 * base run only, `red-first-setup.js` wraps assertSucceeds with
 * markRefusals, so a refusal fails under ALLOW_REFUSED, a fixed text the
 * step reads, whatever the Firestore error says. isPermissionDenied is
 * assertFails' own test (@firebase/rules-unit-testing 5.0.2), so the two
 * judge a refusal alike.
 */

const ALLOW_REFUSED = 'Refused with PERMISSION_DENIED on these rules (red-first).';

function isPermissionDenied(err) {
  const code = err?.code?.toLowerCase() || '';
  const message = err?.message?.toLowerCase() || '';
  return (
    code === 'permission-denied' ||
    code === 'permission_denied' ||
    message.includes('permission_denied') ||
    message.includes('permission denied') ||
    message.includes('unauthorized')
  );
}

function markRefusals(assertSucceeds) {
  return (request) =>
    Promise.resolve(assertSucceeds(request)).catch((err) => {
      if (isPermissionDenied(err)) {
        throw new Error(`${ALLOW_REFUSED} ${err.message}`, { cause: err });
      }
      throw err;
    });
}

module.exports = { ALLOW_REFUSED, isPermissionDenied, markRefusals };
