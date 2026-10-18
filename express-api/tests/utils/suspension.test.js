const {
  SUSPENDED_DISPLAY_NAME,
  profileToRestore,
  suspensionEndedFields,
  suspensionStartedProfileFields,
} = require('../../src/utils/suspension');

// Every start names when it began; these tests start at one fixed time.
const START = 1709913600000;
const started = (user) => suspensionStartedProfileFields(user, START);

// SHY-0597: a suspension saves the user's profile before masking it, and
// unsuspend puts the saved profile back. Suspending an already-suspended
// user must keep the first save, or the mask is saved as the "real" name and
// unsuspend restores the mask for good (seen in the 2026-10-15 nightly).

describe('suspensionStartedProfileFields', () => {
  it('saves the current profile of a user who is not suspended', () => {
    const fields = started({
      isSuspended: false,
      displayName: 'Ana',
      profilePhotoUrl: 'https://img.example/p.png',
      coverPhotoUrl: 'https://img.example/c.png',
      description: 'Hola, I teach Spanish',
      avatarUrl: 'https://signin.example/a.png',
    });

    expect(fields).toEqual({
      preSuspensionDisplayName: 'Ana',
      preSuspensionProfilePhotoUrl: 'https://img.example/p.png',
      preSuspensionCoverPhotoUrl: 'https://img.example/c.png',
      preSuspensionDescription: 'Hola, I teach Spanish',
      preSuspensionAvatarUrl: 'https://signin.example/a.png',
      displayName: 'Suspended Account',
      profilePhotoUrl: null,
      coverPhotoUrl: null,
      avatarUrl: null,
      description: null,
      currentRoomId: null,
      suspensionRunStartedAt: START,
    });
  });

  it('starts the run at this suspension, over a stale start, for a user not suspended', () => {
    const fields = started({ isSuspended: false, suspensionRunStartedAt: 1700000000000 });

    expect(fields.suspensionRunStartedAt).toBe(START);
  });

  it('keeps the run’s first start when an already-suspended user is suspended again', () => {
    const fields = started({
      isSuspended: true,
      suspensionRunStartedAt: 1709000000000,
      suspensionStartDate: 1709500000000,
    });

    expect(fields.suspensionRunStartedAt).toBe(1709000000000);
  });

  it('starts the run at the current start for a user suspended before runs were recorded', () => {
    const fields = started({ isSuspended: true, suspensionStartDate: 1709500000000 });

    expect(fields.suspensionRunStartedAt).toBe(1709500000000);
  });

  it('refuses a start that names no time', () => {
    expect(() => suspensionStartedProfileFields({ displayName: 'Ana' })).toThrow(TypeError);
  });

  it('reads the snake_case profile fields when the camelCase ones are absent', () => {
    const fields = started({
      display_name: 'Ana',
      profile_photo_url: 'https://img.example/p.png',
      cover_photo_url: 'https://img.example/c.png',
    });

    expect(fields.preSuspensionDisplayName).toBe('Ana');
    expect(fields.preSuspensionProfilePhotoUrl).toBe('https://img.example/p.png');
    expect(fields.preSuspensionCoverPhotoUrl).toBe('https://img.example/c.png');
  });

  it('saves the current profile over a stale save left on a user who is not suspended', () => {
    const fields = started({
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
    const fields = started({ displayName: 'Ana' });

    expect(fields.preSuspensionProfilePhotoUrl).toBeNull();
    expect(fields.preSuspensionCoverPhotoUrl).toBeNull();
  });

  // SHY-0605: the bio and the sign-in photo were masked but never saved, so
  // ending a suspension could not put them back.
  it('saves null for a bio the user never wrote', () => {
    expect(started({ displayName: 'Ana' }).preSuspensionDescription).toBeNull();
  });

  it('saves null for a sign-in photo the user never had', () => {
    expect(started({ displayName: 'Ana' }).preSuspensionAvatarUrl).toBeNull();
  });

  it('saves the current bio over a stale save left on a user who is not suspended', () => {
    const fields = started({
      isSuspended: false,
      description: 'New bio',
      preSuspensionDescription: 'Old bio',
    });

    expect(fields.preSuspensionDescription).toBe('New bio');
  });

  it('saves the current sign-in photo over a stale save left on a user who is not suspended', () => {
    const fields = started({
      isSuspended: false,
      avatarUrl: 'https://signin.example/new.png',
      preSuspensionAvatarUrl: 'https://signin.example/old.png',
    });

    expect(fields.preSuspensionAvatarUrl).toBe('https://signin.example/new.png');
  });

  it('keeps the first saved bio when an already-suspended user is suspended again', () => {
    const fields = started({
      isSuspended: true,
      description: null,
      preSuspensionDescription: 'Hola, I teach Spanish',
    });

    expect(fields.preSuspensionDescription).toBe('Hola, I teach Spanish');
  });

  it('keeps the first saved sign-in photo when an already-suspended user is suspended again', () => {
    const fields = started({
      isSuspended: true,
      avatarUrl: null,
      preSuspensionAvatarUrl: 'https://signin.example/a.png',
    });

    expect(fields.preSuspensionAvatarUrl).toBe('https://signin.example/a.png');
  });

  it('keeps the first saved profile when an already-suspended user is suspended again', () => {
    const fields = started({
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
    const fields = started({
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
    const fields = started({
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
    const fields = started({
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
    const first = started(user);
    first.displayName = 'changed by a caller';

    expect(started(user).displayName).toBe('Suspended Account');
  });
});

// SHY-0605: ending a suspension puts back every profile field it masked.
describe('profileToRestore', () => {
  it('restores the saved name', () => {
    expect(profileToRestore({ preSuspensionDisplayName: 'Ana' })).toStrictEqual({
      displayName: 'Ana',
    });
  });

  it('restores the saved uploaded photo', () => {
    expect(
      profileToRestore({ preSuspensionProfilePhotoUrl: 'https://img.example/p.png' }),
    ).toStrictEqual({
      profilePhotoUrl: 'https://img.example/p.png',
    });
  });

  it('restores the saved cover', () => {
    expect(
      profileToRestore({ preSuspensionCoverPhotoUrl: 'https://img.example/c.png' }),
    ).toStrictEqual({
      coverPhotoUrl: 'https://img.example/c.png',
    });
  });

  it('restores the saved bio', () => {
    expect(profileToRestore({ preSuspensionDescription: 'Hola, I teach Spanish' })).toStrictEqual({
      description: 'Hola, I teach Spanish',
    });
  });

  it('restores the saved sign-in photo', () => {
    expect(
      profileToRestore({ preSuspensionAvatarUrl: 'https://signin.example/a.png' }),
    ).toStrictEqual({
      avatarUrl: 'https://signin.example/a.png',
    });
  });

  it('reads a save stored in snake_case', () => {
    expect(
      profileToRestore({
        pre_suspension_display_name: 'Ana',
        pre_suspension_profile_photo_url: 'https://img.example/p.png',
        pre_suspension_cover_photo_url: 'https://img.example/c.png',
      }),
    ).toStrictEqual({
      displayName: 'Ana',
      profilePhotoUrl: 'https://img.example/p.png',
      coverPhotoUrl: 'https://img.example/c.png',
    });
  });

  it('restores nothing from a null save', () => {
    expect(
      profileToRestore({
        preSuspensionDisplayName: null,
        preSuspensionProfilePhotoUrl: null,
        preSuspensionCoverPhotoUrl: null,
        preSuspensionDescription: null,
        preSuspensionAvatarUrl: null,
      }),
    ).toStrictEqual({});
  });

  it('restores nothing for a user with no save at all', () => {
    expect(profileToRestore({ displayName: 'Suspended Account' })).toStrictEqual({});
  });
});

describe('suspensionEndedFields', () => {
  it('clears the saved bio', () => {
    expect(suspensionEndedFields().preSuspensionDescription).toBeNull();
  });

  it('clears the saved sign-in photo', () => {
    expect(suspensionEndedFields().preSuspensionAvatarUrl).toBeNull();
  });

  it('clears the run’s start', () => {
    expect(suspensionEndedFields().suspensionRunStartedAt).toBeNull();
  });

  it('lets the restored profile win over the cleared fields', () => {
    const fields = suspensionEndedFields({
      description: 'Hola',
      avatarUrl: 'https://signin.example/a.png',
    });

    expect(fields.isSuspended).toBe(false);
    expect(fields.description).toBe('Hola');
    expect(fields.avatarUrl).toBe('https://signin.example/a.png');
  });
});
