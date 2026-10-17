// SHY-0605: an appeal names the suspension it answers. An upheld appeal gives
// back the GCS that suspension took, and no other's (Shyden, 2026-10-17), even
// when the suspension has ended by the time a moderator upholds it. The ending
// clears the user's suspension fields, so the appeal keeps the run start itself.

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      set: (data, options) => mockSet(path, data, options),
      update: (data) => mockUpdate(path, data),
    })),
  },
}));
jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'appeal-1'),
  now: jest.fn(() => 1709913600000),
}));
jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: (path) => mockGet(path),
  queryDocs: jest.fn(),
}));

const { createAppeal } = require('../../src/utils/appeals');

const APPEAL_PATH = 'suspensionAppeals/appeal-1';

/** The user as `getDoc` returns it: the data, or null for no document. */
function storedUser(data) {
  mockGet.mockResolvedValue(data === undefined ? null : data);
}

function appealWritten() {
  const call = mockSet.mock.calls.find(([path]) => path === APPEAL_PATH);
  return call && call[1];
}

beforeEach(() => {
  mockGet.mockReset();
  mockSet.mockReset().mockResolvedValue();
  mockUpdate.mockReset().mockResolvedValue();
});

describe('createAppeal: the suspension it answers', () => {
  it('records the run of suspensions in force', async () => {
    storedUser({
      isSuspended: true,
      suspensionStartDate: 1709500000000,
      suspensionRunStartedAt: 1709000000000,
    });

    await createAppeal({ uniqueId: '10000001', appealText: 'A mistake.' });

    expect(mockGet).toHaveBeenCalledWith('users/10000001');
    expect(appealWritten()).toMatchObject({ suspensionRunStartedAt: 1709000000000 });
  });

  it('records the suspension start for a user with no recorded run start', async () => {
    storedUser({ isSuspended: true, suspensionStartDate: 1709500000000 });

    await createAppeal({ uniqueId: '10000001', appealText: 'A mistake.' });

    expect(appealWritten()).toMatchObject({ suspensionRunStartedAt: 1709500000000 });
  });

  it('records a suspension stored in snake_case', async () => {
    storedUser({ is_suspended: true, suspensionRunStartedAt: 1709000000000 });

    await createAppeal({ uniqueId: '10000001', appealText: 'A mistake.' });

    expect(appealWritten()).toMatchObject({ suspensionRunStartedAt: 1709000000000 });
  });

  it('records no suspension for a user who is not suspended', async () => {
    storedUser({ isSuspended: false, suspensionRunStartedAt: 1709000000000 });

    await createAppeal({ uniqueId: '10000001', appealText: 'A mistake.' });

    expect(appealWritten()).toMatchObject({ suspensionRunStartedAt: null });
  });

  it('records no suspension for a user with no document', async () => {
    storedUser(undefined);

    await createAppeal({ uniqueId: '10000001', appealText: 'A mistake.' });

    expect(appealWritten()).toMatchObject({ suspensionRunStartedAt: null });
  });

  it('still writes the appeal in its one schema', async () => {
    storedUser({ isSuspended: true, suspensionRunStartedAt: 1709000000000 });

    const id = await createAppeal({ uniqueId: '10000001', appealText: 'A mistake.' });

    expect(id).toBe('appeal-1');
    expect(mockSet).toHaveBeenCalledWith(
      APPEAL_PATH,
      {
        userId: 10000001,
        appealText: 'A mistake.',
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        createdAt: 1709913600000,
        suspensionRunStartedAt: 1709000000000,
      },
      { merge: true },
    );
    expect(mockUpdate).toHaveBeenCalledWith('users/10000001', {
      suspensionAppealStatus: 'pending',
    });
  });
});
