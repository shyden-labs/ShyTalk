/**
 * SHY-0631 — delete a document or collection and everything under it.
 *
 * Firestore never deletes a document's subcollections with it, so a hand-made
 * list of subcollection names keeps whatever it forgets: every list we had
 * forgot `messages/{id}/edits`, which holds the earlier text of an edited
 * message. `recursiveDelete` walks the whole tree instead.
 *
 * Its default BulkWriter retries a failed delete up to ten times. This one
 * never retries: a failure rejects the call (after the other deletes finish)
 * and the caller's next run is the recovery.
 *
 * @param {import('firebase-admin/firestore').Firestore} firestore
 * @param {import('firebase-admin/firestore').DocumentReference
 *   | import('firebase-admin/firestore').CollectionReference} ref
 * @returns {Promise<Record<string, number>>} documents deleted, keyed by the
 *   id of the collection each lived in (names only, never ids or content).
 *   A DocumentReference root is counted even when it did not exist, because
 *   its delete is still issued.
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
    await firestore.recursiveDelete(ref, writer);
  } finally {
    await writer.close();
  }
  return counts;
}

module.exports = { deleteTree };
