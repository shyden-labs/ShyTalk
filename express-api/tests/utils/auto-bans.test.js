// SHY-0605: lifting the bans a suspension applied, in its own home so every
// suspension ending can await it.

const mockQuery = jest.fn();
const mockAuditSet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn((name) => {
      const filters = [];
      const chain = {
        where: (field, op, value) => {
          filters.push([field, op, value]);
          return chain;
        },
        get: () => mockQuery(name, filters),
      };
      return chain;
    }),
    doc: jest.fn((path) => ({ set: (data) => mockAuditSet(path, data) })),
  },
}));

jest.mock('../../src/utils/bans', () => ({ clearBanCache: jest.fn() }));
jest.mock('../../src/utils/banned-claim', () => ({ syncBannedClaim: jest.fn() }));
jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'audit-1'),
  now: jest.fn(() => 1709913600000),
}));
jest.mock('../../src/utils/log', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { clearBanCache } = require('../../src/utils/bans');
const { syncBannedClaim } = require('../../src/utils/banned-claim');
const { liftAutoAppliedBans } = require('../../src/utils/auto-bans');

function banDoc(id, del = jest.fn().mockResolvedValue()) {
  return { id, ref: { delete: del } };
}

/** Answer each (collection, linkedUniqueId) query with the given docs. */
function bans(byQuery) {
  mockQuery.mockImplementation(async (name, filters) => {
    const linked = filters.find(([field]) => field === 'linkedUniqueId')[2];
    return { docs: byQuery[`${name}:${typeof linked}`] || [] };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockAuditSet.mockReset().mockResolvedValue();
  clearBanCache.mockReset();
  syncBannedClaim.mockReset().mockResolvedValue();
});

describe('liftAutoAppliedBans', () => {
  it('asks only for auto-applied bans', async () => {
    bans({});

    await liftAutoAppliedBans('10000001', 'admin-uid');

    expect(mockQuery).toHaveBeenCalledTimes(4);
    for (const [, filters] of mockQuery.mock.calls) {
      expect(filters).toContainEqual(['autoApplied', '==', true]);
    }
  });

  it('deletes the device bans linked by a string id', async () => {
    const ban = banDoc('device-s');
    bans({ 'deviceBans:string': [ban] });

    await liftAutoAppliedBans('10000001', 'admin-uid');

    expect(ban.ref.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes the device bans linked by a numeric id', async () => {
    const ban = banDoc('device-n');
    bans({ 'deviceBans:number': [ban] });

    await liftAutoAppliedBans('10000001', 'admin-uid');

    expect(ban.ref.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes the network bans linked by a string id', async () => {
    const ban = banDoc('network-s');
    bans({ 'networkBans:string': [ban] });

    await liftAutoAppliedBans('10000001', 'admin-uid');

    expect(ban.ref.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes the network bans linked by a numeric id', async () => {
    const ban = banDoc('network-n');
    bans({ 'networkBans:number': [ban] });

    await liftAutoAppliedBans('10000001', 'admin-uid');

    expect(ban.ref.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes a ban found by both id forms once', async () => {
    const del = jest.fn().mockResolvedValue();
    bans({
      'deviceBans:string': [banDoc('device-1', del)],
      'deviceBans:number': [banDoc('device-1', del)],
    });

    await liftAutoAppliedBans('10000001', 'admin-uid');

    expect(del).toHaveBeenCalledTimes(1);
  });

  it('clears the ban cache and recomputes the banned claim after deleting', async () => {
    const ban = banDoc('device-1');
    bans({ 'deviceBans:string': [ban] });

    await liftAutoAppliedBans('10000001', 'admin-uid');

    expect(clearBanCache).toHaveBeenCalledTimes(1);
    expect(syncBannedClaim).toHaveBeenCalledWith('10000001');
    expect(ban.ref.delete.mock.invocationCallOrder[0]).toBeLessThan(
      syncBannedClaim.mock.invocationCallOrder[0],
    );
  });

  it('writes the lift audit entry as the actor', async () => {
    bans({
      'deviceBans:string': [banDoc('device-1')],
      'networkBans:number': [banDoc('network-1')],
    });

    await liftAutoAppliedBans('10000001', 'admin-uid');

    expect(mockAuditSet).toHaveBeenCalledWith('adminAuditLog/audit-1', {
      adminId: 'admin-uid',
      action: 'LIFT_AUTO_BANS',
      targetUserId: '10000001',
      details: 'Removed 2 auto-applied ban(s) on unsuspension',
      createdAt: 1709913600000,
    });
  });

  it('writes nothing when the suspension applied no bans', async () => {
    bans({});

    await liftAutoAppliedBans('10000001', 'admin-uid');

    expect(clearBanCache).not.toHaveBeenCalled();
    expect(syncBannedClaim).not.toHaveBeenCalled();
    expect(mockAuditSet).not.toHaveBeenCalled();
  });

  it('fails when a ban cannot be deleted, writing no audit entry', async () => {
    bans({
      'deviceBans:string': [
        banDoc('device-1', jest.fn().mockRejectedValue(new Error('delete failed'))),
      ],
    });

    await expect(liftAutoAppliedBans('10000001', 'admin-uid')).rejects.toThrow('delete failed');
    expect(mockAuditSet).not.toHaveBeenCalled();
  });

  it('fails when the banned claim cannot be recomputed', async () => {
    bans({ 'deviceBans:string': [banDoc('device-1')] });
    syncBannedClaim.mockRejectedValue(new Error('claims down'));

    await expect(liftAutoAppliedBans('10000001', 'admin-uid')).rejects.toThrow('claims down');
    expect(mockAuditSet).not.toHaveBeenCalled();
  });
});
