/**
 * SHY-0631 — a failed conversation delete stops that account's deletion
 * before its user document goes, so the account stays due for the next run,
 * the other accounts in the run still go, and the run ends as a failure.
 *
 * Firestore, mail, R2 and the delete helper are stood in; the emulator suite
 * (tests/cron/accountDeletion.test.js) proves the deletes themselves.
 */
const mockDeleteTree = jest.fn();
const mockLogInfo = jest.fn();
const mockWrites = [];

/** Every user document is due; nothing else exists. */
function mockDocRef(path) {
  const isUser = /^users\/[^/]+$/.test(path);
  return {
    path,
    get: async () => ({
      id: path.split('/').pop(),
      exists: isUser,
      data: () => (isUser ? { deletionExecuteAt: 1, firebaseUid: `fb-${path}` } : undefined),
    }),
    delete: async () => mockWrites.push(`delete ${path}`),
    update: async () => mockWrites.push(`update ${path}`),
    set: async () => mockWrites.push(`set ${path}`),
  };
}

let mockDueUsers = [];

const mockOneOnOne = (id) => ({
  id,
  ref: mockDocRef(`conversations/${id}`),
  data: () => ({ participantIds: [1, 2] }),
});
let mockConversations = [];

/** A query whose result depends only on the collection it started from. */
function mockQuery(name) {
  const docs =
    name === 'users'
      ? mockDueUsers.map((id) => ({ id, data: () => ({}) }))
      : name === 'conversations'
        ? mockConversations
        : [];
  const query = {
    where: () => query,
    limit: () => query,
    get: async () => ({ docs, empty: docs.length === 0, size: docs.length }),
  };
  return query;
}

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: (name) => mockQuery(name),
    collectionGroup: (name) => mockQuery(name),
    doc: (path) => mockDocRef(path),
    batch: () => ({
      delete: () => {},
      update: () => {},
      set: () => {},
      commit: async () => {},
    }),
  },
  auth: { deleteUser: async () => {} },
  FieldValue: { arrayRemove: () => ({}), increment: () => ({}) },
}));
jest.mock('../../src/utils/delete-tree', () => ({
  deleteTree: (...args) => mockDeleteTree(...args),
}));
jest.mock('../../src/utils/email', () => ({ sendEmail: async () => {} }));
jest.mock('../../src/utils/r2', () => ({
  listObjects: async () => [],
  deleteObjects: async () => {},
}));
jest.mock('../../src/utils/log', () => ({
  info: (...args) => mockLogInfo(...args),
  warn: () => {},
  error: () => {},
}));

const accountDeletion = require('../../src/cron/accountDeletion');

beforeEach(() => {
  mockWrites.length = 0;
  mockDeleteTree.mockReset();
  mockLogInfo.mockReset();
  mockConversations = [mockOneOnOne('c1')];
});

describe('accountDeletion when a conversation delete fails', () => {
  test('the run fails, naming how many accounts failed', async () => {
    mockDueUsers = ['1001'];
    mockDeleteTree.mockRejectedValue(new Error('1 delete failed'));

    await expect(accountDeletion()).rejects.toThrow('1 account deletion(s) failed');
  });

  test('the failed account keeps its user document, so the next run finds it', async () => {
    mockDueUsers = ['1001'];
    mockDeleteTree.mockRejectedValue(new Error('1 delete failed'));

    await expect(accountDeletion()).rejects.toThrow();

    expect(mockWrites).not.toContain('delete users/1001');
    expect(mockWrites).not.toContain('update users/1001');
  });

  test('the other accounts in the run are still deleted', async () => {
    mockDueUsers = ['1001', '1002'];
    mockDeleteTree.mockRejectedValueOnce(new Error('1 delete failed')).mockResolvedValue({});

    await expect(accountDeletion()).rejects.toThrow('1 account deletion(s) failed');

    expect(mockWrites).not.toContain('delete users/1001');
    expect(mockWrites).toContain('delete users/1002');
  });

  test('a run in which every account went resolves', async () => {
    mockDueUsers = ['1001'];
    mockDeleteTree.mockResolvedValue({});

    await expect(accountDeletion()).resolves.toBeUndefined();
    expect(mockWrites).toContain('delete users/1001');
  });
});

describe('accountDeletion logs what it deleted', () => {
  const deletedLogs = () =>
    mockLogInfo.mock.calls.filter(([, message]) => message === 'Conversation documents deleted');

  test('one entry per account, with the documents deleted counted by collection', async () => {
    mockDueUsers = ['1001', '1002'];
    mockDeleteTree
      .mockResolvedValueOnce({ conversations: 1, messages: 2, edits: 3 })
      .mockResolvedValueOnce({ conversations: 1, messages: 5, recall: 1 });

    await accountDeletion();

    expect(deletedLogs()).toEqual([
      [
        'cron',
        'Conversation documents deleted',
        { uniqueId: '1001', deleted: { conversations: 1, messages: 2, edits: 3 } },
      ],
      [
        'cron',
        'Conversation documents deleted',
        { uniqueId: '1002', deleted: { conversations: 1, messages: 5, recall: 1 } },
      ],
    ]);
  });

  test("an account's conversations are summed into one entry", async () => {
    mockDueUsers = ['1001'];
    mockConversations = [mockOneOnOne('c1'), mockOneOnOne('c2')];
    mockDeleteTree
      .mockResolvedValueOnce({ conversations: 1, messages: 2, edits: 1 })
      .mockResolvedValueOnce({ conversations: 1, messages: 4 });

    await accountDeletion();

    expect(deletedLogs()).toEqual([
      [
        'cron',
        'Conversation documents deleted',
        { uniqueId: '1001', deleted: { conversations: 2, messages: 6, edits: 1 } },
      ],
    ]);
  });

  test('the entry holds counts only, never ids or text from the deleted documents', async () => {
    mockDueUsers = ['1001'];
    mockDeleteTree.mockResolvedValueOnce({ conversations: 1, messages: 2 });

    await accountDeletion();

    const [[, , fields]] = deletedLogs();
    expect(Object.keys(fields).sort()).toEqual(['deleted', 'uniqueId']);
    for (const n of Object.values(fields.deleted)) expect(Number.isInteger(n)).toBe(true);
  });
});
