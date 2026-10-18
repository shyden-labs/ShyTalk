/**
 * The device and network bans a suspension applies, and lifts (SHY-0605).
 *
 * Moved from `routes/admin-users.js` so every suspension ending can lift
 * them, not only the admin unsuspend route. A home of their own rather than
 * `bans.js`: they call `syncBannedClaim`, and `banned-claim.js` already
 * requires `bans.js`, so living there would make the two require each other.
 */

const { db } = require('./firebase');
const { clearBanCache } = require('./bans');
const { syncBannedClaim } = require('./banned-claim');
const { generateId, now } = require('./helpers');
const log = require('./log');

// ══════════════════════════════════════════════════════════════
// HELPER: Auto-apply device + network bans on suspension
// ══════════════════════════════════════════════════════════════

/**
 * When a user is suspended, automatically ban all their known devices
 * and their last known IP address. Uses the same duration as the
 * suspension if an endDate is provided, otherwise permanent.
 */
async function autoApplyBans(uniqueId, endDate) {
  const timestamp = now();

  // Calculate expiry — match suspension duration or permanent
  let expiresAt = null;
  let duration = 'permanent';
  if (endDate) {
    expiresAt = new Date(endDate).toISOString();
    duration = 'suspension-match';
  }

  // Find all devices bound to this user
  const bindingsSnap = await db
    .collection('deviceBindings')
    .where('uniqueId', '==', uniqueId)
    .get();

  let lastIp = null;
  const batch = db.batch();

  for (const doc of bindingsSnap.docs) {
    const binding = doc.data();

    // Create a device ban for each bound device
    batch.set(db.doc(`deviceBans/${doc.id}`), {
      deviceId: doc.id,
      reason: 'Auto-applied: user suspended',
      duration,
      expiresAt,
      linkedUniqueId: uniqueId,
      autoApplied: true,
      createdAt: timestamp,
      createdBy: 'system',
    });

    // Track the last known IP from the most recent binding
    if (binding.lastIp || binding.ip) {
      lastIp = binding.lastIp || binding.ip;
    }
  }

  // Create a network ban for the last known IP
  if (lastIp) {
    batch.set(db.doc(`networkBans/${generateId()}`), {
      type: 'ip',
      value: lastIp,
      reason: 'Auto-applied: user suspended',
      duration,
      expiresAt,
      linkedUniqueId: uniqueId,
      autoApplied: true,
      createdAt: timestamp,
      createdBy: 'system',
    });
  }

  await batch.commit();

  // Auto-applied bans must bite on the target's next request, exactly
  // like admin-issued ones (SHY-0149 mid-session AC).
  clearBanCache();

  // SHY-0150: the auto-bans change the target's claim standing — mint
  // `banned: true` (+ revoke refresh tokens) through the same chokepoint
  // the admin ban routes use. AFTER clearBanCache so the recompute reads
  // the standing this batch just created. This helper runs fire-and-forget
  // from the suspend route, whose .catch logs any failure here.
  await syncBannedClaim(uniqueId);

  const deviceCount = bindingsSnap.docs.length;
  const networkCount = lastIp ? 1 : 0;
  log.info('admin-users', 'Auto-bans applied', {
    uniqueId,
    deviceBans: deviceCount,
    networkBans: networkCount,
  });
}

// ══════════════════════════════════════════════════════════════
// HELPER: Lift auto-applied bans on unsuspension
// ══════════════════════════════════════════════════════════════

/**
 * Remove device and network bans that were auto-applied during suspension.
 * Only removes bans with autoApplied === true and linkedUserId === uid.
 * Manually-applied bans are left untouched.
 *
 * @returns {Promise<number>} how many bans were lifted (0 when none)
 */
async function liftAutoAppliedBans(uniqueId, adminUid) {
  const numericId = Number(uniqueId);
  const stringId = String(uniqueId);

  const [deviceSnapStr, deviceSnapNum, networkSnapStr, networkSnapNum] = await Promise.all([
    db
      .collection('deviceBans')
      .where('linkedUniqueId', '==', stringId)
      .where('autoApplied', '==', true)
      .get(),
    db
      .collection('deviceBans')
      .where('linkedUniqueId', '==', numericId)
      .where('autoApplied', '==', true)
      .get(),
    db
      .collection('networkBans')
      .where('linkedUniqueId', '==', stringId)
      .where('autoApplied', '==', true)
      .get(),
    db
      .collection('networkBans')
      .where('linkedUniqueId', '==', numericId)
      .where('autoApplied', '==', true)
      .get(),
  ]);

  // Deduplicate by path in case both id forms match the same doc. Not by the
  // bare id: a device ban and a network ban may share one.
  const seen = new Set();
  const allDocs = [];
  for (const snap of [deviceSnapStr, deviceSnapNum, networkSnapStr, networkSnapNum]) {
    for (const d of snap.docs) {
      if (!seen.has(d.ref.path)) {
        seen.add(d.ref.path);
        allDocs.push(d);
      }
    }
  }
  if (allDocs.length === 0) return 0;

  await Promise.all(allDocs.map((d) => d.ref.delete()));
  // Lifting bans must unblock the gate as promptly as banning engages it.
  clearBanCache();

  // SHY-0150: RECOMPUTE the claim (never blind-clear) — a manually-issued
  // ban that survives the auto-ban lift keeps the user's claim standing.
  await syncBannedClaim(uniqueId);

  // Audit log
  await db.doc(`adminAuditLog/${generateId()}`).set({
    adminId: adminUid,
    action: 'LIFT_AUTO_BANS',
    targetUserId: uniqueId,
    details: `Removed ${allDocs.length} auto-applied ban(s) on unsuspension`,
    createdAt: now(),
  });

  log.info('admin-users', 'Auto-applied bans lifted', { uniqueId, removed: allDocs.length });
  return allDocs.length;
}

module.exports = { autoApplyBans, liftAutoAppliedBans };
