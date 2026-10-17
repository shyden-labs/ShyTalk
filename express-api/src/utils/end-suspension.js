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
 * Revoke the warnings this run of suspensions wrote, giving their GCS back.
 *
 * Only `source` is filtered in the query: an equality on `revoked` would skip
 * a stored warning that lacks the field. The run starts at the FIRST suspend
 * (`suspensionRunStartedAt`; a user suspended before that field existed falls
 * back to `suspensionStartDate`): a second suspend moves the start date past
 * the first warning, which holds the real deduction. An earlier suspension's
 * warning is never revoked: it ended without an upheld appeal. With no start
 * known, nothing is revoked.
 *
 * @returns {Promise<{ revokedWarnings: number, gcsRestored: number }>}
 */
async function revokeThisRunsWarnings(id, user, actor) {
  const runStart = user.suspensionRunStartedAt ?? user.suspensionStartDate ?? null;
  if (runStart === null) return { revokedWarnings: 0, gcsRestored: 0 };

  const warnings = await atStep('warnings', () =>
    db.collection(`users/${id}/warnings`).where('source', '==', 'suspension').get(),
  );
  const open = warnings.docs.filter((d) => {
    const warning = d.data();
    return warning.revoked !== true && warning.createdAt >= runStart;
  });
  let revokedWarnings = 0;
  let gcsRestored = 0;
  // One at a time: each revoke reads the GCS the last one wrote.
  for (const warning of open) {
    const result = await atStep('warnings', () => revokeWarning(id, warning.id, { actor }));
    if (!result.alreadyRevoked) {
      revokedWarnings += 1;
      gcsRestored += result.restoredGcs - result.previousGcs;
    }
  }
  return { revokedWarnings, gcsRestored };
}

/**
 * End a user's suspension and put back everything it took.
 *
 * @param {string|number} uniqueId the suspended user
 * @param {{ actor: string, trigger: string, extra?: object,
 *   restoreGcs?: boolean }} options
 *   `actor` is recorded on the audit entry and every revoke (an admin uid, or
 *   `system:suspension-expired`); `trigger` names the end path (UNSUSPEND,
 *   APPEAL_APPROVED, ...); `extra` is written over the cleared fields.
 *   `restoreGcs` gives back the GCS this suspension took: ONLY an upheld
 *   appeal passes it (Shyden, 2026-10-17). Any other ending leaves the GCS
 *   and the suspension warning as they are.
 * @returns {Promise<{ alreadyEnded: true } | { alreadyEnded: false,
 *   restored: string[], revokedWarnings: number, gcsRestored: number,
 *   bansLifted: number, suggestions: object }>}
 * @throws {SuspensionEndError} when a step fails; the user is left suspended
 */
async function endSuspension(uniqueId, { actor, trigger, extra = {}, restoreGcs = false } = {}) {
  if (!actor) throw new TypeError('endSuspension: actor is required');
  if (!trigger) throw new TypeError('endSuspension: trigger is required');

  const id = String(uniqueId);
  const userRef = db.doc(`users/${id}`);
  const snap = await userRef.get();
  if (!snap.exists) return { alreadyEnded: true };
  const user = snap.data();
  if ((user.isSuspended ?? user.is_suspended) !== true) return { alreadyEnded: true };

  const { revokedWarnings, gcsRestored } = restoreGcs
    ? await revokeThisRunsWarnings(id, user, actor)
    : { revokedWarnings: 0, gcsRestored: 0 };

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

/**
 * The 500 body for an ending that stopped at a step, or null for any other
 * error. Every end path answers a failed ending the same way.
 *
 * @param {unknown} err
 * @returns {{ error: string, step: string } | null}
 */
function suspensionEndFailure(err) {
  if (!(err instanceof SuspensionEndError)) return null;
  return {
    error: 'The suspension could not be fully ended. The user is still suspended.',
    step: err.step,
  };
}

module.exports = { endSuspension, SuspensionEndError, suspensionEndFailure };
