// SHY-0605: an appeal belongs to the one suspension it answers, and never
// reaches another (Shyden, 2026-10-18: "appeals must be tied to the exact
// suspension that was given and cannot be allowed to leak into a different
// suspension/appeal"). A timed suspension can run out while its appeal waits
// and a new one can follow, so the appeal records its run itself: the ending
// clears the run start from the user.

const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockQueryDocs = jest.fn();
const mockFilters = [];

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      set: (data, options) => mockSet(path, data, options),
      update: (data) => mockUpdate(path, data),
    })),
    collection: jest.fn(() => {
      const chain = {
        where: (field, op, value) => {
          mockFilters.push([field, op, value]);
          return chain;
        },
      };
      return chain;
    }),
  },
}));
jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'appeal-1'),
  now: jest.fn(() => 1709913600000),
}));
jest.mock('../../src/utils/firestore-helpers', () => ({
  queryDocs: (query) => mockQueryDocs(query),
}));

const {
  appealedSuspension,
  appealRefusal,
  findPendingAppeal,
  createAppeal,
} = require('../../src/utils/appeals');

const APPEAL_PATH = 'suspensionAppeals/appeal-1';
const RUN = 1709000000000;
const LATER_RUN = 1709500000000;
const IN_RUN = { isSuspended: true, suspensionCanAppeal: true, suspensionRunStartedAt: RUN };

function appealWritten() {
  const call = mockSet.mock.calls.find(([path]) => path === APPEAL_PATH);
  return call && call[1];
}

beforeEach(() => {
  mockSet.mockReset().mockResolvedValue();
  mockUpdate.mockReset().mockResolvedValue();
  mockQueryDocs.mockReset().mockResolvedValue([]);
  mockFilters.length = 0;
});

describe('appealedSuspension: the suspension an appeal answers', () => {
  it('answers the run it recorded, the one in force', () => {
    expect(appealedSuspension(IN_RUN, { suspensionRunStartedAt: RUN })).toStrictEqual({
      runStartedAt: RUN,
      inForce: true,
    });
  });

  it('answers the run it recorded, not a later one in force', () => {
    const user = { ...IN_RUN, suspensionRunStartedAt: LATER_RUN };

    expect(appealedSuspension(user, { suspensionRunStartedAt: RUN })).toStrictEqual({
      runStartedAt: RUN,
      inForce: false,
    });
  });

  it('answers the run it recorded when no suspension is in force', () => {
    expect(
      appealedSuspension({ isSuspended: false }, { suspensionRunStartedAt: RUN }),
    ).toStrictEqual({ runStartedAt: RUN, inForce: false });
  });

  it('answers the run it recorded for a user with no document', () => {
    expect(appealedSuspension(null, { suspensionRunStartedAt: RUN })).toStrictEqual({
      runStartedAt: RUN,
      inForce: false,
    });
  });

  it('reads the run in force from the start date when no run start is recorded', () => {
    const user = { isSuspended: true, suspensionStartDate: RUN };

    expect(appealedSuspension(user, { suspensionRunStartedAt: RUN }).inForce).toBe(true);
  });

  it('reads a suspension stored in snake_case', () => {
    const user = { is_suspended: true, suspensionRunStartedAt: RUN };

    expect(appealedSuspension(user, { suspensionRunStartedAt: RUN }).inForce).toBe(true);
  });

  it('does not answer a suspension whose start is unknown when it recorded a run', () => {
    expect(
      appealedSuspension({ isSuspended: true }, { suspensionRunStartedAt: RUN }),
    ).toStrictEqual({ runStartedAt: RUN, inForce: false });
  });

  // Appeals made before an appeal recorded its run: placed by when it was made.
  it('places an older appeal made during the run in force in that run', () => {
    expect(appealedSuspension(IN_RUN, { createdAt: RUN })).toStrictEqual({
      runStartedAt: RUN,
      inForce: true,
    });
  });

  it('places an older appeal made before the run in force in no known run', () => {
    expect(appealedSuspension(IN_RUN, { createdAt: RUN - 1 })).toStrictEqual({
      runStartedAt: null,
      inForce: false,
    });
  });

  it('places an older appeal with no date in no known run', () => {
    expect(appealedSuspension(IN_RUN, {})).toStrictEqual({ runStartedAt: null, inForce: false });
  });

  it('places an older appeal in no known run when no suspension is in force', () => {
    expect(appealedSuspension({ isSuspended: false }, { createdAt: RUN })).toStrictEqual({
      runStartedAt: null,
      inForce: false,
    });
  });

  it('places an older appeal in the run in force when that run’s start is unknown', () => {
    expect(appealedSuspension({ isSuspended: true }, { createdAt: RUN })).toStrictEqual({
      runStartedAt: null,
      inForce: true,
    });
  });
});

