/**
 * SHY-0614 — the edit and recall routes, against the Firestore and Auth
 * emulators (CI): history and recall records hold what the server read, not
 * what the phone said, and every refusal writes nothing.
 *
 * The decisions themselves (blank text, cut text, old messages with no type,
 * numeric sender ids, 404/409/422) are unit-tested in
 * `tests/unit/message-history.test.js`; this file proves the route wiring:
 * auth, the shared write gate, and the transaction.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { authMiddleware } = require('../../src/middleware/auth');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const editsRouter = require('../../src/routes/conversation-message-edits');

// Per-file uniqueId prefix so parallel suites cannot collide in the shared
// emulator (641xxxxx is used by no other file).
const ANA = 64100001; // the sender
const BEN = 64100002; // the other participant

const CONV = 'c-shy0614';
const MSG_DOC = `conversations/${CONV}/messages/m1`;
const MSG_PATH = `/api/conversations/${CONV}/messages/m1`;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', editsRouter);
  return app;
}

// A group conversation, so the runtime cohort gate and the DM age gate do not
// apply: these tests are about the history, not the gates' own rules.
const seedConv = (over = {}) =>
  db.doc(`conversations/${CONV}`).set({
    participantIds: [String(ANA), String(BEN)],
    isGroup: true,
    ...over,
  });
const seedMsg = (over = {}) =>
  db.doc(MSG_DOC).set({ senderId: String(ANA), type: 'TEXT', createdAt: 1, ...over });

const storedMsg = async () => (await db.doc(MSG_DOC).get()).data();
const storedEdits = async () =>
  (await db.collection(`${MSG_DOC}/edits`).get()).docs.map((d) => d.data());
const storedRecall = async () => (await db.doc(`${MSG_DOC}/recall/record`).get()).data();

let ana;
let ben;

beforeAll(assertEmulatorReachable);

afterAll(async () => {
  await Promise.all([db.doc(`users/${ANA}`).delete(), db.doc(`users/${BEN}`).delete()]);
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  clearAuthCaches();
  await db.recursiveDelete(db.doc(`conversations/${CONV}`));
  ana = await mintRealUser({ uniqueId: ANA, cohort: 'adult', extraUserData: { cohort: 'adult' } });
  ben = await mintRealUser({ uniqueId: BEN, cohort: 'adult', extraUserData: { cohort: 'adult' } });
});

afterEach(() => db.recursiveDelete(db.doc(`conversations/${CONV}`)));

describe('PATCH /api/conversations/:id/messages/:messageId', () => {
  test('an edit saves the stored text as history and updates the message', async () => {
    await seedConv();
    await seedMsg({ text: 'hello' });

    const res = await request(createApp())
      .patch(MSG_PATH)
      .set(ana.headers)
      .send({ text: 'hello there' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, changed: true });
    const stored = await storedMsg();
    expect(stored).toMatchObject({ text: 'hello there', isEdited: true, editCount: 1 });
    expect(res.body.editedAt).toBe(stored.editedAt);
    expect(await storedEdits()).toEqual([
      { previousText: 'hello', editedAt: stored.editedAt, editorId: String(ANA), source: 'server' },
    ]);
  });

  test('a forged previousText in the body is ignored', async () => {
    await seedConv();
    await seedMsg({ text: 'hello' });

    await request(createApp())
      .patch(MSG_PATH)
      .set(ana.headers)
      .send({ text: 'x', previousText: 'made up' });

    const [entry] = await storedEdits();
    expect(entry.previousText).toBe('hello');
  });

  test('two edits at once both land in history and neither loses the other', async () => {
    await seedConv();
    await seedMsg({ text: 'v0' });

    await Promise.all([
      request(createApp()).patch(MSG_PATH).set(ana.headers).send({ text: 'v1' }),
      request(createApp()).patch(MSG_PATH).set(ana.headers).send({ text: 'v2' }),
    ]);

    // Not ordered by editedAt: two transactions can share a millisecond. The
    // property is that the second edit saved the FIRST edit's text, so 'v0'
    // appears once and the other entry holds whichever edit won the race.
    const previous = (await storedEdits()).map((e) => e.previousText);
    const final = await storedMsg();
    expect(previous).toHaveLength(2);
    expect(previous.filter((p) => p === 'v0')).toHaveLength(1);
    const firstWinner = previous.find((p) => p !== 'v0');
    expect(['v1', 'v2']).toContain(firstWinner);
    expect(final.text).toBe(firstWinner === 'v1' ? 'v2' : 'v1');
    expect(final.editCount).toBe(2);
  });

  test("Ben cannot edit Ana's message (403) and nothing is written", async () => {
    await seedConv();
    await seedMsg({ text: 'hello' });

    const res = await request(createApp())
      .patch(MSG_PATH)
      .set(ben.headers)
      .send({ text: 'framed' });

    expect(res.status).toBe(403);
    expect((await storedMsg()).text).toBe('hello');
    expect(await storedEdits()).toEqual([]);
  });

  test('a suspended sender is refused by the auth middleware (403)', async () => {
    await seedConv();
    await seedMsg({ text: 'hello' });
    await db.doc(`users/${ANA}`).update({ isSuspended: true });
    clearAuthCaches();

    const res = await request(createApp()).patch(MSG_PATH).set(ana.headers).send({ text: 'x' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Account suspended');
    expect((await storedMsg()).text).toBe('hello');
  });

  test('a flagged conversation answers 404 and nothing is written', async () => {
    await seedConv({ crossCohortAtMigration: true });
    await seedMsg({ text: 'hello' });

    const res = await request(createApp()).patch(MSG_PATH).set(ana.headers).send({ text: 'x' });

    expect(res.status).toBe(404);
    expect((await storedMsg()).text).toBe('hello');
    expect(await storedEdits()).toEqual([]);
  });
});

describe('POST /api/conversations/:id/messages/:messageId/recall', () => {
  test('a recall keeps the text for admins and blanks the message', async () => {
    await seedConv();
    await seedMsg({ text: 'you are stupid' });

    const res = await request(createApp()).post(`${MSG_PATH}/recall`).set(ana.headers);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await storedMsg()).toMatchObject({ isRecalled: true, text: '' });
    expect(await storedRecall()).toMatchObject({
      text: 'you are stupid',
      recalledBy: String(ANA),
      source: 'server',
    });
  });

  test('a second recall answers 409 and leaves the record alone', async () => {
    await seedConv();
    await seedMsg({ text: 'hello' });
    await request(createApp()).post(`${MSG_PATH}/recall`).set(ana.headers);
    const first = await storedRecall();

    const res = await request(createApp()).post(`${MSG_PATH}/recall`).set(ana.headers);

    expect(res.status).toBe(409);
    expect(await storedRecall()).toEqual(first);
  });

  test('an edit racing a recall never leaves an edited recalled message', async () => {
    await seedConv();
    await seedMsg({ text: 'hi' });

    await Promise.all([
      request(createApp()).patch(MSG_PATH).set(ana.headers).send({ text: 'edited' }),
      request(createApp()).post(`${MSG_PATH}/recall`).set(ana.headers),
    ]);

    expect(await storedMsg()).toMatchObject({ isRecalled: true, text: '' });
    expect(['hi', 'edited']).toContain((await storedRecall()).text);
  });
});
