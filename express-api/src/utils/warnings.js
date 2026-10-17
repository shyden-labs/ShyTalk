/**
 * Revoking a warning, stated once (SHY-0605).
 *
 * The admin "revoke warning" route and every suspension ending revoke
 * warnings. Each used to be written where it was needed; this is the one
 * place that marks a warning revoked and gives its GCS deduction back.
 *
 * The GCS is read inside the transaction that writes it. A read before a
 * batch lets two revokes on the same user (an admin's, and an ending that
 * revokes several warnings) both read 80 and both write 90, losing a restore.
 */

const { db } = require('./firebase');
const { generateId, now } = require('./helpers');

/** A revoke refused before anything was written. `code` names why. */
class WarningRevokeError extends Error {
  /**
   * @param {'warning-not-found'|'user-not-found'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'WarningRevokeError';
    this.code = code;
  }
}

/**
 * Mark one warning revoked and give its GCS deduction back, capped at 100.
 *
 * A warning already revoked is left alone, so its GCS is never given back
 * twice. A suspension warning never raised `warningCount` (the admin suspend
 * route writes it with `source: 'suspension'` and leaves the count), so
 * revoking it leaves the count alone too.
 *
 * @param {string} uniqueId the warned user
 * @param {string} warningId the warning in `users/{uniqueId}/warnings`
 * @param {{ actor: string, audit?: boolean }} options `actor` is recorded as
 *   `revokedBy`; `audit` also writes the REVOKE_WARNING audit entry
 * @returns {Promise<{ alreadyRevoked: true } | { alreadyRevoked: false,
 *   deduction: number, previousGcs: number, restoredGcs: number }>}
 */
async function revokeWarning(uniqueId, warningId, { actor, audit = false }) {
  const timestamp = now();
  const warningRef = db.doc(`users/${uniqueId}/warnings/${warningId}`);
  const userRef = db.doc(`users/${uniqueId}`);

  return db.runTransaction(async (t) => {
    const [warningSnap, userSnap] = await Promise.all([t.get(warningRef), t.get(userRef)]);
    if (!warningSnap.exists) throw new WarningRevokeError('warning-not-found', 'Warning not found');
    const warning = warningSnap.data();
    if (warning.revoked === true) return { alreadyRevoked: true };
    if (!userSnap.exists) throw new WarningRevokeError('user-not-found', 'User not found');
    const user = userSnap.data();

    const deduction = warning.gcsDeduction || 0;
    const previousGcs = user.gcsScore ?? user.gcs_score ?? 100;
    const restoredGcs = Math.min(100, previousGcs + deduction);

    const userFields = { gcsScore: restoredGcs };
    if (warning.source !== 'suspension') {
      const currentCount = user.warningCount ?? user.warning_count ?? 0;
      userFields.warningCount = Math.max(0, currentCount - 1);
    }

    t.update(warningRef, { revoked: true, revokedAt: timestamp, revokedBy: actor });
    t.update(userRef, userFields);
    if (audit) {
      t.set(db.doc(`adminAuditLog/${generateId()}`), {
        adminId: actor,
        action: 'REVOKE_WARNING',
        targetUserId: uniqueId,
        details: `Revoked warning ${warningId}, restored ${deduction} GCS (${previousGcs} → ${restoredGcs})`,
        createdAt: timestamp,
      });
    }

    return { alreadyRevoked: false, deduction, previousGcs, restoredGcs };
  });
}

module.exports = { revokeWarning, WarningRevokeError };
