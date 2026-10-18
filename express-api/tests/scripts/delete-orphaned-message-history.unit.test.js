/**
 * SHY-0631 — the orphaned message history clean-up, with Firestore stood in:
 * which paths count as history, which entries are orphaned, and that
 * `--apply` is refused unless it names the credential's project, and that every
 * run proves its scan can see an orphan by planting one (Shyden, 2026-10-18:
 * dev and production alike).
 */
const mockDeleted = [];
let mockOnDelete = () => {};
jest.mock('../../src/utils/delete-tree', () => ({
  deleteTree: async (_firestore, ref) => {
    mockDeleted.push(ref.path);
    mockOnDelete(ref.path);
    return {};
  },
}));

const {
  parentsOf,
  findOrphans,
  summarise,
  main,
} = require('../../scripts/delete-orphaned-message-history');

// Pinned as literals, never read back from the script's own constants.
const SENTINEL_CONVERSATION = 'conversations/shy-0631-orphan-sentinel';
const SENTINEL_PATH = 'conversations/shy-0631-orphan-sentinel/messages/m/edits/e';

beforeEach(() => {
  mockDeleted.length = 0;
  mockOnDelete = () => {};
});

/**
 * A Firestore stand-in holding `history` (paths found by the edits/recall
 * collection-group scans) and `existing` (document paths that exist). A `set`
 * adds a history path; the stood-in `deleteTree` removes everything under the
 * path it is given. `blind` makes every scan return nothing.
 */
function standIn({ history = [], existing = [], projectId = 'shytalk-dev', blind = false } = {}) {
  const present = new Set(existing);
  const store = { history: [...history], writes: [] };
  mockOnDelete = (root) => {
    store.history = store.history.filter((path) => path !== root && !path.startsWith(`${root}/`));
  };
  return {
    store,
    projectId,
    collectionGroup: (group) => ({
      select: () => ({
        get: async () => ({
          docs: blind
            ? []
            : store.history
                .filter((path) => path.split('/').slice(-2)[0] === group)
                .map((path) => ({ ref: { path } })),
        }),
      }),
    }),
    doc: (path) => ({
      path,
      set: async () => {
        store.writes.push(path);
        if (!store.history.includes(path)) store.history.push(path);
      },
    }),
    getAll: async (...refs) => refs.map((ref) => ({ ref, exists: present.has(ref.path) })),
  };
}

describe('parentsOf', () => {
  test('an edit under a conversation message names both parents', () => {
    expect(parentsOf('conversations/c1/messages/m1/edits/e1')).toEqual({
      conversation: 'conversations/c1',
      message: 'conversations/c1/messages/m1',
    });
  });

  test('a recall record is history too', () => {
    expect(parentsOf('conversations/c1/messages/m1/recall/record')).toEqual({
      conversation: 'conversations/c1',
      message: 'conversations/c1/messages/m1',
    });
  });

  test('an edits document under a room message is not ours', () => {
    expect(parentsOf('rooms/r1/messages/m1/edits/e1')).toBeNull();
  });

  test('an edits collection directly under a conversation is not ours', () => {
    expect(parentsOf('conversations/c1/edits/e1')).toBeNull();
  });

  test('an edits collection deeper than a message is not ours', () => {
    expect(parentsOf('conversations/c1/messages/m1/edits/e1/edits/e2')).toBeNull();
  });
});

describe('findOrphans', () => {
  test('history whose message and conversation exist is kept', async () => {
    const report = await findOrphans(
      standIn({
        history: ['conversations/c1/messages/m1/edits/e1'],
        existing: ['conversations/c1', 'conversations/c1/messages/m1'],
      }),
    );
    expect(summarise(report)).toEqual({
      scanned: 1,
      orphaned: 0,
      messages: 0,
      conversations: 0,
      unexpected: 0,
    });
  });

  test('history under a deleted message is orphaned, and that message is listed', async () => {
    const report = await findOrphans(
      standIn({
        history: [
          'conversations/c1/messages/gone/edits/e1',
          'conversations/c1/messages/gone/edits/e2',
        ],
        existing: ['conversations/c1'],
      }),
    );
    expect(report.orphaned).toBe(2);
    expect(report.messages).toEqual(['conversations/c1/messages/gone']);
    expect(report.conversations).toEqual([]);
  });

  test('history under a deleted conversation is orphaned, and only the conversation is listed', async () => {
    const report = await findOrphans(
      standIn({
        history: ['conversations/dead/messages/m1/edits/e1'],
        existing: ['conversations/dead/messages/m1'],
      }),
    );
    expect(report.orphaned).toBe(1);
    expect(report.conversations).toEqual(['conversations/dead']);
    expect(report.messages).toEqual([]);
  });

  test('a history path of another shape is counted as unexpected and left alone', async () => {
    const report = await findOrphans(standIn({ history: ['rooms/r1/messages/m1/edits/e1'] }));
    expect(summarise(report)).toEqual({
      scanned: 1,
      orphaned: 0,
      messages: 0,
      conversations: 0,
      unexpected: 1,
    });
  });

  test('existence is read in groups of at most 100 documents', async () => {
    const history = [];
    const existing = ['conversations/c1'];
    for (let i = 0; i < 150; i += 1) {
      history.push(`conversations/c1/messages/m${i}/edits/e1`);
      existing.push(`conversations/c1/messages/m${i}`);
    }
    const firestore = standIn({ history, existing });
    const sizes = [];
    const getAll = firestore.getAll;
    firestore.getAll = async (...refs) => {
      sizes.push(refs.length);
      return getAll(...refs);
    };

    const report = await findOrphans(firestore);

    expect(sizes).toEqual([100, 51]);
    expect(report.orphaned).toBe(0);
  });
});

