const {
  FirestoreRefusal,
  encodeValue,
  decodeValue,
  firestoreAsPerson,
  setWrite,
  updateFieldsWrite,
  appendToArrayWrite,
  toggledReactions,
  canonicalReactions,
  reactAs,
  createGroupAs,
  waitForStored,
} = require('../../scripts/lib/firestore-as-person');

const DOCS = 'https://firestore.googleapis.com/v1/projects/p1/databases/(default)/documents';
const ROOT = 'projects/p1/databases/(default)/documents';

/** A fetch stand-in answering each call from `replies` in order and recording it. */
function fakeFetch(replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body && JSON.parse(init.body),
    });
    const r = replies[calls.length - 1];
    if (!r) throw new Error(`unexpected request #${calls.length}: ${init.method} ${url}`);
    return {
      ok: r.status < 300,
      status: r.status,
      text: async () => r.text ?? JSON.stringify(r.json),
    };
  };
  fn.calls = calls;
  return fn;
}
const asTheo = (replies) => {
  const fetchImpl = fakeFetch(replies);
  return {
    fetchImpl,
    fs: firestoreAsPerson({ documentsUrl: DOCS, token: 'T', who: 'Theo', fetchImpl }),
  };
};
const msgDoc = (reactions, updateTime = '2026-10-19T01:00:00.000000Z') => ({
  status: 200,
  json: {
    name: `${ROOT}/conversations/c1/messages/m1`,
    updateTime,
    fields: { reactions: encodeValue(reactions) },
  },
});

describe('encodeValue / decodeValue', () => {
  test('an integer is stored as integerValue text', () =>
    expect(encodeValue(5)).toEqual({ integerValue: '5' }));
  test('a fraction is stored as doubleValue', () =>
    expect(encodeValue(1.5)).toEqual({ doubleValue: 1.5 }));
  test('an empty list is an empty arrayValue', () =>
    expect(encodeValue([])).toEqual({ arrayValue: {} }));
  test('an empty map is an empty mapValue', () =>
    expect(encodeValue({})).toEqual({ mapValue: {} }));
  test('undefined is refused, not dropped', () =>
    expect(() => encodeValue(undefined)).toThrow('cannot store a undefined'));
  test('NaN is refused', () => expect(() => encodeValue(Number.NaN)).toThrow('cannot store NaN'));
  test('a reactions map round-trips', () => {
    const r = { '❤️': ['50000060'], '👍': ['50000080'] };
    expect(decodeValue(encodeValue(r))).toEqual(r);
  });
  test('an unknown value type is refused by name', () =>
    expect(() => decodeValue({ geoPointValue: {} })).toThrow(
      'unhandled Firestore value: geoPointValue',
    ));
  test('a missing arrayValue.values decodes as an empty list', () =>
    expect(decodeValue({ arrayValue: {} })).toEqual([]));
});

