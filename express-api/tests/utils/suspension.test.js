const {
  SUSPENDED_DISPLAY_NAME,
  suspensionStartedProfileFields,
} = require('../../src/utils/suspension');

// SHY-0597: a suspension saves the user's profile before masking it, and
// unsuspend puts the saved profile back. Suspending an already-suspended
// user must keep the first save, or the mask is saved as the "real" name and
// unsuspend restores the mask for good (seen in the 2026-10-15 nightly).

describe('suspensionStartedProfileFields', () => {
  it('saves the current profile of a user who is not suspended', () => {
    const fields = suspensionStartedProfileFields({
      isSuspended: false,
      displayName: 'Ana',
      profilePhotoUrl: 'https://img.example/p.png',
      coverPhotoUrl: 'https://img.example/c.png',
    });

    expect(fields).toEqual({
      preSuspensionDisplayName: 'Ana',
      preSuspensionProfilePhotoUrl: 'https://img.example/p.png',
      preSuspensionCoverPhotoUrl: 'https://img.example/c.png',
      displayName: 'Suspended Account',
      profilePhotoUrl: null,
      coverPhotoUrl: null,
      avatarUrl: null,
      description: null,
      currentRoomId: null,
    });
  });

  it('reads the snake_case profile fields when the camelCase ones are absent', () => {
    const fields = suspensionStartedProfileFields({
      display_name: 'Ana',
      profile_photo_url: 'https://img.example/p.png',
      cover_photo_url: 'https://img.example/c.png',
    });

    expect(fields.preSuspensionDisplayName).toBe('Ana');
    expect(fields.preSuspensionProfilePhotoUrl).toBe('https://img.example/p.png');
    expect(fields.preSuspensionCoverPhotoUrl).toBe('https://img.example/c.png');
  });

  it('saves the current profile over a stale save left on a user who is not suspended', () => {
    const fields = suspensionStartedProfileFields({
      isSuspended: false,
      displayName: 'Ana',
      profilePhotoUrl: 'https://img.example/p.png',
      coverPhotoUrl: 'https://img.example/c.png',
      preSuspensionDisplayName: 'Old name',
      preSuspensionProfilePhotoUrl: 'https://img.example/old-p.png',
      preSuspensionCoverPhotoUrl: 'https://img.example/old-c.png',
    });

    expect(fields.preSuspensionDisplayName).toBe('Ana');
    expect(fields.preSuspensionProfilePhotoUrl).toBe('https://img.example/p.png');
    expect(fields.preSuspensionCoverPhotoUrl).toBe('https://img.example/c.png');
  });

  it('saves null for profile fields the user never set', () => {
    const fields = suspensionStartedProfileFields({ displayName: 'Ana' });

    expect(fields.preSuspensionProfilePhotoUrl).toBeNull();
    expect(fields.preSuspensionCoverPhotoUrl).toBeNull();
  });

  it('keeps the first saved profile when an already-suspended user is suspended again', () => {
    const fields = suspensionStartedProfileFields({
      isSuspended: true,
      displayName: 'Suspended Account',
      profilePhotoUrl: null,
      coverPhotoUrl: null,
      preSuspensionDisplayName: 'Ana',
      preSuspensionProfilePhotoUrl: 'https://img.example/p.png',
      preSuspensionCoverPhotoUrl: 'https://img.example/c.png',
    });

    expect(fields.preSuspensionDisplayName).toBe('Ana');
    expect(fields.preSuspensionProfilePhotoUrl).toBe('https://img.example/p.png');
    expect(fields.preSuspensionCoverPhotoUrl).toBe('https://img.example/c.png');
    expect(fields.displayName).toBe('Suspended Account');
  });

  it('keeps the first saved profile when it is stored in snake_case', () => {
    const fields = suspensionStartedProfileFields({
      is_suspended: true,
      display_name: 'Suspended Account',
      pre_suspension_display_name: 'Ana',
      pre_suspension_profile_photo_url: 'https://img.example/p.png',
      pre_suspension_cover_photo_url: 'https://img.example/c.png',
    });

    expect(fields.preSuspensionDisplayName).toBe('Ana');
    expect(fields.preSuspensionProfilePhotoUrl).toBe('https://img.example/p.png');
    expect(fields.preSuspensionCoverPhotoUrl).toBe('https://img.example/c.png');
  });

  it('saves the current profile of a user suspended without a saved profile', () => {
    // identity-graph suspend-all sets isSuspended without masking or saving,
    // so the real profile is still on the user when a masking suspend follows.
    const fields = suspensionStartedProfileFields({
      isSuspended: true,
      displayName: 'Ana',
      profilePhotoUrl: 'https://img.example/p.png',
      coverPhotoUrl: 'https://img.example/c.png',
    });

    expect(fields.preSuspensionDisplayName).toBe('Ana');
    expect(fields.preSuspensionProfilePhotoUrl).toBe('https://img.example/p.png');
    expect(fields.preSuspensionCoverPhotoUrl).toBe('https://img.example/c.png');
  });

  it('never saves the mask as the real name of a suspended user with no saved name', () => {
    const fields = suspensionStartedProfileFields({
      isSuspended: true,
      displayName: 'Suspended Account',
    });

    expect(fields.preSuspensionDisplayName).toBeNull();
  });

  it('exports the mask the fields write', () => {
    expect(SUSPENDED_DISPLAY_NAME).toBe('Suspended Account');
  });

  it('returns a new object on every call', () => {
    const user = { displayName: 'Ana' };
    const first = suspensionStartedProfileFields(user);
    first.displayName = 'changed by a caller';

    expect(suspensionStartedProfileFields(user).displayName).toBe('Suspended Account');
  });
});
