// SHY-0605: revoking a warning, stated once. The admin "revoke warning"
// route and every suspension ending share this helper.

const mockTxGet = jest.fn();
const mockTxUpdate = jest.fn();
const mockTxSet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({ _path: path })),
    runTransaction: jest.fn((fn) =>
      fn({
        get: (ref) => mockTxGet(ref._path),
        update: (ref, data) => mockTxUpdate(ref._path, data),
        set: (ref, data) => mockTxSet(ref._path, data),
      }),
    ),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'audit-1'),
  now: jest.fn(() => 1709913600000),
}));

const { db } = require('../../src/utils/firebase');
const { revokeWarning, WarningRevokeError } = require('../../src/utils/warnings');

const WARNING_PATH = 'users/10000001/warnings/warn-1';
const USER_PATH = 'users/10000001';

function stored(docs) {
  mockTxGet.mockImplementation(async (path) => {
    const data = docs[path];
    return { exists: data !== undefined, data: () => data };
  });
}

function userUpdate() {
  const call = mockTxUpdate.mock.calls.find(([path]) => path === USER_PATH);
  return call && call[1];
}

beforeEach(() => {
  mockTxGet.mockReset();
  mockTxUpdate.mockReset();
  mockTxSet.mockReset();
  db.runTransaction.mockClear();
});

describe('revokeWarning', () => {
  it('marks the warning revoked by the actor at the current time', async () => {
    stored({ [WARNING_PATH]: { gcsDeduction: 10 }, [USER_PATH]: { gcsScore: 80 } });

    await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(mockTxUpdate).toHaveBeenCalledWith(WARNING_PATH, {
      revoked: true,
      revokedAt: 1709913600000,
      revokedBy: 'admin-uid',
    });
  });

  it('gives the deduction back to the GCS', async () => {
    stored({ [WARNING_PATH]: { gcsDeduction: 10 }, [USER_PATH]: { gcsScore: 80 } });

    const result = await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(userUpdate().gcsScore).toBe(90);
    expect(result).toStrictEqual({
      alreadyRevoked: false,
      deduction: 10,
      previousGcs: 80,
      restoredGcs: 90,
    });
  });

  it('caps the GCS it gives back at 100', async () => {
    stored({ [WARNING_PATH]: { gcsDeduction: 25 }, [USER_PATH]: { gcsScore: 95 } });

    const result = await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(userUpdate().gcsScore).toBe(100);
    expect(result.restoredGcs).toBe(100);
  });

  it('reads the GCS inside the transaction that writes it', async () => {
    stored({ [WARNING_PATH]: { gcsDeduction: 10 }, [USER_PATH]: { gcsScore: 80 } });

    await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxGet).toHaveBeenCalledWith(USER_PATH);
  });

  it('reads a GCS stored in snake_case', async () => {
    stored({ [WARNING_PATH]: { gcsDeduction: 10 }, [USER_PATH]: { gcs_score: 60 } });

    await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(userUpdate().gcsScore).toBe(70);
  });

  it('treats a user with no GCS as 100', async () => {
    stored({ [WARNING_PATH]: { gcsDeduction: 10 }, [USER_PATH]: {} });

    await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(userUpdate().gcsScore).toBe(100);
  });

  it('gives nothing back for a warning with no deduction', async () => {
    stored({ [WARNING_PATH]: {}, [USER_PATH]: { gcsScore: 80 } });

    const result = await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(userUpdate().gcsScore).toBe(80);
    expect(result.deduction).toBe(0);
  });

  it('lowers the warning count for a report warning', async () => {
    stored({
      [WARNING_PATH]: { gcsDeduction: 10, source: 'report' },
      [USER_PATH]: { gcsScore: 80, warningCount: 2 },
    });

    await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(userUpdate().warningCount).toBe(1);
  });

  it('lowers the warning count for a warning with no source', async () => {
    stored({
      [WARNING_PATH]: { gcsDeduction: 10 },
      [USER_PATH]: { gcsScore: 80, warningCount: 2 },
    });

    await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(userUpdate().warningCount).toBe(1);
  });

  it('reads a warning count stored in snake_case', async () => {
    stored({
      [WARNING_PATH]: { gcsDeduction: 10 },
      [USER_PATH]: { gcsScore: 80, warning_count: 3 },
    });

    await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(userUpdate().warningCount).toBe(2);
  });

  it('never lowers the warning count below zero', async () => {
    stored({
      [WARNING_PATH]: { gcsDeduction: 10 },
      [USER_PATH]: { gcsScore: 80, warningCount: 0 },
    });

    await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(userUpdate().warningCount).toBe(0);
  });

  // A suspension warning never raised warningCount, so revoking it must not
  // lower the count by one it never gained.
  it('leaves the warning count alone for a suspension warning', async () => {
    stored({
      [WARNING_PATH]: { gcsDeduction: 100, source: 'suspension' },
      [USER_PATH]: { gcsScore: 0, warningCount: 2 },
    });

    await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(userUpdate()).toStrictEqual({ gcsScore: 100 });
  });

  it('writes nothing for a warning already revoked', async () => {
    stored({
      [WARNING_PATH]: { gcsDeduction: 10, revoked: true },
      [USER_PATH]: { gcsScore: 80 },
    });

    const result = await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(result).toStrictEqual({ alreadyRevoked: true });
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it('refuses a warning that does not exist, writing nothing', async () => {
    stored({ [USER_PATH]: { gcsScore: 80 } });

    const err = await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' }).catch((e) => e);

    expect(err).toBeInstanceOf(WarningRevokeError);
    expect(err.code).toBe('warning-not-found');
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it('refuses a user who does not exist, writing nothing', async () => {
    stored({ [WARNING_PATH]: { gcsDeduction: 10 } });

    const err = await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' }).catch((e) => e);

    expect(err).toBeInstanceOf(WarningRevokeError);
    expect(err.code).toBe('user-not-found');
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it('writes the revoke audit entry in the same transaction when asked', async () => {
    stored({ [WARNING_PATH]: { gcsDeduction: 10 }, [USER_PATH]: { gcsScore: 80 } });

    await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid', audit: true });

    expect(mockTxSet).toHaveBeenCalledWith('adminAuditLog/audit-1', {
      adminId: 'admin-uid',
      action: 'REVOKE_WARNING',
      targetUserId: '10000001',
      details: 'Revoked warning warn-1, restored 10 GCS (80 → 90)',
      createdAt: 1709913600000,
    });
  });

  it('writes no audit entry unless asked', async () => {
    stored({ [WARNING_PATH]: { gcsDeduction: 10 }, [USER_PATH]: { gcsScore: 80 } });

    await revokeWarning('10000001', 'warn-1', { actor: 'admin-uid' });

    expect(mockTxSet).not.toHaveBeenCalled();
  });
});
