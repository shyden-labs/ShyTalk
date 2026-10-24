/**
 * Clearing a member's `currentRoomId` when a room closes or lets them go
 * (SHY-0708).
 *
 * A room's member list cannot be trusted to name only people sitting in
 * it: before SHY-0708 a client could create a room listing anyone, and
 * `currentRoomId` is a self-write a member updates on their own. So a
 * member is cleared only while their `currentRoomId` still names this
 * room, read and written in one transaction per member: someone who moved
 * to another room keeps it. An id that is not digits never becomes a
 * `users/{id}` path.
 *
 * Best-effort, as before: the room's own change has committed, and apps
 * also clear their own `currentRoomId` on seeing the room close. Nothing
 * is thrown; failures are counted and logged.
 */

const SOURCE = 'room-members';
const USER_ID = /^\d+$/;

/**
 * @param {object} db - Firestore
 * @param {string} roomId
 * @param {Array<string|number>} userIds - the room's members, as stored
 * @param {object} log
 * @returns {Promise<{cleared: number, elsewhere: number, unsafe: number, failed: number}>}
 *   elsewhere counts members whose `currentRoomId` no longer names the room
 *   (another room, none, or no user document)
 */
async function clearCurrentRoomFor(db, roomId, userIds, log) {
  const ids = [...new Set(userIds.map(String))];
  const safe = ids.filter((id) => USER_ID.test(id));
  const result = { cleared: 0, elsewhere: 0, unsafe: ids.length - safe.length, failed: 0 };
  if (result.unsafe) {
    log.error(SOURCE, 'member ids that are not digits skipped', { roomId, count: result.unsafe });
  }

  const outcomes = await Promise.allSettled(
    safe.map((id) =>
      db.runTransaction(async (t) => {
        const ref = db.doc(`users/${id}`);
        const snap = await t.get(ref);
        if (!snap.exists || snap.data().currentRoomId !== roomId) return false;
        t.update(ref, { currentRoomId: null });
        return true;
      }),
    ),
  );

  let firstError = null;
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      result.failed += 1;
      firstError = firstError || outcome.reason;
    } else if (outcome.value) {
      result.cleared += 1;
    } else {
      result.elsewhere += 1;
    }
  }
  if (result.elsewhere) {
    log.info(SOURCE, 'currentRoomId kept: member is elsewhere', {
      roomId,
      count: result.elsewhere,
    });
  }
  if (result.failed) {
    log.error(SOURCE, 'currentRoomId clear failed', {
      roomId,
      count: result.failed,
      error: firstError.message,
    });
  }
  return result;
}

module.exports = { clearCurrentRoomFor };
