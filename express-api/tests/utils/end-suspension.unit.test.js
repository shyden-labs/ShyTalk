// SHY-0605: ending a suspension, stated once. Every end path calls this, so
// each puts back the same things: the profile, the suspension warning's GCS,
// the auto-applied bans and the flagged suggestions.

const mockUserGet = jest.fn();
const mockWarningsGet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchSet = jest.fn();
const mockCommit = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({ _path: path, get: () => mockUserGet(path) })),
    collection: jest.fn((path) => {
      const filters = [];
      const chain = {
        where: (field, op, value) => {
          filters.push([field, op, value]);
          return chain;
        },
        get: () => mockWarningsGet(path, filters),
      };
      return chain;
    }),
    batch: jest.fn(() => ({
      update: (ref, data) => mockBatchUpdate(ref._path, data),
      set: (ref, data) => mockBatchSet(ref._path, data),
      commit: () => mockCommit(),
    })),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'audit-1'),
  now: jest.fn(() => 1709913600000),
}));
jest.mock('../../src/utils/warnings', () => ({ revokeWarning: jest.fn() }));
jest.mock('../../src/utils/auto-bans', () => ({ liftAutoAppliedBans: jest.fn() }));
jest.mock('../../src/utils/flag-suspended-user-suggestions', () => ({
  unflagUnsuspendedUserSuggestions: jest.fn(),
}));
jest.mock('../../src/middleware/auth', () => ({ clearSuspensionCache: jest.fn() }));
jest.mock('../../src/utils/log', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { revokeWarning } = require('../../src/utils/warnings');
const { liftAutoAppliedBans } = require('../../src/utils/auto-bans');
const {
  unflagUnsuspendedUserSuggestions,
} = require('../../src/utils/flag-suspended-user-suggestions');
const { clearSuspensionCache } = require('../../src/middleware/auth');
const {
  endSuspension,
  SuspensionEndError,
  suspensionEndFailure,
} = require('../../src/utils/end-suspension');

const USER_PATH = 'users/10000001';
const WARNINGS_PATH = 'users/10000001/warnings';
const OPTIONS = { actor: 'admin-uid', trigger: 'UNSUSPEND' };
// Only an upheld appeal gives the GCS back (Shyden, 2026-10-17).
const APPEAL = { actor: 'admin-uid', trigger: 'APPEAL_APPROVED', restoreGcs: true };
const RUN_START = 1709000000000;

const SUSPENDED = {
  isSuspended: true,
  suspensionStartDate: 1709000000000,
  suspensionRunStartedAt: RUN_START,
  displayName: 'Suspended Account',
  preSuspensionDisplayName: 'Ana',
  preSuspensionProfilePhotoUrl: 'https://cdn.example/photo.jpg',
  preSuspensionCoverPhotoUrl: 'https://cdn.example/cover.jpg',
  preSuspensionDescription: 'I teach Portuguese',
  preSuspensionAvatarUrl: 'https://lh3.googleusercontent.com/a/ana',
};

const NOTHING_FLAGGED = {
  unflaggedCount: 0,
  skippedCount: 0,
  partial: false,
  failedSuggestionIds: [],
  error: null,
};

function storedUser(data) {
  mockUserGet.mockResolvedValue({ exists: data !== undefined, data: () => data });
}

/** The user's `source: 'suspension'` warnings, as the query returns them. */
function storedWarnings(...warnings) {
  mockWarningsGet.mockResolvedValue({
    docs: warnings.map(({ id, ...data }) => ({ id, data: () => data })),
  });
}

function revokes(...results) {
  for (const result of results) revokeWarning.mockResolvedValueOnce(result);
}

function userUpdate() {
  const call = mockBatchUpdate.mock.calls.find(([path]) => path === USER_PATH);
  return call && call[1];
}

beforeEach(() => {
  mockUserGet.mockReset();
  mockWarningsGet.mockReset();
  mockBatchUpdate.mockReset();
  mockBatchSet.mockReset();
  mockCommit.mockReset().mockResolvedValue();
  revokeWarning.mockReset();
  liftAutoAppliedBans.mockReset().mockResolvedValue(0);
  unflagUnsuspendedUserSuggestions.mockReset().mockResolvedValue(NOTHING_FLAGGED);
  clearSuspensionCache.mockReset();
  storedUser(SUSPENDED);
  storedWarnings();
});

describe('endSuspension: who it ends', () => {
  it('does nothing for a user who is not suspended', async () => {
    storedUser({ isSuspended: false, preSuspensionDisplayName: 'Ana' });

    const result = await endSuspension('10000001', OPTIONS);

    expect(result).toStrictEqual({ alreadyEnded: true });
    expect(mockWarningsGet).not.toHaveBeenCalled();
    expect(liftAutoAppliedBans).not.toHaveBeenCalled();
    expect(unflagUnsuspendedUserSuggestions).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
    expect(clearSuspensionCache).not.toHaveBeenCalled();
  });

  it('does nothing for a user who does not exist, creating no document', async () => {
    storedUser(undefined);

    const result = await endSuspension('10000001', OPTIONS);

    expect(result).toStrictEqual({ alreadyEnded: true });
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('ends a suspension stored in snake_case', async () => {
    storedUser({ is_suspended: true });

    const result = await endSuspension('10000001', OPTIONS);

    expect(result.alreadyEnded).toBe(false);
    expect(userUpdate().isSuspended).toBe(false);
  });

  it('refuses a call that names no actor, reading nothing', async () => {
    await expect(endSuspension('10000001', { trigger: 'UNSUSPEND' })).rejects.toThrow(TypeError);
    expect(mockUserGet).not.toHaveBeenCalled();
  });

  it('refuses a call that names no trigger, reading nothing', async () => {
    await expect(endSuspension('10000001', { actor: 'admin-uid' })).rejects.toThrow(TypeError);
    expect(mockUserGet).not.toHaveBeenCalled();
  });
});

describe('endSuspension: the profile', () => {
  it('puts the display name back', async () => {
    await endSuspension('10000001', OPTIONS);

    expect(userUpdate().displayName).toBe('Ana');
  });

  it('puts the uploaded photo back', async () => {
    await endSuspension('10000001', OPTIONS);

    expect(userUpdate().profilePhotoUrl).toBe('https://cdn.example/photo.jpg');
  });

  it('puts the cover photo back', async () => {
    await endSuspension('10000001', OPTIONS);

    expect(userUpdate().coverPhotoUrl).toBe('https://cdn.example/cover.jpg');
  });

  it('puts the bio back', async () => {
    await endSuspension('10000001', OPTIONS);

    expect(userUpdate().description).toBe('I teach Portuguese');
  });

  it('puts the sign-in photo back', async () => {
    await endSuspension('10000001', OPTIONS);

    expect(userUpdate().avatarUrl).toBe('https://lh3.googleusercontent.com/a/ana');
  });

  it('leaves a field with no save as it is', async () => {
    storedUser({ isSuspended: true, preSuspensionDisplayName: 'Ana' });

    await endSuspension('10000001', OPTIONS);

    expect(userUpdate()).not.toHaveProperty('description');
    expect(userUpdate()).not.toHaveProperty('avatarUrl');
  });

  it('clears every suspension field and every save', async () => {
    await endSuspension('10000001', OPTIONS);

    expect(userUpdate()).toMatchObject({
      isSuspended: false,
      suspensionReason: null,
      suspensionStartDate: null,
      suspensionEndDate: null,
      suspensionAppealStatus: null,
      suspendedBy: null,
      preSuspensionDisplayName: null,
      preSuspensionProfilePhotoUrl: null,
      preSuspensionCoverPhotoUrl: null,
      preSuspensionDescription: null,
      preSuspensionAvatarUrl: null,
    });
  });

  it('writes the caller’s extra fields over the clear', async () => {
    await endSuspension('10000001', { ...OPTIONS, extra: { suspensionCanAppeal: true } });

    expect(userUpdate().suspensionCanAppeal).toBe(true);
  });

  it('writes neither the GCS nor the warning count on the user', async () => {
    storedWarnings({ id: 'warn-1', source: 'suspension', revoked: false, createdAt: RUN_START });
    revokes({ alreadyRevoked: false, deduction: 80, previousGcs: 0, restoredGcs: 80 });

    await endSuspension('10000001', APPEAL);

    expect(userUpdate()).not.toHaveProperty('gcsScore');
    expect(userUpdate()).not.toHaveProperty('warningCount');
  });
});

describe('endSuspension: the suspension warning', () => {
  it('asks only for suspension warnings, filtering nothing else in the query', async () => {
    await endSuspension('10000001', APPEAL);

    expect(mockWarningsGet).toHaveBeenCalledWith(WARNINGS_PATH, [['source', '==', 'suspension']]);
  });

  it('reads and revokes no warning when the ending is not an upheld appeal', async () => {
    storedWarnings({ id: 'warn-1', source: 'suspension', revoked: false, createdAt: RUN_START });

    const result = await endSuspension('10000001', OPTIONS);

    expect(mockWarningsGet).not.toHaveBeenCalled();
    expect(revokeWarning).not.toHaveBeenCalled();
    expect(result.revokedWarnings).toBe(0);
    expect(result.gcsRestored).toBe(0);
  });

  it('revokes a warning made at the run’s first moment', async () => {
    storedWarnings({ id: 'warn-1', source: 'suspension', revoked: false, createdAt: RUN_START });
    revokes({ alreadyRevoked: false, deduction: 80, previousGcs: 0, restoredGcs: 80 });

    await endSuspension('10000001', APPEAL);

    expect(revokeWarning).toHaveBeenCalledWith('10000001', 'warn-1', { actor: 'admin-uid' });
  });

  it('leaves a warning from an earlier suspension, ended without an appeal', async () => {
    storedWarnings({
      id: 'warn-old',
      source: 'suspension',
      revoked: false,
      createdAt: RUN_START - 1,
    });

    await endSuspension('10000001', APPEAL);

    expect(revokeWarning).not.toHaveBeenCalled();
  });

  it('starts the run at the suspension start for a user with no recorded run start', async () => {
    storedUser({ isSuspended: true, suspensionStartDate: 1709500000000 });
    storedWarnings(
      { id: 'warn-a', source: 'suspension', revoked: false, createdAt: 1709499999999 },
      { id: 'warn-b', source: 'suspension', revoked: false, createdAt: 1709500000000 },
    );
    revokes({ alreadyRevoked: false, deduction: 30, previousGcs: 50, restoredGcs: 80 });

    await endSuspension('10000001', APPEAL);

    expect(revokeWarning.mock.calls.map(([, id]) => id)).toStrictEqual(['warn-b']);
  });

  it('revokes nothing when the run’s start is not known', async () => {
    storedUser({ isSuspended: true });
    storedWarnings({ id: 'warn-1', source: 'suspension', revoked: false, createdAt: RUN_START });

    const result = await endSuspension('10000001', APPEAL);

    expect(revokeWarning).not.toHaveBeenCalled();
    expect(result.gcsRestored).toBe(0);
  });

  it('revokes the suspension warning as the actor', async () => {
    storedWarnings({ id: 'warn-1', source: 'suspension', revoked: false, createdAt: RUN_START });
    revokes({ alreadyRevoked: false, deduction: 80, previousGcs: 0, restoredGcs: 80 });

    await endSuspension('10000001', APPEAL);

    expect(revokeWarning).toHaveBeenCalledTimes(1);
    expect(revokeWarning).toHaveBeenCalledWith('10000001', 'warn-1', { actor: 'admin-uid' });
  });

  it('revokes a stored warning that has no revoked field', async () => {
    storedWarnings({ id: 'warn-1', source: 'suspension', createdAt: RUN_START });
    revokes({ alreadyRevoked: false, deduction: 80, previousGcs: 0, restoredGcs: 80 });

    await endSuspension('10000001', APPEAL);

    expect(revokeWarning).toHaveBeenCalledWith('10000001', 'warn-1', { actor: 'admin-uid' });
  });

  it('skips a warning an admin already revoked by hand', async () => {
    storedWarnings({ id: 'warn-1', source: 'suspension', revoked: true, createdAt: RUN_START });

    await endSuspension('10000001', APPEAL);

    expect(revokeWarning).not.toHaveBeenCalled();
  });

  it('revokes every warning of a re-suspension, the first one included', async () => {
    // Suspended at GCS 80 (warning A takes 80), suspended again at GCS 0
    // (warning B takes 0). The second suspend moved the start date to B's.
    storedUser({ ...SUSPENDED, suspensionStartDate: 1709500000000 });
    storedWarnings(
      { id: 'warn-a', source: 'suspension', revoked: false, createdAt: 1709000000000 },
      { id: 'warn-b', source: 'suspension', revoked: false, createdAt: 1709500000000 },
    );
    revokes(
      { alreadyRevoked: false, deduction: 80, previousGcs: 0, restoredGcs: 80 },
      { alreadyRevoked: false, deduction: 0, previousGcs: 80, restoredGcs: 80 },
    );

    const result = await endSuspension('10000001', APPEAL);

    expect(revokeWarning.mock.calls.map(([, id]) => id)).toStrictEqual(['warn-a', 'warn-b']);
    expect(result.gcsRestored).toBe(80);
  });

  it('revokes one warning at a time, each after the last has written', async () => {
    storedWarnings(
      { id: 'warn-a', source: 'suspension', revoked: false, createdAt: RUN_START },
      { id: 'warn-b', source: 'suspension', revoked: false, createdAt: RUN_START },
    );
    let releaseFirst;
    revokeWarning.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () =>
            resolve({ alreadyRevoked: false, deduction: 80, previousGcs: 0, restoredGcs: 80 });
        }),
    );
    revokes({ alreadyRevoked: false, deduction: 0, previousGcs: 80, restoredGcs: 80 });

    const ending = endSuspension('10000001', APPEAL);
    await new Promise((resolve) => setImmediate(resolve));
    expect(revokeWarning).toHaveBeenCalledTimes(1);

    releaseFirst();
    await ending;
    expect(revokeWarning).toHaveBeenCalledTimes(2);
  });

  it('does not count a warning revoked by hand while the ending ran', async () => {
    storedWarnings({ id: 'warn-1', source: 'suspension', revoked: false, createdAt: RUN_START });
    revokes({ alreadyRevoked: true });

    const result = await endSuspension('10000001', APPEAL);

    expect(result.revokedWarnings).toBe(0);
    expect(result.gcsRestored).toBe(0);
  });
});