describe('appealRefusal: who may appeal', () => {
  it('admits a suspended user whose suspension can be appealed', () => {
    expect(appealRefusal(IN_RUN)).toBeNull();
  });

  it('admits one stored in snake_case', () => {
    expect(appealRefusal({ is_suspended: true, suspension_can_appeal: true })).toBeNull();
  });

  it('refuses a user who is not suspended, 400', () => {
    expect(appealRefusal({ isSuspended: false, suspensionCanAppeal: true })).toStrictEqual({
      status: 400,
      error: 'User is not suspended',
    });
  });

  it('refuses a user with no document, 400', () => {
    expect(appealRefusal(null)).toStrictEqual({ status: 400, error: 'User is not suspended' });
  });

  it('refuses a suspension that cannot be appealed, 403', () => {
    expect(appealRefusal({ ...IN_RUN, suspensionCanAppeal: false })).toStrictEqual({
      status: 403,
      error: 'Appeals are not allowed for this suspension',
    });
  });

  it('refuses a suspension that does not say it can be appealed, 403', () => {
    const { suspensionCanAppeal, ...silent } = IN_RUN;

    expect(suspensionCanAppeal).toBe(true);
    expect(appealRefusal(silent)).toStrictEqual({
      status: 403,
      error: 'Appeals are not allowed for this suspension',
    });
  });
});

describe('findPendingAppeal: only the suspension in force', () => {
  it('asks for this owner’s pending appeals, by the numeric id', async () => {
    await findPendingAppeal('10000001', IN_RUN);

    expect(mockFilters).toStrictEqual([
      ['userId', '==', 10000001],
      ['status', '==', 'pending'],
    ]);
  });

  it('finds a pending appeal of the run in force', async () => {
    const appeal = { id: 'a1', suspensionRunStartedAt: RUN };
    mockQueryDocs.mockResolvedValue([appeal]);

    expect(await findPendingAppeal('10000001', IN_RUN)).toBe(appeal);
  });

  it('passes over a pending appeal of an earlier run', async () => {
    mockQueryDocs.mockResolvedValue([{ id: 'old', suspensionRunStartedAt: RUN - 1 }]);

    expect(await findPendingAppeal('10000001', IN_RUN)).toBeNull();
  });

  it('finds the run in force’s appeal behind an earlier run’s', async () => {
    const appeal = { id: 'now', suspensionRunStartedAt: RUN };
    mockQueryDocs.mockResolvedValue([{ id: 'old', suspensionRunStartedAt: RUN - 1 }, appeal]);

    expect(await findPendingAppeal('10000001', IN_RUN)).toBe(appeal);
  });
});

describe('createAppeal: the suspension it answers', () => {
  it('records the run of suspensions in force', async () => {
    await createAppeal({
      uniqueId: '10000001',
      appealText: 'A mistake.',
      user: { ...IN_RUN, suspensionStartDate: LATER_RUN },
    });

    expect(appealWritten()).toMatchObject({ suspensionRunStartedAt: RUN });
  });

  it('records the suspension start for a user with no recorded run start', async () => {
    await createAppeal({
      uniqueId: '10000001',
      appealText: 'A mistake.',
      user: { isSuspended: true, suspensionStartDate: LATER_RUN },
    });

    expect(appealWritten()).toMatchObject({ suspensionRunStartedAt: LATER_RUN });
  });

  it('records a suspension stored in snake_case', async () => {
    await createAppeal({
      uniqueId: '10000001',
      appealText: 'A mistake.',
      user: { is_suspended: true, suspensionRunStartedAt: RUN },
    });

    expect(appealWritten()).toMatchObject({ suspensionRunStartedAt: RUN });
  });

  it('writes the appeal in its one schema and marks the user', async () => {
    const id = await createAppeal({ uniqueId: '10000001', appealText: 'A mistake.', user: IN_RUN });

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
        suspensionRunStartedAt: RUN,
      },
      { merge: true },
    );
    expect(mockUpdate).toHaveBeenCalledWith('users/10000001', {
      suspensionAppealStatus: 'pending',
    });
  });
});
