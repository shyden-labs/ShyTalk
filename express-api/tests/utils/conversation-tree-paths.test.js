/**
 * SHY-0631 — each server path that deletes a conversation leaves nothing
 * under it: messages, their `edits`, and every other subcollection.
 *
 * Real Firestore emulator, in its own namespaced project so it can wipe the
 * conversation groups freely (see tests/helpers/firebase-emulator.js).
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';
process.env.FIRESTORE_TEST_NAMESPACE = 'convtree';

const { db } = require('../../src/utils/firebase');
const { deleteTree } = require('../../src/utils/delete-tree');
const { _deleteConversation } = require('../../src/routes/admin-cleanup');
const { deleteTestData } = require('../../src/routes/test-helpers');
const {
  assertEmulatorReachable,
  clearCollection,
  clearCollectionGroup,
} = require('../helpers/firebase-emulator');
const {
  SEEDED_UNDER_COUNT,
  seedConversationTree,
  docsUnder,
} = require('../helpers/conversation-tree');

const exists = async (path) => (await db.doc(path).get()).exists;

// Every group a seeded conversation tree writes into.
const TREE_GROUPS = ['messages', 'edits', 'userSettings', 'settings', 'mutes', 'mod_log'];

async function clearAll() {
  await clearCollection(db, 'conversations');
  for (const group of TREE_GROUPS) await clearCollectionGroup(db, group);
}

beforeAll(async () => {
  await assertEmulatorReachable();
});

beforeEach(clearAll);

afterAll(async () => {
  await clearAll();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('deleteTree against the emulator', () => {
  test('deletes the conversation and every document under it, counted by collection', async () => {
    await seedConversationTree(db, 'c1', { participantIds: ['1', '2'] });
    expect(await docsUnder(db, 'conversations/c1')).toHaveLength(SEEDED_UNDER_COUNT);

    const counts = await deleteTree(db, db.doc('conversations/c1'));

    expect(await exists('conversations/c1')).toBe(false);
    expect(await docsUnder(db, 'conversations/c1')).toEqual([]);
    expect(counts).toEqual({
      conversations: 1,
      messages: 2,
      edits: 2,
      userSettings: 1,
      settings: 1,
      mutes: 1,
      mod_log: 1,
    });
  });

  test('leaves a neighbouring conversation alone', async () => {
    await seedConversationTree(db, 'c1', { participantIds: ['1', '2'] });
    await seedConversationTree(db, 'c2', { participantIds: ['3', '4'] });

    await deleteTree(db, db.doc('conversations/c1'));

    expect(await exists('conversations/c2')).toBe(true);
    expect(await docsUnder(db, 'conversations/c2')).toHaveLength(SEEDED_UNDER_COUNT);
  });
});

describe('admin clean-up', () => {
  test('deleteConversation leaves nothing under the conversation', async () => {
    await seedConversationTree(db, 'c1', { participantIds: ['1', 'SHYTALK_SYSTEM'] });
    expect(await docsUnder(db, 'conversations/c1')).toHaveLength(SEEDED_UNDER_COUNT);

    await _deleteConversation('c1');

    expect(await exists('conversations/c1')).toBe(false);
    expect(await docsUnder(db, 'conversations/c1')).toEqual([]);
  });
});

describe('test reset', () => {
  test('deleteTestData leaves nothing under a tagged conversation', async () => {
    await seedConversationTree(db, 'c1', {
      participantIds: ['1', '2'],
      _testRun: 'test_convtree',
    });
    expect(await docsUnder(db, 'conversations/c1')).toHaveLength(SEEDED_UNDER_COUNT);

    await deleteTestData('test_convtree');

    expect(await exists('conversations/c1')).toBe(false);
    expect(await docsUnder(db, 'conversations/c1')).toEqual([]);
  });

  test('deleteTestData leaves an untagged conversation alone', async () => {
    await seedConversationTree(db, 'c1', { participantIds: ['1', '2'], _testRun: 'test_convtree' });
    await seedConversationTree(db, 'keep', { participantIds: ['3', '4'] });

    await deleteTestData('test_convtree');

    expect(await docsUnder(db, 'conversations/keep')).toHaveLength(SEEDED_UNDER_COUNT);
  });
});
