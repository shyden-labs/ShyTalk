/**
 * SHY-0631 — a conversation seeded with every subcollection the rules allow,
 * and a walker that lists whatever is left under a document.
 *
 * A seeded tree writes into the `messages`, `edits`, `userSettings`,
 * `settings`, `mutes` and `mod_log` groups; each suite lists those in its own
 * literal wipe array (the test-isolation guard reads wipes statically).
 */

/** Documents `seedConversationTree` writes under the conversation. */
const SEEDED_UNDER_COUNT = 8;

async function seedConversationTree(db, convId, conversationData) {
  const base = `conversations/${convId}`;
  await db.doc(base).set(conversationData);
  await db.doc(`${base}/messages/m1`).set({ text: 'hi', senderId: '1' });
  await db.doc(`${base}/messages/m1/edits/e1`).set({ previousText: 'hello' });
  await db.doc(`${base}/messages/m1/edits/e2`).set({ previousText: 'hey' });
  await db.doc(`${base}/messages/m2`).set({ text: 'second', senderId: '2' });
  await db.doc(`${base}/userSettings/u1`).set({ userId: '1' });
  await db.doc(`${base}/settings/s1`).set({ muted: false });
  await db.doc(`${base}/mutes/x1`).set({ muted: true });
  await db.doc(`${base}/mod_log/l1`).set({ action: 'warn' });
}

/** Every document path under `docPath`, sorted; `docPath` itself excluded. */
async function docsUnder(db, docPath) {
  const found = [];
  async function walk(docRef) {
    for (const col of await docRef.listCollections()) {
      // listDocuments includes "missing" documents that only hold
      // subcollections, so an orphaned `edits` under a deleted message is
      // still reached.
      const children = await col.listDocuments();
      if (children.length === 0) continue;
      // One read per collection, not one per document.
      for (const snap of await db.getAll(...children)) {
        if (snap.exists) found.push(snap.ref.path);
      }
      for (const child of children) await walk(child);
    }
  }
  await walk(db.doc(docPath));
  return found.sort();
}

module.exports = {
  SEEDED_UNDER_COUNT,
  seedConversationTree,
  docsUnder,
};
