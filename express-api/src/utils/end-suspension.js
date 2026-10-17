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
const { appealedSuspension } = require('./appeals');

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
 * Revoke the warnings one run of suspensions wrote, giving their GCS back.
 *
 * Only `source` is filtered in the query: an equality on `revoked` would skip
 * a stored warning that lacks the field. A run starts at its FIRST suspend: a
 * second suspend moves the start date past the first warning, which holds the
 * real deduction. A warning names its run (`suspensionRunStartedAt`, written
 * since SHY-0605) and is matched on it, so another run's warning is never
 * revoked: it ended without an upheld appeal, or has not been appealed yet. A
 * warning written before it named its run is matched by date instead: made at
 * or after the run's start. With no start known, nothing is revoked.
 *
 * @param {string} id
 * @param {number|null} runStart when the run began (ms)
 * @param {string} actor
 * @returns {Promise<{ revokedWarnings: number, gcsRestored: number }>}
 */
async function revokeRunsWarnings(id, runStart, actor) {
  if (runStart === null) return { revokedWarnings: 0, gcsRestored: 0 };

  const warnings = await atStep('warnings', () =>
    db.collection(`users/${id}/warnings`).where('source', '==', 'suspension').get(),
  );
  const open = warnings.docs.filter((d) => {
    const warning = d.data();
    if (warning.revoked === true) return false;
    if ((warning.suspensionRunStartedAt ?? null) === null) return warning.createdAt >= runStart;
    return warning.suspensionRunStartedAt === runStart;
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
 * Take the score back to 0 for the suspension in force.
 *
 * Every suspension holds the score at 0 while it is in force (Shyden,
 * 2026-10-18). One that began with the score already at 0 took nothing, so
 * when an earlier suspension's upheld appeal gives points back, this takes them
 * again on a warning of the run in force: if that suspension's appeal is
 * upheld too, they come back then. It reads the score afresh rather than
 * counting what was just given back, so an approval retried after a failed
 * hold still ends at 0.
 *
 * @returns {Promise<number>} the points held
 */
async function holdScoreForRunInForce(id, user, runStartedAt, actor) {
  const userRef = db.doc(`users/${id}`);
  const fresh = (await atStep('warnings', () => userRef.get())).data();
  const gcs = fresh.gcsScore ?? fresh.gcs_score ?? 100;
  if (gcs <= 0) return 0;

  const reason = user.suspensionReason ?? user.suspension_reason ?? null;
  const timestamp = now();
  const batch = db.batch();
  batch.set(db.doc(`users/${id}/warnings/${generateId()}`), {
    reason: reason ? `Account suspended: ${reason}` : 'Account suspended',
    severity: 5,
    gcsDeduction: gcs,
    gcsBefore: gcs,
    gcsAfter: 0,
    adminNote: 'Held by the suspension in force when an earlier suspension’s appeal was upheld',
    issuedBy: actor,
    issuedByName: null,
    source: 'suspension',
    suspensionRunStartedAt: runStartedAt,
    linkedReportId: null,
    revoked: false,
    revokedAt: null,
    revokedBy: null,
    createdAt: timestamp,
  });
  batch.update(userRef, { gcsScore: 0, gcsLastDeductionAt: timestamp });
  await atStep('warnings', () => batch.commit());
  return gcs;
}

/**
 * End a user's suspension and put back everything it took.
 *
 * @param {string|number} uniqueId the suspended user
 * @param {{ actor: string, trigger: string, extra?: object,
 *   restoreGcs?: boolean, appeal?: object }} options
 *   `actor` is recorded on the audit entry and every revoke (an admin uid, or
 *   `system:suspension-expired`); `trigger` names the end path (UNSUSPEND,
 *   APPEAL_APPROVED, ...); `extra` is written over the cleared fields.
 *   `restoreGcs` gives back the GCS the appealed suspension took: ONLY an
 *   upheld appeal passes it (Shyden, 2026-10-17), with the `appeal` itself.
 *   Any other ending leaves the GCS and the suspension warning as they are.
 *   An appeal belongs to the one suspension it answers and never reaches
 *   another (Shyden, 2026-10-18; `appealedSuspension`): its GCS comes back
 *   even when that suspension has already ended (a timed one can run out
 *   while its appeal waits), and the suspension in force is ended only when
 *   it is that one. A later suspension in force holds what comes back.
 * @returns {Promise<{ alreadyEnded: true, revokedWarnings?: number,
 *   gcsRestored?: number, gcsHeld?: number } | { alreadyEnded: false,
 *   restored: string[], revokedWarnings: number, gcsRestored: number,
 *   bansLifted: number, suggestions: object }>} `alreadyEnded` is true when
 *   the suspension this call answers is no longer in force.
 * @throws {SuspensionEndError} when a step fails; the user is left suspended
 */
async function endSuspension(
  uniqueId,
  { actor, trigger, extra = {}, restoreGcs = false, appeal } = {},
) {
  if (!actor) throw new TypeError('endSuspension: actor is required');
  if (!trigger) throw new TypeError('endSuspension: trigger is required');
  if (restoreGcs && !appeal) {
    throw new TypeError('endSuspension: an upheld appeal needs the appeal');
  }

  const id = String(uniqueId);
  const userRef = db.doc(`users/${id}`);
  const snap = await userRef.get();
  if (!snap.exists) return { alreadyEnded: true };
  const user = snap.data();
  const suspended = (user.isSuspended ?? user.is_suspended) === true;
  if (!suspended && !restoreGcs) return { alreadyEnded: true };

  const answered = restoreGcs
    ? appealedSuspension(user, appeal)
    : { runStartedAt: null, inForce: true };
  const { revokedWarnings, gcsRestored } = restoreGcs
    ? await revokeRunsWarnings(id, answered.runStartedAt, actor)
    : { revokedWarnings: 0, gcsRestored: 0 };
  if (!answered.inForce) {
    const gcsHeld = suspended
      ? await holdScoreForRunInForce(
          id,
          user,
          user.suspensionRunStartedAt ?? user.suspensionStartDate ?? null,
          actor,
        )
      : 0;
    return { alreadyEnded: true, revokedWarnings, gcsRestored, gcsHeld };
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
