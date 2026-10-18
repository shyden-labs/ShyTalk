/**
 * SHY-0631 — delete a document or collection and everything under it.
 *
 * Firestore never deletes a document's subcollections with it, so a hand-made
 * list of subcollection names keeps whatever it forgets: every list we had
 * forgot `messages/{id}/edits`, which holds the earlier text of an edited
 * message. `recursiveDelete` walks the whole tree instead.
 *
 * For a document, its subcollections go first and the document last, only
 * once they all went. `recursiveDelete(documentRef)` would delete the
 * document even after a failed child delete, leaving children that no query
 * on the parent's fields can find again; this way a failure leaves the
 * document, and whoever found it by a query (the nightly deletion run) finds
 * it again and deletes what is left.
 *
 * Its default BulkWriter retries a failed delete up to ten times. This one
 * never retries: a failure rejects the call and the caller's next run is the
 * recovery.
 *
 * Imports nothing, so a script with its own Firestore (`scripts/reset-data.mjs`)
 * can use it; a document is told from a collection by `listCollections`.
 *
 * @param {import('firebase-admin/firestore').Firestore} firestore
 * @param {import('firebase-admin/firestore').DocumentReference
 *   | import('firebase-admin/firestore').CollectionReference} ref
 * @returns {Promise<Record<string, number>>} documents deleted, keyed by the
 *   id of the collection each lived in (names only, never ids or content).
 *   A document root is counted even when it did not exist, because its delete
 *   is still issued.
 */
async function deleteTree(firestore, ref) {
  const counts = {};
  const writer = firestore.bulkWriter();
  writer.onWriteError(() => false);
  writer.onWriteResult((documentRef) => {
    const collection = documentRef.parent.id;
    counts[collection] = (counts[collection] || 0) + 1;
  });
  try {
    if (typeof ref.listCollections === 'function') {
      for (const subcollection of await ref.listCollections()) {
        await firestore.recursiveDelete(subcollection, writer);
      }
      const deleted = writer.delete(ref);
      await writer.flush();
      await deleted;
    } else {
      await firestore.recursiveDelete(ref, writer);
    }
  } finally {
    await writer.close();
  }
  return counts;
}

module.exports = { deleteTree };
