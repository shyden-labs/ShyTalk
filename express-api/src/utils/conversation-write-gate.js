/**
 * Conversation gates shared by the routes that read or write a conversation.
 *
 * SHY-0614 moved these out of `routes/conversations.js` so the send, edit and
 * recall routes answer the same refusals from one home.
 */

const { db } = require('./firebase');
const { requireSameCohort } = require('../middleware/sameCohort');
const { isLiveAdmin } = require('../middleware/auth');
const { auditAdminFlagBypass } = require('./segregation-audit');
const { isAgeGatingEnabled } = require('../safety/age-gating-flag');
const { checkFeatureAccess } = require('../safety/enforce');

/**
 * UK OSA #17 PR 4 + PR 8 — combined gate for conversation reads.
 *
 * Two gate paths, in order:
 *
 *   1. (PR 8) `crossCohortAtMigration: true` → 404 regardless of
 *      current cohorts. Set by the migration script on 1:1 cross-
 *      cohort threads. The flag is the load-bearing rules-side hide
 *      (firestore.rules denies reads on the parent + every
 *      subcollection when set, per PR 3); Express mirrors the 404
 *      as defence in depth. Admin callers are exempt (live-admin
 *      re-check, same pattern as `requireSameCohort`) — moderators
 *      need cross-cohort visibility for forensics. No audit row is
 *      written here: the migration already wrote one per migrated
 *      thread, and a per-request audit on a known-blocked thread
 *      would be noise.
 *
 *   2. (PR 4) Runtime cohort gate — 1:1 only. Looks up the OTHER
 *      participant's current cohort and 404s if it mismatches the
 *      caller's. Group conversations skip both gates (the freeze
 *      semantics for groups are participant-list only — existing
 *      members keep read+write per design doc § "Migration").
 */
async function gateCrossCohortConversation(req, res, conv) {
  if (conv?.crossCohortAtMigration === true) {
    // Admin re-check matches requireSameCohort's pattern (60s
    // adminClaimCache, demoted-admin defence). Honoured here so a
    // mod can read a hidden thread for an appeal without bypassing
    // the rest of the gate machinery.
    if (req?.auth?.token?.admin === true) {
      const liveAdmin = req?.auth?.uid ? await isLiveAdmin(req.auth.uid) : false;
      if (liveAdmin) {
        auditAdminFlagBypass(req, String(req?.params?.id ?? ''));
        return false;
      }
    }
    res.status(404).json({ error: 'Not found' });
    return true;
  }
  if (conv?.isGroup) return false;
  const participantIds = (conv?.participantIds || []).map(String);
  if (participantIds.length !== 2) return false;
  const callerId = String(req.auth.uniqueId);
  const otherId = participantIds.find((p) => p !== callerId);
  if (!otherId) return false;
  return requireSameCohort(req, res, otherId, async () => {
    const snap = await db.doc(`users/${otherId}`).get();
    return snap.exists ? snap.data() : null;
  });
}

/**
 * SHY-0614 — every route that writes words into a conversation answers the
 * same refusals as the send route did inline: not a participant (403), the
 * SHY-0060 DM age gate (when `ageGate` and the operator flag is on), and the
 * migration / runtime cohort gate (404). Returns true when it has answered.
 *
 * SHY-0060 — a DM with a mutually-followed user is 13+ (bidirectional
 * consent); a DM with anyone else is 18+ (the stranger predator-vector).
 * Group conversations are moderated multi-user spaces — out of scope. The
 * flag is checked first so the sender doc is loaded only when gating is on.
 * IDs cross a String/Number boundary here: participantIds are stored as
 * STRINGS (firestore.rules + the app), req.auth.uniqueId is a NUMBER, and
 * followingIds/followerIds are NUMBERS (the follow route writes parseInt'd
 * ids). Everything is coerced to String for comparison.
 */
async function gateConversationWrite(req, res, convDoc, { ageGate }) {
  const callerId = String(req.auth.uniqueId);
  const participantIds = (convDoc.participantIds || []).map(String);
  if (!participantIds.includes(callerId)) {
    res.status(403).json({ error: 'Not a participant of this conversation' });
    return true;
  }
  const dmRecipientIds = participantIds.filter((pid) => pid !== callerId);
  if (
    ageGate &&
    !convDoc.isGroup &&
    dmRecipientIds.length === 1 &&
    (await isAgeGatingEnabled(db))
  ) {
    const senderData = (await db.doc(`users/${callerId}`).get()).data() || {};
    const recipientId = dmRecipientIds[0];
    const mutualFollow =
      Array.isArray(senderData.followingIds) &&
      Array.isArray(senderData.followerIds) &&
      senderData.followingIds.map(String).includes(recipientId) &&
      senderData.followerIds.map(String).includes(recipientId);
    const dmFeature = mutualFollow
      ? 'DIRECT_MESSAGE_WITH_FOLLOWED_USER'
      : 'DIRECT_MESSAGE_WITH_STRANGER';
    const dmBlock = await checkFeatureAccess(db, dmFeature, senderData);
    if (dmBlock) {
      res.status(dmBlock.status).json(dmBlock.body);
      return true;
    }
  }
  return gateCrossCohortConversation(req, res, convDoc);
}

module.exports = { gateConversationWrite, gateCrossCohortConversation };