describe('firestoreAsPerson', () => {
  test('refuses a URL that is not a documents URL', () =>
    expect(() =>
      firestoreAsPerson({ documentsUrl: 'https://x/v1/projects/p', token: 'T', who: 'Theo' }),
    ).toThrow('not a Firestore documents URL'));
  test('get sends the persona token to the document URL', async () => {
    const { fs, fetchImpl } = asTheo([msgDoc({})]);
    await fs.get('conversations/c1/messages/m1');
    expect(fetchImpl.calls[0]).toMatchObject({
      url: `${DOCS}/conversations/c1/messages/m1`,
      method: 'GET',
      headers: { Authorization: 'Bearer T' },
    });
  });
  test('get returns the id, updateTime and decoded data', async () => {
    const { fs } = asTheo([msgDoc({ '❤️': ['1'] }, 'U1')]);
    expect(await fs.get('conversations/c1/messages/m1')).toEqual({
      id: 'm1',
      updateTime: 'U1',
      data: { reactions: { '❤️': ['1'] } },
    });
  });
  test('a rules refusal names the status, the code, the message and the person', async () => {
    const { fs } = asTheo([
      {
        status: 403,
        json: {
          error: {
            code: 403,
            status: 'PERMISSION_DENIED',
            message: 'Missing or insufficient permissions.',
          },
        },
      },
    ]);
    await expect(fs.get('conversations/c1/messages/m1')).rejects.toThrow(
      'Firestore refused get conversations/c1/messages/m1 as Theo: HTTP 403 PERMISSION_DENIED: Missing or insufficient permissions.',
    );
  });
  test('a refusal is a FirestoreRefusal', async () => {
    const { fs } = asTheo([
      { status: 403, json: { error: { status: 'PERMISSION_DENIED', message: 'no' } } },
    ]);
    await expect(fs.get('a/b')).rejects.toBeInstanceOf(FirestoreRefusal);
  });
  test("a refusal carries the status, the code and Firestore's message", async () => {
    const { fs } = asTheo([
      { status: 403, json: { error: { status: 'PERMISSION_DENIED', message: 'no' } } },
    ]);
    await expect(fs.get('a/b')).rejects.toMatchObject({
      status: 403,
      code: 'PERMISSION_DENIED',
      firestoreMessage: 'no',
    });
  });
  test('a refusal without a JSON body quotes the body', async () => {
    const { fs } = asTheo([{ status: 502, text: '<html>Bad gateway</html>' }]);
    await expect(fs.get('a/b')).rejects.toThrow('HTTP 502 NO_STATUS: <html>Bad gateway</html>');
  });
  test('a 200 that is not JSON fails by name', async () => {
    const { fs } = asTheo([{ status: 200, text: 'ok' }]);
    await expect(fs.get('a/b')).rejects.toThrow(
      'Firestore answered get a/b as Theo with HTTP 200 and no JSON object: ok',
    );
  });
  test('a get without name or updateTime fails by name', async () => {
    const { fs } = asTheo([{ status: 200, json: { fields: {} } }]);
    await expect(fs.get('a/b')).rejects.toThrow('without a name and updateTime');
  });
  test('create posts the fields to the collection and returns the new id', async () => {
    const { fs, fetchImpl } = asTheo([
      { status: 200, json: { name: `${ROOT}/conversations/NEW1` } },
    ]);
    expect(await fs.create('conversations', { isGroup: true })).toEqual({ id: 'NEW1' });
    expect(fetchImpl.calls[0]).toMatchObject({
      url: `${DOCS}/conversations`,
      method: 'POST',
      body: { fields: { isGroup: { booleanValue: true } } },
    });
  });
  test('commit posts the writes to documents:commit', async () => {
    const { fs, fetchImpl } = asTheo([{ status: 200, json: { writeResults: [] } }]);
    await fs.commit('label', [{ delete: 'x' }]);
    expect(fetchImpl.calls[0]).toMatchObject({
      url: `${DOCS}:commit`,
      method: 'POST',
      body: { writes: [{ delete: 'x' }] },
    });
  });
});

describe('write builders', () => {
  // Built inside each test, never at describe time: a throw there would take
  // the whole file down before any test ran.
  const fs = () =>
    firestoreAsPerson({ documentsUrl: DOCS, token: 'T', who: 'Theo', fetchImpl: fakeFetch([]) });
  test('setWrite replaces the whole document', () =>
    expect(setWrite(fs(), 'a/b', { n: 0 })).toEqual({
      update: { name: `${ROOT}/a/b`, fields: { n: { integerValue: '0' } } },
    }));
  test('updateFieldsWrite masks to the given fields and pins updateTime', () =>
    expect(updateFieldsWrite(fs(), 'a/b', { reactions: {} }, { updateTime: 'U1' })).toEqual({
      update: { name: `${ROOT}/a/b`, fields: { reactions: { mapValue: {} } } },
      updateMask: { fieldPaths: ['reactions'] },
      currentDocument: { updateTime: 'U1' },
    }));
  test('updateFieldsWrite refuses a field name that needs quoting', () =>
    expect(() => updateFieldsWrite(fs(), 'a/b', { 'a.b': 1 })).toThrow(
      'field name needs quoting: a.b',
    ));
  test('appendToArrayWrite is an appendMissingElements transform', () =>
    expect(appendToArrayWrite(fs(), 'a/b', 'participantIds', '50000060')).toEqual({
      transform: {
        document: `${ROOT}/a/b`,
        fieldTransforms: [
          {
            fieldPath: 'participantIds',
            appendMissingElements: { values: [{ stringValue: '50000060' }] },
          },
        ],
      },
    }));
});

