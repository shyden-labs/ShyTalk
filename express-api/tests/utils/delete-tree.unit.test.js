/**
 * SHY-0631 — deleteTree, with Firestore stood in: it hands recursiveDelete
 * its own BulkWriter, that writer never retries, deletions are counted by
 * collection name, and the writer is closed whether the delete passes or fails.
 */
const { deleteTree } = require('../../src/utils/delete-tree');

/** A deleted document's reference, as BulkWriter's onWriteResult receives it. */
function refAt(path) {
  const parts = path.split('/');
  return { path, parent: { id: parts[parts.length - 2] } };
}

/** A Firestore stand-in whose recursiveDelete reports `deleted` then throws `failure`. */
function standIn({ deleted = [], failure = null } = {}) {
  const handlers = {};
  const writer = {
    onWriteError: jest.fn((fn) => {
      handlers.error = fn;
    }),
    onWriteResult: jest.fn((fn) => {
      handlers.result = fn;
    }),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const firestore = {
    bulkWriter: jest.fn(() => writer),
    recursiveDelete: jest.fn(async () => {
      for (const path of deleted) handlers.result(refAt(path), {});
      if (failure) throw failure;
    }),
  };
  return { firestore, writer, handlers };
}

const ROOT = { path: 'conversations/c1' };

describe('deleteTree', () => {
  test('hands recursiveDelete the reference and its own writer', async () => {
    const { firestore, writer } = standIn();
    await deleteTree(firestore, ROOT);
    expect(firestore.recursiveDelete).toHaveBeenCalledWith(ROOT, writer);
  });

  test('creates a fresh writer per call', async () => {
    const { firestore } = standIn();
    await deleteTree(firestore, ROOT);
    await deleteTree(firestore, ROOT);
    expect(firestore.bulkWriter).toHaveBeenCalledTimes(2);
  });

  test('never retries a failed delete', async () => {
    const { firestore, handlers } = standIn();
    await deleteTree(firestore, ROOT);
    expect(handlers.error({ code: 14, failedAttempts: 1 })).toBe(false);
  });

  test('counts deleted documents by the collection each lived in', async () => {
    const { firestore } = standIn({
      deleted: [
        'conversations/c1/messages/m1/edits/e1',
        'conversations/c1/messages/m1/edits/e2',
        'conversations/c1/messages/m1',
        'conversations/c1/userSettings/u1',
        'conversations/c1',
      ],
    });
    await expect(deleteTree(firestore, ROOT)).resolves.toEqual({
      edits: 2,
      messages: 1,
      userSettings: 1,
      conversations: 1,
    });
  });

  test('returns an empty count when nothing was deleted', async () => {
    const { firestore } = standIn();
    await expect(deleteTree(firestore, ROOT)).resolves.toEqual({});
  });

  test('closes the writer after a delete that passed', async () => {
    const { firestore, writer } = standIn();
    await deleteTree(firestore, ROOT);
    expect(writer.close).toHaveBeenCalledTimes(1);
  });

  test('passes a failed delete on and still closes the writer', async () => {
    const failure = new Error('2 deletes failed. The last delete failed with: PERMISSION_DENIED');
    const { firestore, writer } = standIn({ failure });
    await expect(deleteTree(firestore, ROOT)).rejects.toBe(failure);
    expect(writer.close).toHaveBeenCalledTimes(1);
  });
});
