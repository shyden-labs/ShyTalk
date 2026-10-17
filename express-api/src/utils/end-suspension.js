/**
 * Ending a suspension, stated once (SHY-0605).
 *
 * Five routes end a suspension: the two admin unsuspends, an approved appeal,
 * the owner's lift of an expired one, and identity-graph unsuspend-all. Each
 * used to write its own end, and none put everything back: the bio and
 * sign-in photo stayed blank, the suspension warning kept the GCS at 0, and
 * only one of them lifted the auto-applied bans or unflagged the suggestions.
 * Every end path calls this instead, so each puts back the same things.
 *
 * The user is written LAST. A step that fails leaves the user suspended, and
 * calling this again finishes the job: a revoked warning is skipped, lifted
 * bans and unflagged suggestions are not found again.
 */

const { db } = require('./firebase');
const { generateId, now } = require('./helpers');
const { revokeWarning } = require('./warnings');
const { liftAutoAppliedBans } = require('./auto-bans');
const { unflagUnsuspendedUserSuggestions } = require('./flag-suspended-user-suggestions');
const { suspensionEndedFields, profileToRestore } = require('./suspension');
const { clearSuspensionCache } = require('../middleware/auth');

/** An ending that stopped before the user was written. `step` names where. */
class SuspensionEndError extends Error {
  /**
   * @param {'warnings'|'bans'|'suggestions'|'user'} step
   * @param {string} message
   * @param {Error} [cause]
   */
  constructor(step, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SuspensionEndError';
    this.step = step;
  }
}

async function atStep(step, work) {
  try {
    return await work();
  } catch (err) {
    throw new SuspensionEndError(step, err && err.message ? err.message : String(err), err);
  }
}

/**
 * End a user's suspension and put back everything it took.
 *
 * @param {string|number} uniqueId the suspended user
 * @param {{ actor: string, trigger: string, extra?: object }} options
 *   `actor` is recorded on the audit entry and every revoke (an admin uid, or
 *   `system:suspension-expired`); `trigger` names the end path (UNSUSPEND,
 *   APPEAL_APPROVED, ...); `extra` is written over the cleared fields
 * @returns {Promise<{ alreadyEnded: true } | { alreadyEnded: false,
 *   restored: string[], revokedWarnings: number, gcsRestored: number,
 *   bansLifted: number, suggestions: object }>}
 * @throws {SuspensionEndError} when a step fails; the user is left suspended
 */
async function endSuspension(uniqueId, { actor, trigger, extra = {} } = {}) {
  if (!actor) throw new TypeError('endSuspension: actor is required');
  if (!trigger) throw new TypeError('endSuspension: trigger is required');

  const id = String(uniqueId);
  const userRef = db.doc(`users/${id}`);
  const snap = await userRef.get();
  if (!snap.exists) return { alreadyEnded: true };
  const user = snap.data();
  if ((user.isSuspended ?? user.is_suspended) !== true) return { alreadyEnded: true };

  // Only `source` is filtered in the query: an equality on `revoked` would
  // skip a stored warning that lacks the field. No start-date filter either:
  // a second suspend moves `suspensionStartDate` past the first warning, which
  // holds the real deduction. Every ending revokes its warnings, so the
  // unrevoked ones are this suspension's.
  const warnings = await atStep('warnings', () =>
    db.collection(`users/${id}/warnings`).where('source', '==', 'suspension').get(),
  );
  let revokedWarnings = 0;
  let gcsRestored = 0;
  // One at a time: each revoke reads the GCS the last one wrote.
  for (const warning of warnings.docs.filter((d) => d.data().revoked !== true)) {
    const result = await atStep('warnings', () => revokeWarning(id, warning.id, { actor }));
    if (!result.alreadyRevoked) {
      revokedWarnings += 1;
      gcsRestored += result.restoredGcs - result.previousGcs;
    }
  }

  const bansLifted = await atStep('bans', () => liftAutoAppliedBans(id, actor));

  const suggestions = await atStep('suggestions', () => unflagUnsuspendedUserSuggestions(id));
  if (suggestions.partial) {
    throw new SuspensionEndError(
      'suggestions',
      suggestions.error || 'some suggestions stayed flagged',
    );
  }

  const restore = profileToRestore(user);
  const restored = Object.keys(restore);
  const batch = db.batch();
  batch.update(userRef, suspensionEndedFields({ ...restore, ...extra }));
  // The shape the admin audit log page reads (SHY-0622): it orders by
  // `timestamp` and drops entries without it.
  batch.set(db.doc(`adminAuditLog/${generateId()}`), {
    adminUid: actor,
    action: 'END_SUSPENSION',
    actionType: 'end_suspension',
    targetType: 'user',
    targetId: id,
    details: {
      trigger,
      restored,
      revokedWarnings,
      gcsRestored,
      bansLifted,
      unflagged: suggestions.unflaggedCount,
    },
    timestamp: now(),
  });
  await atStep('user', () => batch.commit());

  clearSuspensionCache(Number(id));

  return { alreadyEnded: false, restored, revokedWarnings, gcsRestored, bansLifted, suggestions };
}

module.exports = { endSuspension, SuspensionEndError };