describe('toggledReactions (mirrors PrivateMessageRepositoryImpl.toggleReaction)', () => {
  test('adds a first reaction', () =>
    expect(toggledReactions({}, '❤️', '1')).toEqual({ '❤️': ['1'] }));
  test('adds a second person to an emoji', () =>
    expect(toggledReactions({ '❤️': ['1'] }, '❤️', '2')).toEqual({ '❤️': ['1', '2'] }));
  test('takes a reaction back and keeps the other person', () =>
    expect(toggledReactions({ '❤️': ['1', '2'] }, '❤️', '2')).toEqual({ '❤️': ['1'] }));
  test('drops an emoji nobody holds any more', () =>
    expect(toggledReactions({ '❤️': ['1'], '👍': ['2'] }, '👍', '2')).toEqual({ '❤️': ['1'] }));
  test('treats a missing map as empty', () =>
    expect(toggledReactions(undefined, '😂', '1')).toEqual({ '😂': ['1'] }));
  test('does not change the map it was given', () => {
    const before = { '❤️': ['1'] };
    toggledReactions(before, '❤️', '2');
    expect(before).toEqual({ '❤️': ['1'] });
  });
});

describe('canonicalReactions', () => {
  test('orders emojis and people so equal maps read equal', () =>
    expect(canonicalReactions({ '👍': ['2'], '❤️': ['3', '1'] })).toBe(
      canonicalReactions({ '❤️': ['1', '3'], '👍': ['2'] }),
    ));
  test('an empty map reads {}', () => expect(canonicalReactions({})).toBe('{}'));
});

