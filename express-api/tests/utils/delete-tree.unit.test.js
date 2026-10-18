/**
 * SHY-0631 — deleteTree, with Firestore stood in: it deletes a document's
 * subcollections before the document (and the document only if they all
 * went), its BulkWriter never retries, deletions are counted by collection
 * name, and the writer is closed whether the delete passes or fails.
 */
const { deleteTree } = require('../../src/utils/delete-tree');

/** A deleted document's reference, as BulkWriter's onWriteResult receives it. */
function refAt(path) {
  const parts = path.split('/');
  return { path, parent: { id: parts[parts.length - 2] } };
}

/**
 * A Firestore stand-in. `deletedUnder` maps a collection path to the document
 * paths its recursiveDelete reports; `failing` names a collection path whose
 * recursiveDelete rejects. `calls` records every recursiveDelete and root delete.
 */
function standIn({ deletedUnder = {}, failing = null } = {}) {
  const handlers = {};
  const calls = [];
  const writer = {
    onWriteError: jest.fn((fn) => {
      handlers.error = fn;
    }),
    onWriteResult: jest.fn((fn) => {
      handlers.result = fn;
    }),
    delete: jest.fn(async (ref) => {
      calls.push(`delete ${ref.path}`);
      handlers.result(refAt(ref.path), {});
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const firestore = {
    bulkWriter: jest.fn(() => writer),
    recursiveDelete: jest.fn(async (ref, usedWriter) => {
      calls.push(`recursiveDelete ${ref.path}`);
      expect(usedWriter).toBe(writer);
      for (const path of deletedUnder[ref.path] || []) handlers.result(refAt(path), {});
      if (ref.path === failing) throw new Error(`1 delete failed under ${ref.path}`);
    }),
  };
  return { firestore, writer, handlers, calls };
}

/** A document reference whose subcollections are `children` (collection paths). */
function docRef(path, children) {
  return {
    path,
    listCollections: jest.fn(async () => children.map((child) => ({ path: child }))),
  };
}

const CONV = 'conversations/c1';
const MESSAGES = `${CONV}/messages`;
const SETTINGS = `${CONV}/userSettings`;

describe('deleteTree on a document', () => {
  test('deletes each subcollection with its own writer, then the document', async () => {
    const { firestore, calls } = standIn();
    await deleteTree(firestore, docRef(CONV, [MESSAGES, SETTINGS]));
    expect(calls).toEqual([
      `recursiveDelete ${MESSAGES}`,
      `recursiveDelete ${SETTINGS}`,
      `delete ${CONV}`,
    ]);
  });

  test('a failed subcollection keeps the document, so a query finds it again', async () => {
    const { firestore, writer, calls } = standIn({ failing: MESSAGES });
    await expect(deleteTree(firestore, docRef(CONV, [MESSAGES, SETTINGS]))).rejects.toThrow(
      `1 delete failed under ${MESSAGES}`,
    );
    expect(calls).toEqual([`recursiveDelete ${MESSAGES}`]);
    expect(writer.delete).not.toHaveBeenCalled();
  });

  test('flushes the document delete before reporting it done', async () => {
    const { firestore, writer } = standIn();
    await deleteTree(firestore, docRef(CONV, []));
    expect(writer.flush).toHaveBeenCalledTimes(1);
  });

  test('counts deleted documents by the collection each lived in', async () => {
    const { firestore } = standIn({
      deletedUnder: {
        [MESSAGES]: [`${MESSAGES}/m1/edits/e1`, `${MESSAGES}/m1/edits/e2`, `${MESSAGES}/m1`],
        [SETTINGS]: [`${SETTINGS}/u1`],
      },
    });
    await expect(deleteTree(firestore, docRef(CONV, [MESSAGES, SETTINGS]))).resolves.toEqual({
      edits: 2,
      messages: 1,
      userSettings: 1,
      conversations: 1,
    });
  });
});

describe('deleteTree on a collection', () => {
  test('hands recursiveDelete the collection and its own writer', async () => {
    const { firestore, writer, calls } = standIn();
    await deleteTree(firestore, { path: 'conversations' });
    expect(calls).toEqual(['recursiveDelete conversations']);
    expect(writer.delete).not.toHaveBeenCalled();
  });

  test('returns an empty count when nothing was deleted', async () => {
    const { firestore } = standIn();
    await expect(deleteTree(firestore, { path: 'conversations' })).resolves.toEqual({});
  });

  test('passes a failed delete on', async () => {
    const { firestore } = standIn({ failing: 'conversations' });
    await expect(deleteTree(firestore, { path: 'conversations' })).rejects.toThrow(
      '1 delete failed under conversations',
    );
  });
});

describe('deleteTree writer', () => {
  test('creates a fresh writer per call', async () => {
    const { firestore } = standIn();
    await deleteTree(firestore, { path: 'conversations' });
    await deleteTree(firestore, { path: 'conversations' });
    expect(firestore.bulkWriter).toHaveBeenCalledTimes(2);
  });

  test('never retries a failed delete', async () => {
    const { firestore, handlers } = standIn();
    await deleteTree(firestore, { path: 'conversations' });
    expect(handlers.error({ code: 14, failedAttempts: 1 })).toBe(false);
  });

  test('closes the writer after a delete that passed', async () => {
    const { firestore, writer } = standIn();
    await deleteTree(firestore, docRef(CONV, [MESSAGES]));
    expect(writer.close).toHaveBeenCalledTimes(1);
  });

  test('closes the writer after a delete that failed', async () => {
    const { firestore, writer } = standIn({ failing: MESSAGES });
    await expect(deleteTree(firestore, docRef(CONV, [MESSAGES]))).rejects.toThrow();
    expect(writer.close).toHaveBeenCalledTimes(1);
  });
});
