/**
 * SHY-0631 — the orphaned message history clean-up against the real
 * Firestore emulator: a dry run changes nothing, `--apply` removes only the
 * orphans and their stray parents, and live or out-of-scope history stays.
 *
 * Own namespaced project, so it can wipe the groups it seeds freely.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';
process.env.FIRESTORE_TEST_NAMESPACE = 'orphanhist';

const { db } = require('../../src/utils/firebase');
const { main } = require('../../scripts/delete-orphaned-message-history');
const {
  assertEmulatorReachable,
  clearCollection,
  clearCollectionGroup,
} = require('../helpers/firebase-emulator');
const { docsUnder } = require('../helpers/conversation-tree');

const exists = async (path) => (await db.doc(path).get()).exists;

/**
 * Seeds, with literal paths (the test-isolation guard reads each one):
 * - live: message and conversation exist, so the edit stays;
 * - orphan: `gone` was deleted, its edit was not;
 * - orphan: `dead` was deleted; a stray message and its edit remain;
 * - out of scope: a room message's `edits` is not conversation history.
 */
async function seedAll() {
  await db.doc('conversations/live').set({ seeded: true });
  await db.doc('conversations/live/messages/m1').set({ seeded: true });
  await db.doc('conversations/live/messages/m1/edits/e1').set({ seeded: true });
  await db.doc('conversations/live/messages/gone/edits/e1').set({ seeded: true });
  await db.doc('conversations/dead/messages/m1').set({ seeded: true });
  await db.doc('conversations/dead/messages/m1/edits/e1').set({ seeded: true });
  await db.doc('rooms/r1/messages/m1/edits/e1').set({ seeded: true });
}

/** Whether each seeded document still exists, in seeding order. */
async function seededExistence() {
  return Promise.all([
    exists('conversations/live'),
    exists('conversations/live/messages/m1'),
    exists('conversations/live/messages/m1/edits/e1'),
    exists('conversations/live/messages/gone/edits/e1'),
    exists('conversations/dead/messages/m1'),
    exists('conversations/dead/messages/m1/edits/e1'),
    exists('rooms/r1/messages/m1/edits/e1'),
  ]);
}

const ALL_SEVEN = [true, true, true, true, true, true, true];

async function clearAll() {
  await clearCollection(db, 'conversations');
  await clearCollection(db, 'rooms');
  for (const group of ['messages', 'edits', 'recall']) await clearCollectionGroup(db, group);
}

/** Run main and return its exit code and parsed output lines. */
async function run(argv) {
  const lines = [];
  const code = await main(argv, { firestore: db, log: (line) => lines.push(JSON.parse(line)) });
  return { code, lines };
}

beforeAll(async () => {
  await assertEmulatorReachable();
});

beforeEach(async () => {
  await clearAll();
  await seedAll();
});

afterAll(async () => {
  await clearAll();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('delete-orphaned-message-history (real Firestore emulator)', () => {
  test('a dry run counts the orphans and deletes nothing', async () => {
    const { code, lines } = await run([]);

    expect(code).toBe(0);
    expect(lines).toEqual([
      {
        project: db.projectId,
        phase: 'before',
        scanned: 4,
        orphaned: 2,
        messages: 1,
        conversations: 1,
        unexpected: 1,
      },
    ]);
    expect(await seededExistence()).toEqual(ALL_SEVEN);
  });

  test('a dry run finds its planted sentinel and leaves nothing of it behind', async () => {
    const { code } = await run([]);

    expect(code).toBe(0);
    expect(await docsUnder(db, 'conversations/shy-0631-orphan-sentinel')).toEqual([]);
    expect(await exists('conversations/shy-0631-orphan-sentinel/messages/m/edits/e')).toBe(false);
  });

  test('--apply removes the orphans and their stray parents, then counts zero', async () => {
    await run([]); // the project id is known once a query has run
    const { code, lines } = await run(['--apply', '--project', db.projectId]);

    expect(code).toBe(0);
    expect(lines[1]).toEqual({
      project: db.projectId,
      phase: 'after',
      scanned: 2,
      orphaned: 0,
      messages: 0,
      conversations: 0,
      unexpected: 1,
    });
    expect(await docsUnder(db, 'conversations/live/messages/gone')).toEqual([]);
    expect(await docsUnder(db, 'conversations/dead')).toEqual([]);
  });

  test('--apply keeps live history and history outside conversations', async () => {
    await run([]);
    await run(['--apply', '--project', db.projectId]);

    expect(await exists('conversations/live/messages/m1/edits/e1')).toBe(true);
    expect(await exists('conversations/live/messages/m1')).toBe(true);
    expect(await exists('rooms/r1/messages/m1/edits/e1')).toBe(true);
  });

  test('--apply naming another project deletes nothing', async () => {
    await expect(run(['--apply', '--project', 'shytalk-prod'])).rejects.toThrow(
      'nothing was deleted',
    );
    expect(await seededExistence()).toEqual(ALL_SEVEN);
  });
});