describe('reactAs', () => {
  test('reads the message, then writes the toggled map pinned to that read', async () => {
    const { fs, fetchImpl } = asTheo([
      msgDoc({ '👍': ['50000080'] }, 'U7'),
      { status: 200, json: { writeResults: [{}] } },
    ]);
    const next = await reactAs(fs, {
      conversationId: 'c1',
      messageId: 'm1',
      emoji: '❤️',
      uid: 50000060,
    });
    expect(next).toEqual({ '👍': ['50000080'], '❤️': ['50000060'] });
    expect(fetchImpl.calls[1].body.writes).toEqual([
      updateFieldsWrite(
        fs,
        'conversations/c1/messages/m1',
        { reactions: next },
        { updateTime: 'U7' },
      ),
    ]);
  });
  test('a refused write fails naming it, after one attempt', async () => {
    const { fs, fetchImpl } = asTheo([
      msgDoc({}),
      {
        status: 403,
        json: {
          error: { status: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.' },
        },
      },
    ]);
    await expect(
      reactAs(fs, { conversationId: 'c1', messageId: 'm1', emoji: '❤️', uid: 1 }),
    ).rejects.toThrow('HTTP 403 PERMISSION_DENIED');
    expect(fetchImpl.calls).toHaveLength(2);
  });
});

describe('createGroupAs (mirrors createGroupConversation)', () => {
  const replies = () => [
    { status: 200, json: { name: `${ROOT}/conversations/G1` } },
    { status: 200, json: {} },
    { status: 200, json: {} },
    { status: 200, json: {} },
  ];
  test('creates the group with the creator alone, as the rules require', async () => {
    const { fs, fetchImpl } = asTheo(replies());
    await createGroupAs(fs, {
      creatorId: 50000010,
      cohort: 'adult',
      memberIds: [50000060, 50000080],
      groupName: 'JR',
      now: 7,
    });
    expect(fetchImpl.calls[0].body.fields.participantIds).toEqual(encodeValue(['50000010']));
    expect(fetchImpl.calls[0].body.fields.cohort).toEqual({ stringValue: 'adult' });
  });
  test('adds each member in its own write', async () => {
    const { fs, fetchImpl } = asTheo(replies());
    await createGroupAs(fs, {
      creatorId: 1,
      cohort: 'adult',
      memberIds: [2, 3],
      groupName: 'JR',
      now: 7,
    });
    expect(fetchImpl.calls.slice(1, 3).map((c) => c.body.writes)).toEqual([
      [appendToArrayWrite(fs, 'conversations/G1', 'participantIds', '2')],
      [appendToArrayWrite(fs, 'conversations/G1', 'participantIds', '3')],
    ]);
  });
  test("writes only the creator's own userSettings row", async () => {
    const { fs, fetchImpl } = asTheo(replies());
    await createGroupAs(fs, {
      creatorId: 1,
      cohort: 'adult',
      memberIds: [2, 3],
      groupName: 'JR',
      now: 7,
    });
    expect(fetchImpl.calls[3].body.writes).toEqual([
      setWrite(fs, 'conversations/G1/userSettings/1', { unreadCount: 0, userId: '1' }),
    ]);
  });
  test('a refused member add stops the group by name', async () => {
    const r = replies();
    r[1] = { status: 403, json: { error: { status: 'PERMISSION_DENIED', message: 'no' } } };
    const { fs } = asTheo(r);
    await expect(
      createGroupAs(fs, {
        creatorId: 1,
        cohort: 'adult',
        memberIds: [2, 3],
        groupName: 'JR',
        now: 7,
      }),
    ).rejects.toThrow('Firestore refused commit conversations/G1 add 2 as Theo');
  });
  test('returns the id and everyone in it', async () => {
    const { fs } = asTheo(replies());
    expect(
      await createGroupAs(fs, {
        creatorId: 1,
        cohort: 'adult',
        memberIds: [2, 3],
        groupName: 'JR',
        now: 7,
      }),
    ).toEqual({
      id: 'G1',
      participantIds: ['1', '2', '3'],
    });
  });
});

describe('waitForStored (over drivers/poll-until)', () => {
  // pollUntil sleeps on the global setTimeout and reads Date.now: modern fake
  // timers drive both, so no test waits in real time.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('returns the first value accepted, after one read', async () => {
    let reads = 0;
    const v = await waitForStored(
      async () => {
        reads += 1;
        return 'x';
      },
      (x) => x === 'x',
      { timeoutMs: 1000, what: 'w' },
    );
    expect({ v, reads }).toEqual({ v: 'x', reads: 1 });
  });
  test('reads again after each poll until accepted', async () => {
    const seen = ['a', 'b', 'x'];
    const p = waitForStored(
      async () => seen.shift(),
      (x) => x === 'x',
      { timeoutMs: 5000, pollMs: 500, what: 'w' },
    );
    await jest.advanceTimersByTimeAsync(1500);
    await expect(p).resolves.toBe('x');
  });
  test('fails at the ceiling naming what it waited for and the last value', async () => {
    const p = waitForStored(
      async () => ({ '❤️': ['1'] }),
      () => false,
      { timeoutMs: 1000, pollMs: 500, what: "Theo's ❤️ on m1" },
    );
    const assertion = expect(p).rejects.toThrow(
      `Theo's ❤️ on m1: not stored within 1000 ms; last read {"❤️":["1"]}`,
    );
    await jest.advanceTimersByTimeAsync(2000);
    await assertion;
  });
  test('describes the last value with the given describer', async () => {
    const p = waitForStored(
      async () => ({ b: ['2'], a: ['1'] }),
      () => false,
      {
        timeoutMs: 500,
        pollMs: 250,
        what: 'w',
        describe: canonicalReactions,
      },
    );
    const assertion = expect(p).rejects.toThrow('last read {"a":["1"],"b":["2"]}');
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
  });
  test('a read that throws stops at once (no retry)', async () => {
    let reads = 0;
    await expect(
      waitForStored(
        async () => {
          reads += 1;
          throw new Error('HTTP 403');
        },
        () => true,
        { timeoutMs: 5000, what: 'w' },
      ),
    ).rejects.toThrow('HTTP 403');
    expect(reads).toBe(1);
  });
});
