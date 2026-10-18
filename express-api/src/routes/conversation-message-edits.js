/**
 * SHY-0614 — editing and recalling a private or group message. The phone
 * used to write both itself; now the server reads the stored message inside
 * a transaction, so history and recall records hold what was really said.
 *
 * PATCH /api/conversations/:id/messages/:messageId         { text } -> edit
 * POST  /api/conversations/:id/messages/:messageId/recall           -> recall
 */

const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');
const { now } = require('../utils/helpers');
const log = require('../utils/log');
const { decideEdit, decideRecall, historyLogFields } = require('../utils/message-history');
const { gateConversationWrite } = require('../utils/conversation-write-gate');

const refsFor = (conversationId, messageId) => ({
  conv: db.doc(`conversations/${conversationId}`),
  msg: db.doc(`conversations/${conversationId}/messages/${messageId}`),
});

/** The send route's refusals (participant, age gate, cohort); true when answered. */
async function gate(req, res, convRef, ageGate) {
  const snap = await convRef.get();
  if (!snap.exists) {
    res.status(404).json({ error: 'Conversation not found' });
    return true;
  }
  return gateConversationWrite(req, res, snap.data(), { ageGate });
}

router.patch('/conversations/:id/messages/:messageId', async (req, res) => {
  try {
    const { id, messageId } = req.params;
    const { conv, msg } = refsFor(id, messageId);
    if (await gate(req, res, conv, true)) return;
    const verdict = await db.runTransaction(async (tx) => {
      const [c, m] = await Promise.all([tx.get(conv), tx.get(msg)]);
      const v = decideEdit({
        conversation: c.exists ? c.data() : null,
        message: m.exists ? m.data() : null,
        callerId: req.auth.uniqueId,
        text: req.body?.text,
        now: now(),
      });
      if (v.ok && v.changed) {
        tx.set(msg.collection('edits').doc(), v.editEntry);
        tx.update(msg, { ...v.messageUpdate, editCount: FieldValue.increment(1) });
      }
      return v;
    });
    if (!verdict.ok) return res.status(verdict.status).json({ error: verdict.error });
    log.info(
      'conversations',
      'Message edited',
      historyLogFields({
        conversationId: id,
        messageId,
        callerId: req.auth.uniqueId,
        changed: verdict.changed,
      }),
    );
    return res.json({
      success: true,
      changed: verdict.changed,
      editedAt: verdict.messageUpdate?.editedAt,
    });
  } catch (err) {
    log.error('conversations', 'PATCH message failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/conversations/:id/messages/:messageId/recall', async (req, res) => {
  try {
    const { id, messageId } = req.params;
    const { conv, msg } = refsFor(id, messageId);
    if (await gate(req, res, conv, false)) return;
    const verdict = await db.runTransaction(async (tx) => {
      const [c, m] = await Promise.all([tx.get(conv), tx.get(msg)]);
      const v = decideRecall({
        conversation: c.exists ? c.data() : null,
        message: m.exists ? m.data() : null,
        callerId: req.auth.uniqueId,
        now: now(),
      });
      if (v.ok) {
        // create, not set: a record that already exists fails the commit, so
        // two racing recalls can never both write one.
        tx.create(msg.collection('recall').doc('record'), v.record);
        tx.update(msg, v.messageUpdate);
      }
      return v;
    });
    if (!verdict.ok) return res.status(verdict.status).json({ error: verdict.error });
    log.info(
      'conversations',
      'Message recalled',
      historyLogFields({ conversationId: id, messageId, callerId: req.auth.uniqueId }),
    );
    return res.json({ success: true });
  } catch (err) {
    log.error('conversations', 'POST recall failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
