/**
 * SHY-0641 — scripts/reset-data.mjs resets dev only, and says so when a step fails.
 *
 * Shyden, 2026-10-18: "Dev only". The script refuses production by any route
 * (--env prod, a production key, a production bucket), deletes conversations
 * as one tree through deleteTree (SHY-0631), and never reports "complete"
 * after a failed step. Firestore, RTDB and R2 are stood in; importing the
 * script runs nothing, so no credential, socket or process is touched.
 */
const SCRIPT = '../../../scripts/reset-data.mjs';

let reset;
beforeAll(async () => {
  reset = await import(SCRIPT);
});

/** A Firestore stand-in with nothing in it; records every write. */
function emptyDb() {
  const writes = [];
  const query = {
    limit: () => query,
    get: async () => ({ empty: true, size: 0, docs: [] }),
    listDocuments: async () => [],
  };
  return {
    writes,
    collection: (name) => ({ ...query, path: name }),
    doc: (path) => ({ path, set: async (data) => writes.push({ path, data }) }),
    batch: () => ({ delete: () => {}, commit: async () => {} }),
  };
}

function rtdbStandIn(failing = []) {
  const removed = [];
  return {
    removed,
    ref: (path) => ({
      remove: async () => {
        if (failing.includes(path)) throw new Error(`${path} refused`);
        removed.push(path);
      },
    }),
  };
}

describe('importing the script', () => {
  test('runs nothing: no credentials are needed to load it', () => {
    expect(process.env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(typeof reset.main).toBe('function');
  });
});

describe('refusal: dev only', () => {
  test('the dev project with no --env is allowed', () => {
    expect(reset.refusal({ argv: [], projectId: 'shytalk-dev' })).toBeNull();
  });

  test('--env dev is allowed', () => {
    expect(reset.refusal({ argv: ['--env', 'dev'], projectId: 'shytalk-dev' })).toBeNull();
  });

  test('--env prod is refused, naming the removal', () => {
    expect(reset.refusal({ argv: ['--env', 'prod'], projectId: 'shytalk-7ba69' })).toMatch(
      /production mode was removed/,
    );
  });

  test('any other --env is refused', () => {
    expect(reset.refusal({ argv: ['--env', 'staging'], projectId: 'shytalk-dev' })).toMatch(
      /only resets dev/,
    );
  });

  test('a production key is refused even with --env dev', () => {
    expect(reset.refusal({ argv: ['--env', 'dev'], projectId: 'shytalk-7ba69' })).toMatch(
      /shytalk-7ba69 is not the dev project/,
    );
  });

  test('a project merely containing "dev" is refused', () => {
    expect(reset.refusal({ argv: [], projectId: 'devious-prod' })).toMatch(
      /is not the dev project/,
    );
  });

  test('the production R2 bucket is refused', () => {
    expect(reset.refusal({ argv: [], projectId: 'shytalk-dev', bucket: 'shytalk-media' })).toMatch(
      /shytalk-media is not the dev bucket/,
    );
  });

  test('the dev R2 bucket is allowed', () => {
    expect(
      reset.refusal({ argv: [], projectId: 'shytalk-dev', bucket: 'shytalk-media-dev' }),
    ).toBeNull();
  });
});

describe('conversations go as one tree (SHY-0631)', () => {
  test('deleteTree is called once on the whole conversations collection', async () => {
    const db = emptyDb();
    const calls = [];
    const total = await reset.deleteConversations(db, async (firestore, ref) => {
      calls.push([firestore, ref.path]);
      return { conversations: 2, messages: 5, edits: 3, recall: 1 };
    });
    expect(calls).toStrictEqual([[db, 'conversations']]);
    expect(total).toBe(11);
  });

  test('no hand-made subcollection list names conversations', () => {
    expect(Object.keys(reset.SUBCOLLECTIONS)).not.toContain('conversations');
  });
});

describe('run never reports success after a failed step', () => {
  const quiet = () => {};

  test('a clean run resolves and says it is complete', async () => {
    const lines = [];
    await reset.run({
      db: emptyDb(),
      rtdb: rtdbStandIn(),
      wipeR2: async () => 0,
      deleteTreeFn: async () => ({}),
      log: (line) => lines.push(line),
    });
    expect(lines.some((line) => line.includes('reset complete'))).toBe(true);
  });

  test('a failed R2 wipe rejects the run and never says complete', async () => {
    const lines = [];
    await expect(
      reset.run({
        db: emptyDb(),
        rtdb: rtdbStandIn(),
        wipeR2: async () => {
          throw new Error('R2 refused');
        },
        deleteTreeFn: async () => ({}),
        log: (line) => lines.push(line),
      }),
    ).rejects.toThrow('R2 refused');
    expect(lines.some((line) => line.includes('reset complete'))).toBe(false);
  });

  test('a failed RTDB clear rejects the run', async () => {
    await expect(
      reset.run({
        db: emptyDb(),
        rtdb: rtdbStandIn(['conversations']),
        wipeR2: async () => 0,
        deleteTreeFn: async () => ({}),
        log: quiet,
      }),
    ).rejects.toThrow('conversations refused');
  });

  test('a failed conversation delete rejects the run before anything else is deleted', async () => {
    const rtdb = rtdbStandIn();
    await expect(
      reset.run({
        db: emptyDb(),
        rtdb,
        wipeR2: async () => 0,
        deleteTreeFn: async () => {
          throw new Error('1 delete failed');
        },
        log: quiet,
      }),
    ).rejects.toThrow('1 delete failed');
    expect(rtdb.removed).toStrictEqual([]);
  });
});