describe('main', () => {
  test('a dry run prints the counts and deletes nothing', async () => {
    const lines = [];
    await expect(main([], { firestore: standIn(), log: (line) => lines.push(line) })).resolves.toBe(
      0,
    );
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      {
        project: 'shytalk-dev',
        phase: 'before',
        scanned: 0,
        orphaned: 0,
        messages: 0,
        conversations: 0,
        unexpected: 0,
      },
    ]);
  });

  test('--apply without --project is refused', async () => {
    await expect(main(['--apply'], { firestore: standIn(), log: () => {} })).rejects.toThrow(
      '--apply needs --project shytalk-dev',
    );
  });

  test('--apply against another project is refused', async () => {
    await expect(
      main(['--apply', '--project', 'shytalk-prod'], { firestore: standIn(), log: () => {} }),
    ).rejects.toThrow('--apply needs --project shytalk-dev');
  });
});

describe('main proves its scan can see an orphan', () => {
  const COUNTS_ZERO = { scanned: 0, orphaned: 0, messages: 0, conversations: 0, unexpected: 0 };

  test('the script plants exactly this sentinel: an edit under a conversation that does not exist', () => {
    const script = require('../../scripts/delete-orphaned-message-history');
    expect(script.SENTINEL_PATH).toBe(SENTINEL_PATH);
    expect(script.SENTINEL_CONVERSATION).toBe(SENTINEL_CONVERSATION);
    expect(parentsOf(SENTINEL_PATH)).toStrictEqual({
      conversation: SENTINEL_CONVERSATION,
      message: 'conversations/shy-0631-orphan-sentinel/messages/m',
    });
  });

  test('no part of the sentinel path is an id Firestore reserves (__name__)', () => {
    const script = require('../../scripts/delete-orphaned-message-history');
    // Firestore refuses any document or collection id shaped __...__ (INVALID_ARGUMENT,
    // seen on the emulator in #2427's first run); the stand-in here would accept it.
    for (const segment of script.SENTINEL_PATH.split('/')) {
      expect(segment).not.toMatch(/^__.*__$/);
    }
  });

  test('a dry run plants the sentinel, leaves it out of the counts, and removes it', async () => {
    const firestore = standIn();
    const lines = [];

    await expect(main([], { firestore, log: (line) => lines.push(line) })).resolves.toBe(0);

    expect(firestore.store.writes).toStrictEqual([SENTINEL_PATH]);
    expect(lines.map((line) => JSON.parse(line))).toStrictEqual([
      { project: 'shytalk-dev', phase: 'before', ...COUNTS_ZERO },
    ]);
    expect(firestore.store.history).toStrictEqual([]);
  });

  test('real orphans are counted beside the sentinel, never with it', async () => {
    const firestore = standIn({ history: ['conversations/dead/messages/m1/edits/e1'] });
    const lines = [];

    await main([], { firestore, log: (line) => lines.push(line) });

    expect(firestore.store.writes).toStrictEqual([SENTINEL_PATH]);
    expect(JSON.parse(lines[0])).toStrictEqual({
      project: 'shytalk-dev',
      phase: 'before',
      scanned: 1,
      orphaned: 1,
      messages: 0,
      conversations: 1,
      unexpected: 0,
    });
    expect(firestore.store.history).toStrictEqual(['conversations/dead/messages/m1/edits/e1']);
  });

  test('a scan that cannot see the sentinel fails, names it, and deletes nothing else', async () => {
    const firestore = standIn({ blind: true });

    await expect(
      main(['--apply', '--project', 'shytalk-dev'], { firestore, log: () => {} }),
    ).rejects.toThrow(`the scan did not find the planted sentinel ${SENTINEL_PATH}`);

    expect(mockDeleted).toStrictEqual([SENTINEL_CONVERSATION]);
  });

  test('--apply deletes the orphans and the sentinel, then counts zero', async () => {
    const firestore = standIn({ history: ['conversations/dead/messages/m1/edits/e1'] });
    const lines = [];

    await expect(
      main(['--apply', '--project', 'shytalk-dev'], { firestore, log: (line) => lines.push(line) }),
    ).resolves.toBe(0);

    expect(firestore.store.writes).toStrictEqual([SENTINEL_PATH]);
    expect(JSON.parse(lines[1])).toStrictEqual({
      project: 'shytalk-dev',
      phase: 'after',
      ...COUNTS_ZERO,
    });
    expect(firestore.store.history).toStrictEqual([]);
  });

  test('a refused --apply still removes the sentinel', async () => {
    const firestore = standIn();

    await expect(
      main(['--apply', '--project', 'shytalk-prod'], { firestore, log: () => {} }),
    ).rejects.toThrow('nothing was deleted');

    expect(firestore.store.writes).toStrictEqual([SENTINEL_PATH]);
    expect(firestore.store.history).toStrictEqual([]);
  });
});
