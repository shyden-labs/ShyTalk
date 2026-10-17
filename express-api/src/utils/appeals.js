/**
 * Suspension appeals — one schema, written in one place (SHY-0463).
 *
 * Two routes accept an appeal: `POST /api/users/:uniqueId/appeal`, which the
 * app calls, and `POST /api/appeals`, which the web and admin tooling call.
 * They used to write the SAME collection with different shapes and disagree
 * about what "already pending" meant, and both halves of that disagreement
 * cost a suspended person the right to answer an accusation:
 *
 *   - the app's route wrote `uniqueId` (a String from the route param) where
 *     every reader looks for `userId` (a Number), so an appeal from the phone
 *     reached the moderation queue with no user attached to it; and
 *   - it decided "already pending" from a flag on the user document that only
 *     one of the three suspension-ending writers clears, so after a single
 *     appeal every LATER suspension was refused 409 for ever.
 *
 * The schema and the duplicate check therefore live here rather than in either
 * route. Two routes stating the same fact is how they came to disagree.
 */

const { db } = require('./firebase');
const { generateId, now } = require('./helpers');
const { queryDocs } = require('./firestore-helpers');

/** The collection both routes write. */
const APPEALS_COLLECTION = 'suspensionAppeals';

/**
 * Normalise an owner id to the type every reader compares against.
 *
 * `req.auth.uniqueId` is a Number and `req.params.uniqueId` is a String, so
 * the two callers arrive with different types for the same person. Firestore
 * equality is typed: a String owner id matches nothing, while still looking
 * present in the admin console.
 */
function toOwnerId(uniqueId) {
  const id = Number(uniqueId);
  if (!Number.isInteger(id)) {
    // Explicit, for the reason `requireOwner` gives (Audit L1): `Number()` on a
    // non-numeric value yields NaN silently, and `userId: NaN` would land in
    // Firestore as a row that looks present in the admin console and matches
    // no query ever again — the precise failure this ticket exists to end.
    throw new Error(`appeal owner id must be an integer, received: ${uniqueId}`);
  }
  return id;
}

/** The start (ms) of the run of suspensions in force, or null: none, or unknown. */
function runInForce(user) {
  if (!user || (user.isSuspended ?? user.is_suspended) !== true) return null;
  return user.suspensionRunStartedAt ?? user.suspensionStartDate ?? null;
}

/**
 * The suspension an appeal answers, and whether it is the one in force.
 *
 * An appeal belongs to the one suspension it answers and never reaches another
 * (Shyden, 2026-10-18): a timed suspension can run out while its appeal waits,
 * and a new one can follow. Since SHY-0605 an appeal records its run
 * (`suspensionRunStartedAt`). One made before that is placed by when it was
 * made: during the run in force if made at or after that run began, else in a
 * run no longer known. Where the run in force has no known start, an older
 * appeal is taken to answer it, as before; a recorded run never is.
 *
 * @param {object|null} user the appellant's document
 * @param {object} appeal the appeal document
 * @returns {{ runStartedAt: number|null, inForce: boolean }}
 */
function appealedSuspension(user, appeal) {
  const suspended = !!user && (user.isSuspended ?? user.is_suspended) === true;
  const current = runInForce(user);
  const recorded = appeal.suspensionRunStartedAt ?? null;
  if (recorded !== null) {
    return { runStartedAt: recorded, inForce: suspended && recorded === current };
  }
  if (!suspended) return { runStartedAt: null, inForce: false };
  if (current === null) return { runStartedAt: null, inForce: true };
  const madeDuring = (appeal.createdAt ?? 0) >= current;
  return { runStartedAt: madeDuring ? current : null, inForce: madeDuring };
}

/**
 * Why this user may not appeal, as the answer to send, or null.
 *
 * Both routes ask it, so they admit the same people: only a suspended user
 * whose suspension can be appealed has a suspension for an appeal to answer.
 *
 * @param {object|null} user the appellant's document
 * @returns {{ status: number, error: string } | null}
 */
function appealRefusal(user) {
  if (!user || (user.isSuspended ?? user.is_suspended) !== true) {
    return { status: 400, error: 'User is not suspended' };
  }
  if ((user.suspensionCanAppeal ?? user.suspension_can_appeal) !== true) {
    return { status: 403, error: 'Appeals are not allowed for this suspension' };
  }
  return null;
}

/**
 * The pending appeal of the suspension in force for this person, or null.
 *
 * Read from the appeals collection, never from a flag on the user document:
 * an appeal that has been resolved or deleted stops blocking the next one,
 * which is the behaviour "already pending" is supposed to describe. An earlier
 * suspension's appeal, still pending, answers that suspension only, so it does
 * not stand in the way of appealing this one (SHY-0605).
 *
 * @param {string|number} uniqueId
 * @param {object|null} user the appellant's document
 */
async function findPendingAppeal(uniqueId, user) {
  // `queryDocs` rather than a raw `.get()`: it is how the rest of these routes
  // read Firestore, and it is the seam the existing suites already stand on.
  const rows = await queryDocs(
    db
      .collection(APPEALS_COLLECTION)
      .where('userId', '==', toOwnerId(uniqueId))
      .where('status', '==', 'pending'),
  );
  return rows.find((row) => appealedSuspension(user, row).inForce) ?? null;
}

/**
 * Record an appeal and mark the user doc as having one pending.
 *
 * `suspensionAppealStatus` is still written — the app renders it and the admin
 * review route updates it — but nothing GATES on it any more. It is a display
 * mirror of the collection, not a second source of truth.
 *
 * The appeal also names the run of suspensions it answers
 * (`suspensionRunStartedAt`, SHY-0605), so it reaches no other: the ending
 * clears the run start from the user. Callers admit the user first
 * (`appealRefusal`), so there is a run in force to name.
 *
 * @param {{ uniqueId: string|number, appealText: string, user: object }} appeal
 */
async function createAppeal({ uniqueId, appealText, user }) {
  const userId = toOwnerId(uniqueId);
  const appealId = generateId();
  await Promise.all([
    db.doc(`${APPEALS_COLLECTION}/${appealId}`).set(
      {
        userId,
        appealText,
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        createdAt: now(),
        suspensionRunStartedAt: runInForce(user),
      },
      { merge: true },
    ),
    db.doc(`users/${userId}`).update({ suspensionAppealStatus: 'pending' }),
  ]);
  return appealId;
}

module.exports = {
  APPEALS_COLLECTION,
  toOwnerId,
  appealedSuspension,
  appealRefusal,
  findPendingAppeal,
  createAppeal,
};