// An appeal records the run it answers (`suspensionRunStartedAt` on the
// appeal). Upheld, it gives back that run's GCS and no other's, even when the
// suspension has already ended: a timed suspension can run out while its
// appeal waits, and the ending clears the run start from the user.
describe('endSuspension: the suspension an upheld appeal answers', () => {
  const LATER_RUN = RUN_START + 5000000;

  it('gives back the GCS of an appealed suspension that already ended, ending nothing', async () => {
    storedUser({ isSuspended: false, gcsScore: 0 });
    storedWarnings({
      id: 'warn-1',
      source: 'suspension',
      revoked: false,
      createdAt: RUN_START,
      suspensionRunStartedAt: RUN_START,
    });
    revokes({ alreadyRevoked: false, deduction: 80, previousGcs: 0, restoredGcs: 80 });

    const result = await endSuspension('10000001', { ...APPEAL, appealedRunStartedAt: RUN_START });

    expect(revokeWarning).toHaveBeenCalledWith('10000001', 'warn-1', { actor: 'admin-uid' });
    expect(result).toStrictEqual({ alreadyEnded: true, revokedWarnings: 1, gcsRestored: 80 });
    expect(liftAutoAppliedBans).not.toHaveBeenCalled();
    expect(unflagUnsuspendedUserSuggestions).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
    expect(clearSuspensionCache).not.toHaveBeenCalled();
  });

  it('gives back nothing for an ended suspension when the appeal named none', async () => {
    // A start date an older ending left behind is not a run in force.
    storedUser({ isSuspended: false, suspensionStartDate: RUN_START });
    storedWarnings({
      id: 'warn-1',
      source: 'suspension',
      revoked: false,
      createdAt: RUN_START,
      suspensionRunStartedAt: RUN_START,
    });

    const result = await endSuspension('10000001', { ...APPEAL, appealedRunStartedAt: null });

    expect(mockWarningsGet).not.toHaveBeenCalled();
    expect(result).toStrictEqual({ alreadyEnded: true, revokedWarnings: 0, gcsRestored: 0 });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('gives back only the appealed suspension’s warnings, not a later one’s', async () => {
    storedUser({ ...SUSPENDED, suspensionRunStartedAt: LATER_RUN });
    storedWarnings(
      {
        id: 'warn-appealed',
        source: 'suspension',
        revoked: false,
        createdAt: RUN_START,
        suspensionRunStartedAt: RUN_START,
      },
      {
        id: 'warn-later',
        source: 'suspension',
        revoked: false,
        createdAt: LATER_RUN,
        suspensionRunStartedAt: LATER_RUN,
      },
    );
    revokes({ alreadyRevoked: false, deduction: 80, previousGcs: 0, restoredGcs: 80 });

    await endSuspension('10000001', { ...APPEAL, appealedRunStartedAt: RUN_START });

    expect(revokeWarning.mock.calls.map(([, id]) => id)).toStrictEqual(['warn-appealed']);
  });

  it('gives back the run in force when the appeal named none', async () => {
    storedWarnings({ id: 'warn-1', source: 'suspension', revoked: false, createdAt: RUN_START });
    revokes({ alreadyRevoked: false, deduction: 80, previousGcs: 0, restoredGcs: 80 });

    await endSuspension('10000001', { ...APPEAL, appealedRunStartedAt: null });

    expect(revokeWarning.mock.calls.map(([, id]) => id)).toStrictEqual(['warn-1']);
  });

  it('does nothing for a user with no document, appeal or not', async () => {
    storedUser(undefined);

    const result = await endSuspension('10000001', { ...APPEAL, appealedRunStartedAt: RUN_START });

    expect(result).toStrictEqual({ alreadyEnded: true });
    expect(mockWarningsGet).not.toHaveBeenCalled();
  });
});

describe('endSuspension: bans and suggestions', () => {
  it('lifts the auto-applied bans as the actor', async () => {
    await endSuspension('10000001', OPTIONS);

    expect(liftAutoAppliedBans).toHaveBeenCalledWith('10000001', 'admin-uid');
  });

  it('writes the user only after the bans are lifted', async () => {
    await endSuspension('10000001', OPTIONS);

    expect(liftAutoAppliedBans.mock.invocationCallOrder[0]).toBeLessThan(
      mockCommit.mock.invocationCallOrder[0],
    );
  });

  it('unflags the suggestions the suspension flagged', async () => {
    await endSuspension('10000001', OPTIONS);

    expect(unflagUnsuspendedUserSuggestions).toHaveBeenCalledWith('10000001');
  });

  it('writes the user only after the suggestions are unflagged', async () => {
    await endSuspension('10000001', OPTIONS);

    expect(unflagUnsuspendedUserSuggestions.mock.invocationCallOrder[0]).toBeLessThan(
      mockCommit.mock.invocationCallOrder[0],
    );
  });
});

describe('endSuspension: a step that fails leaves the user suspended', () => {
  it('fails at the warnings step when a revoke fails, writing nothing more', async () => {
    storedWarnings({ id: 'warn-1', source: 'suspension', revoked: false, createdAt: RUN_START });
    revokeWarning.mockRejectedValueOnce(new Error('contention'));

    const ending = endSuspension('10000001', APPEAL);

    await expect(ending).rejects.toBeInstanceOf(SuspensionEndError);
    await expect(ending).rejects.toMatchObject({ step: 'warnings', message: 'contention' });
    expect(liftAutoAppliedBans).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('fails at the bans step when lifting fails, writing nothing more', async () => {
    liftAutoAppliedBans.mockRejectedValueOnce(new Error('delete failed'));

    const ending = endSuspension('10000001', OPTIONS);

    await expect(ending).rejects.toMatchObject({ step: 'bans', message: 'delete failed' });
    expect(unflagUnsuspendedUserSuggestions).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('fails at the suggestions step when unflagging throws, not writing the user', async () => {
    unflagUnsuspendedUserSuggestions.mockRejectedValueOnce(new Error('query failed'));

    await expect(endSuspension('10000001', OPTIONS)).rejects.toMatchObject({
      step: 'suggestions',
      message: 'query failed',
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('fails at the suggestions step when some stay flagged, not writing the user', async () => {
    unflagUnsuspendedUserSuggestions.mockResolvedValueOnce({
      unflaggedCount: 3,
      skippedCount: 0,
      partial: true,
      failedSuggestionIds: ['s-4'],
      error: 'batch commit failed',
    });

    await expect(endSuspension('10000001', OPTIONS)).rejects.toMatchObject({
      step: 'suggestions',
      message: 'batch commit failed',
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('fails at the user step when the write fails, leaving the cache', async () => {
    mockCommit.mockRejectedValueOnce(new Error('unavailable'));

    await expect(endSuspension('10000001', OPTIONS)).rejects.toMatchObject({
      step: 'user',
      message: 'unavailable',
    });
    expect(clearSuspensionCache).not.toHaveBeenCalled();
  });
});

describe('endSuspension: the record', () => {
  it('writes the user and the audit entry in one batch', async () => {
    await endSuspension('10000001', OPTIONS);

    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it('writes the audit entry in the shape the audit log page reads', async () => {
    storedWarnings({ id: 'warn-1', source: 'suspension', revoked: false, createdAt: RUN_START });
    revokes({ alreadyRevoked: false, deduction: 80, previousGcs: 0, restoredGcs: 80 });
    liftAutoAppliedBans.mockResolvedValueOnce(2);
    unflagUnsuspendedUserSuggestions.mockResolvedValueOnce({
      ...NOTHING_FLAGGED,
      unflaggedCount: 4,
    });

    await endSuspension('10000001', APPEAL);

    expect(mockBatchSet).toHaveBeenCalledWith('adminAuditLog/audit-1', {
      adminUid: 'admin-uid',
      action: 'END_SUSPENSION',
      actionType: 'end_suspension',
      targetType: 'user',
      targetId: '10000001',
      details: {
        trigger: 'APPEAL_APPROVED',
        restored: ['displayName', 'profilePhotoUrl', 'coverPhotoUrl', 'description', 'avatarUrl'],
        revokedWarnings: 1,
        gcsRestored: 80,
        bansLifted: 2,
        unflagged: 4,
      },
      timestamp: 1709913600000,
    });
  });

  it('clears the suspension cache by the numeric id after the write', async () => {
    await endSuspension('10000001', OPTIONS);

    expect(clearSuspensionCache).toHaveBeenCalledWith(10000001);
    expect(mockCommit.mock.invocationCallOrder[0]).toBeLessThan(
      clearSuspensionCache.mock.invocationCallOrder[0],
    );
  });

  it('answers what it put back', async () => {
    storedWarnings({ id: 'warn-1', source: 'suspension', revoked: false, createdAt: RUN_START });
    revokes({ alreadyRevoked: false, deduction: 80, previousGcs: 0, restoredGcs: 80 });
    liftAutoAppliedBans.mockResolvedValueOnce(2);

    const result = await endSuspension('10000001', APPEAL);

    expect(result).toStrictEqual({
      alreadyEnded: false,
      restored: ['displayName', 'profilePhotoUrl', 'coverPhotoUrl', 'description', 'avatarUrl'],
      revokedWarnings: 1,
      gcsRestored: 80,
      bansLifted: 2,
      suggestions: NOTHING_FLAGGED,
    });
  });
});

describe('suspensionEndFailure', () => {
  it('answers a failed step with the step named and the user still suspended', () => {
    const body = suspensionEndFailure(new SuspensionEndError('bans', 'delete failed'));

    expect(body).toStrictEqual({
      error: 'The suspension could not be fully ended. The user is still suspended.',
      step: 'bans',
    });
  });

  it('answers anything else as null, for the route’s own handling', () => {
    expect(suspensionEndFailure(new Error('boom'))).toBeNull();
  });
});
