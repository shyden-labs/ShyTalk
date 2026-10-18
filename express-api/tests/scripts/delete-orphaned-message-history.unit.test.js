/**
 * SHY-0631 — the orphaned message history clean-up, with Firestore stood in:
 * which paths count as history, which entries are orphaned, and that
 * `--apply` is refused unless it names the credential's project.
 */
const {
  parentsOf,
  findOrphans,
  summarise,
  main,
} = require('../../scripts/delete-orphaned-message-history');

/**
 * A Firestore stand-in holding `history` (paths found by the edits/recall
 * collection-group scans) and `existing` (document paths that exist).
 */
function standIn({ history = [], existing = [], projectId = 'shytalk-dev' } = {}) {
  const present = new Set(existing);
  return {
    projectId,
    collectionGroup: (group) => ({
      select: () => ({
        get: async () => ({
          docs: history
            .filter((path) => path.split('/').slice(-2)[0] === group)
            .map((path) => ({ ref: { path } })),
        }),
      }),
    }),
    doc: (path) => ({ path }),
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
