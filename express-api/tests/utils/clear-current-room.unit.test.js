/**
 * SHY-0708 — a closed or left room clears a member's `currentRoomId` only
 * while it still names that room. A room's member list was client-written
 * at create time, so a close must never clear someone sitting in another
 * room. Firestore is a fake: nothing is reached.
 */
const { clearCurrentRoomFor } = require('../../src/utils/clear-current-room');

const ROOM = 'room1';

/**
 * A fake Firestore holding user docs by id. Each runTransaction runs its
 * body and commits only if no doc it read has changed since the read, else
 * runs the body again (as Firestore's optimistic transactions do).
 * `during(id, docs)` runs after the first read of a doc, so a test can move
 * a user between a transaction's read and its commit.
 */
function makeDb(users, { failFor = [], during = null } = {}) {
  const docs = new Map(Object.entries(users));
  const updates = [];
  let moved = false;
  const db = {
    // A direct read outside any transaction, so code that reads a member's
    // doc that way (and loses the transaction's protection) still runs.
    doc: (path) => {
      const id = path.split('/')[1];
      return {
        path,
        id,
        get: async () => {
          const data = docs.get(id);
          return { exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
        },
      };
    },
    runTransaction: jest.fn(async (body) => {
      for (;;) {
        const reads = new Map();
        const pending = [];
        const t = {
          get: async (ref) => {
            if (failFor.includes(ref.id)) throw new Error(`user ${ref.id} unreadable`);
            const data = docs.get(ref.id);
            reads.set(ref.id, JSON.stringify(data));
            if (during && !moved) {
              moved = true;
              during(ref.id, docs);
            }
            return { exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
          },
          update: (ref, patch) => pending.push({ ref, patch }),
        };
        const result = await body(t);
        const changed = [...reads].some(([id, seen]) => JSON.stringify(docs.get(id)) !== seen);
        if (changed) continue;
        for (const { ref, patch } of pending) {
          docs.set(ref.id, { ...docs.get(ref.id), ...patch });
          updates.push({ path: ref.path, patch });
        }
        return result;
      }
    }),
  };
  return { db, docs, updates };
}

const makeLog = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });

describe('clearCurrentRoomFor', () => {
  test('a member whose currentRoomId is this room is cleared', async () => {
    const { db, updates } = makeDb({ 1: { currentRoomId: ROOM } });
    const result = await clearCurrentRoomFor(db, ROOM, ['1'], makeLog());
    expect(updates).toEqual([{ path: 'users/1', patch: { currentRoomId: null } }]);
    expect(result).toEqual({ cleared: 1, elsewhere: 0, unsafe: 0, failed: 0 });
  });

  test('a member sitting in another room keeps it, and is counted', async () => {
    const { db, updates, docs } = makeDb({
      1: { currentRoomId: ROOM },
      2: { currentRoomId: 'room2' },
    });
    const log = makeLog();
    const result = await clearCurrentRoomFor(db, ROOM, ['1', '2'], log);
    expect(updates.map((u) => u.path)).toEqual(['users/1']);
    expect(docs.get('2').currentRoomId).toBe('room2');
    expect(result).toEqual({ cleared: 1, elsewhere: 1, unsafe: 0, failed: 0 });
    expect(log.info).toHaveBeenCalledWith(
      'room-members',
      'currentRoomId kept: member is elsewhere',
      {
        roomId: ROOM,
        count: 1,
      },
    );
  });

  test.each([
    ['already cleared', { currentRoomId: null }],
    ['never set', {}],
  ])('a member whose currentRoomId is %s is not written', async (_label, data) => {
    const { db, updates } = makeDb({ 1: data });
    const result = await clearCurrentRoomFor(db, ROOM, ['1'], makeLog());
    expect(updates).toEqual([]);
    expect(result.elsewhere).toBe(1);
  });

  test('a user with no document is not created', async () => {
    const { db, updates, docs } = makeDb({});
    await clearCurrentRoomFor(db, ROOM, ['1'], makeLog());
    expect(updates).toEqual([]);
    expect(docs.has('1')).toBe(false);
  });

  test('a member who moves to another room during the clear keeps the new room', async () => {
    const { db, docs } = makeDb(
      { 1: { currentRoomId: ROOM } },
      { during: (id, all) => all.set(id, { currentRoomId: 'room2' }) },
    );
    const result = await clearCurrentRoomFor(db, ROOM, ['1'], makeLog());
    expect(docs.get('1').currentRoomId).toBe('room2');
    expect(result).toEqual({ cleared: 0, elsewhere: 1, unsafe: 0, failed: 0 });
  });

  test("each member's check and clear is its own transaction", async () => {
    const { db } = makeDb({ 1: { currentRoomId: ROOM }, 2: { currentRoomId: ROOM } });
    await clearCurrentRoomFor(db, ROOM, ['1', '2'], makeLog());
    expect(db.runTransaction).toHaveBeenCalledTimes(2);
  });

  test('an id that is not digits never becomes a users path, and is counted', async () => {
    const { db, updates } = makeDb({ 1: { currentRoomId: ROOM } });
    const log = makeLog();
    const result = await clearCurrentRoomFor(db, ROOM, ['1', '../admin', 'a/b', '', 'x7', 7], log);
    expect(updates.map((u) => u.path)).toEqual(['users/1']); // users/7 has no doc
    expect(db.runTransaction).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ cleared: 1, elsewhere: 1, unsafe: 4, failed: 0 });
    expect(log.error).toHaveBeenCalledWith(
      'room-members',
      'member ids that are not digits skipped',
      {
        roomId: ROOM,
        count: 4,
      },
    );
  });

  test('the same member listed twice is checked once', async () => {
    const { db } = makeDb({ 1: { currentRoomId: ROOM } });
    const result = await clearCurrentRoomFor(db, ROOM, ['1', '1', 1], makeLog());
    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(result.cleared).toBe(1);
  });

  test('one member failing is logged and never stops the others', async () => {
    const { db, updates } = makeDb(
      { 1: { currentRoomId: ROOM }, 2: { currentRoomId: ROOM } },
      { failFor: ['1'] },
    );
    const log = makeLog();
    const result = await clearCurrentRoomFor(db, ROOM, ['1', '2'], log);
    expect(updates.map((u) => u.path)).toEqual(['users/2']);
    expect(result).toEqual({ cleared: 1, elsewhere: 0, unsafe: 0, failed: 1 });
    expect(log.error).toHaveBeenCalledWith('room-members', 'currentRoomId clear failed', {
      roomId: ROOM,
      count: 1,
      error: 'user 1 unreadable',
    });
  });

  test('no members costs nothing and logs nothing', async () => {
    const { db } = makeDb({});
    const log = makeLog();
    const result = await clearCurrentRoomFor(db, ROOM, [], log);
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(result).toEqual({ cleared: 0, elsewhere: 0, unsafe: 0, failed: 0 });
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  test('a clean clear logs nothing', async () => {
    const { db } = makeDb({ 1: { currentRoomId: ROOM } });
    const log = makeLog();
    await clearCurrentRoomFor(db, ROOM, ['1'], log);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });
});
