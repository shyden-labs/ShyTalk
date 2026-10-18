/**
 * REAL Firestore security-rules tests for message history in
 * `conversations/{cid}/messages/{mid}` (SHY-0614), run against the Firestore
 * emulator via `@firebase/rules-unit-testing` (v5).
 *
 * Edits and recalls go through the server routes, which write honest history
 * in a transaction. These tests pin what the rules leave to phones: no direct
 * text, edit or recall change, no delete, no forged `edits` entry, no read or
 * write of the recall record (admins read it), a group admin hides only in
 * their own name and without touching the text, a participant reacts without
 * touching anything else, and `mod_log` is the server's alone.
 *
 * Requires the Firestore emulator (`FIRESTORE_EMULATOR_HOST`, default
 * `localhost:8080`): CI only.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const { firestoreHostPort, assertEmulatorReachable } = require('../helpers/firebase-emulator');

const RULES_PATH = join(__dirname, '..', '..', '..', 'firestore.rules');
const PROJECT_ID = `demo-shytalk-msg-history-rules-${process.env.JEST_WORKER_ID || '1'}`;

// uniqueId is a NUMBER in the claim, as Express mints it.
const A = { uid: 'fbuid-a', uniqueId: 60001 }; // the sender of m1
const B = { uid: 'fbuid-b', uniqueId: 60002 }; // a recipient
const G = { uid: 'fbuid-g', uniqueId: 60003 }; // the group admin
const OUT = { uid: 'fbuid-out', uniqueId: 60009 }; // not a participant
const ADMIN = { uid: 'fbuid-admin', uniqueId: 60100, admin: true };

const M1 = 'conversations/c1/messages/m1';

let testEnv;
const handles = new Map();

function as(persona) {
  const { uid, ...claims } = persona;
  if (!handles.has(uid)) {
    handles.set(uid, testEnv.authenticatedContext(uid, claims).firestore());
  }
  return handles.get(uid);
}

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data);
  });
}

beforeAll(async () => {
  await assertEmulatorReachable();
  const { host, port } = firestoreHostPort();
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port, rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  handles.clear();
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed('conversations/c1', {
    participantIds: ['60001', '60002', '60003'],
    groupAdminIds: ['60003'],
    groupModIds: [],
    isGroup: true,
  });
  await seed(M1, { senderId: '60001', text: 'hello', type: 'TEXT' });
  await seed(`${M1}/recall/record`, { text: 'gone' });
});

describe('message text, edit and recall fields — server only', () => {
  test('sender cannot change text directly', () =>
    assertFails(as(A).doc(M1).update({ text: 'bye' })));
  test('sender cannot set isEdited directly', () =>
    assertFails(as(A).doc(M1).update({ isEdited: true })));
  test('sender cannot set editedAt directly', () =>
    assertFails(as(A).doc(M1).update({ editedAt: 5 })));
  test('sender cannot set editCount directly', () =>
    assertFails(as(A).doc(M1).update({ editCount: 9 })));
  test('sender cannot recall directly', () =>
    assertFails(as(A).doc(M1).update({ isRecalled: true, text: '' })));
  test('sender cannot delete a message', () => assertFails(as(A).doc(M1).delete()));
});

describe('edits history — server only, old entries still readable', () => {
  test('sender cannot write an edits entry on own message', () =>
    assertFails(as(A).doc(`${M1}/edits/e1`).set({ previousText: 'x', editedAt: 1 })));
  test("participant cannot write an edits entry on another's message", () =>
    assertFails(as(B).doc(`${M1}/edits/e2`).set({ previousText: 'abuse', editedAt: 1 })));
  test('ALLOW a participant reads an old-shape edits entry', async () => {
    await seed(`${M1}/edits/old1`, { previousText: 'v0', editedAt: 1 });
    await assertSucceeds(as(B).doc(`${M1}/edits/old1`).get());
  });
});

describe('recall record — admins read, nobody writes', () => {
  test('participant cannot read the recall record', () =>
    assertFails(as(B).doc(`${M1}/recall/record`).get()));
  test('sender cannot read the recall record', () =>
    assertFails(as(A).doc(`${M1}/recall/record`).get()));
  test('ALLOW admin reads the recall record', () =>
    assertSucceeds(as(ADMIN).doc(`${M1}/recall/record`).get()));
  test('nobody can write the recall record', () =>
    assertFails(as(ADMIN).doc(`${M1}/recall/record`).set({ text: 'y' })));
});

describe('group admin hiding — own name only, text untouched', () => {
  test('group admin cannot hide naming someone else', () =>
    assertFails(as(G).doc(M1).update({ isHidden: true, hiddenBy: '60002' })));
  test('ALLOW group admin hides naming themself', () =>
    assertSucceeds(as(G).doc(M1).update({ isHidden: true, hiddenBy: '60003' })));
  test('group admin cannot change text while hiding', () =>
    assertFails(as(G).doc(M1).update({ isHidden: true, hiddenBy: '60003', text: 'x' })));
});

describe('reactions — participants only, nothing else changes', () => {
  test('ALLOW a recipient reacts', () =>
    assertSucceeds(
      as(B)
        .doc(M1)
        .update({ reactions: { '👍': ['60002'] } }),
    ));
  test('a reaction cannot carry a text change', () =>
    assertFails(
      as(B)
        .doc(M1)
        .update({ reactions: { '👍': ['60002'] }, text: 'x' }),
    ));
  test('an outsider cannot react', () =>
    assertFails(
      as(OUT)
        .doc(M1)
        .update({ reactions: { '👍': ['60009'] } }),
    ));
});

describe('mod_log — server only', () => {
  test('group admin cannot write mod_log', () =>
    assertFails(as(G).doc('conversations/c1/mod_log/l1').set({ action: 'mute' })));
});
