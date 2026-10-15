/**
 * The suspension lifecycle, stated once (SHY-0463).
 *
 * `isSuspended` is written from eight places across four route files — report
 * resolution, two admin suspend routes, two admin unsuspend routes, the
 * appeal-approval path, and the expired-suspension lift. Each carried its own
 * hand-written field list, and the lists disagreed.
 *
 * `suspensionAppealStatus` is what that cost. It is set when somebody appeals
 * and was cleared by exactly ONE of those writers, so it outlived the
 * suspension it described. The consequences were not subtle: the appeal
 * endpoint read it and refused every later appeal `409 Appeal already
 * pending`, and the suspension screen renders the appeal form from it, so a
 * person suspended a second time was told they could appeal and shown no way
 * to do it. Fixing the readers and leaving the data behind is half a fix.
 *
 * A field describing a suspension must not outlive that suspension. These
 * helpers are how that stays true for the next such field — one place to add
 * it, rather than eight places to remember.
 */

/**
 * Every field that ends a suspension.
 *
 * A fresh object each call, not a shared constant: callers spread restored
 * profile values over the top, and a shared object would accumulate one
 * caller's restore into the next caller's clear.
 *
 * @param {object} restore profile values to put back (displayName etc.)
 */
function suspensionEndedFields(restore = {}) {
  return {
    isSuspended: false,
    suspensionReason: null,
    suspensionStartDate: null,
    suspensionEndDate: null,
    suspensionCanAppeal: null,
    suspensionAppealStatus: null,
    suspendedBy: null,
    preSuspensionDisplayName: null,
    preSuspensionProfilePhotoUrl: null,
    preSuspensionCoverPhotoUrl: null,
    ...restore,
  };
}

/**
 * Fields that must NOT survive into a new suspension.
 *
 * Spread into every write that begins one. A new accusation has not been
 * appealed yet, whatever happened to the last one.
 */
const SUSPENSION_STARTED_RESET = Object.freeze({ suspensionAppealStatus: null });

/** The display name every suspended account shows in place of its own. */
const SUSPENDED_DISPLAY_NAME = 'Suspended Account';

/**
 * The profile fields that begin a suspension: save the profile, then mask it.
 *
 * Unsuspend puts the saved profile back (`suspensionEndedFields`). A user who
 * is already suspended keeps the profile saved by the first suspension (SHY-0597):
 * saving again would save the mask as the "real" name, and unsuspend would then
 * restore the mask for good. Where nothing was saved (identity-graph suspend-all
 * marks a user suspended without masking), the current profile is saved instead,
 * but never the mask itself.
 *
 * @param {object} user the user document as read before the write
 */
function suspensionStartedProfileFields(user) {
  const alreadySuspended = (user.isSuspended ?? user.is_suspended) === true;
  const keep = (saved, current) => {
    if (alreadySuspended && saved !== null && saved !== undefined) return saved;
    return current ?? null;
  };

  const savedName = keep(
    user.preSuspensionDisplayName ?? user.pre_suspension_display_name,
    user.displayName ?? user.display_name,
  );

  return {
    preSuspensionDisplayName:
      alreadySuspended && savedName === SUSPENDED_DISPLAY_NAME ? null : savedName,
    preSuspensionProfilePhotoUrl: keep(
      user.preSuspensionProfilePhotoUrl ?? user.pre_suspension_profile_photo_url,
      user.profilePhotoUrl ?? user.profile_photo_url,
    ),
    preSuspensionCoverPhotoUrl: keep(
      user.preSuspensionCoverPhotoUrl ?? user.pre_suspension_cover_photo_url,
      user.coverPhotoUrl ?? user.cover_photo_url,
    ),
    displayName: SUSPENDED_DISPLAY_NAME,
    profilePhotoUrl: null,
    coverPhotoUrl: null,
    avatarUrl: null,
    description: null,
    currentRoomId: null,
  };
}

module.exports = {
  suspensionEndedFields,
  SUSPENSION_STARTED_RESET,
  SUSPENDED_DISPLAY_NAME,
  suspensionStartedProfileFields,
};
