/**
 * SHY-0614 — what editing or recalling a private or group message may do,
 * decided from the stored documents alone. No I/O: the routes run these
 * inside a Firestore transaction, so the stored text, never the request, is
 * what history records.
 */

const MAX_TEXT_LENGTH = 2000;
const EDITABLE_TYPE = 'TEXT';

const refuse = (status, error) => ({ ok: false, status, error });

/** Checks shared by edit and recall; returns a refusal or null. */
function refuseCommon({ conversation, message, callerId }) {
  if (!conversation) return refuse(404, 'Conversation not found');
  if (conversation.crossCohortAtMigration === true) return refuse(404, 'Not found');
  const participants = (conversation.participantIds || []).map(String);
  if (!participants.includes(String(callerId))) return refuse(404, 'Not found');
  if (!message) return refuse(404, 'Message not found');
  return null;
}

function decideEdit({ conversation, message, callerId, text, now }) {
  if (typeof text !== 'string' || text.trim() === '') return refuse(400, 'text required');
  const common = refuseCommon({ conversation, message, callerId });
  if (common) return common;
  if (String(message.senderId) !== String(callerId)) {
    return refuse(403, 'Only the sender can edit this message');
  }
  if (message.isRecalled === true) return refuse(409, 'Message was recalled');
  if ((message.type || EDITABLE_TYPE) !== EDITABLE_TYPE) {
    return refuse(422, 'Only text messages can be edited');
  }
  const newText = text.slice(0, MAX_TEXT_LENGTH);
  if (newText === message.text) return { ok: true, changed: false };
  return {
    ok: true,
    changed: true,
    editEntry: {
      previousText: message.text ?? '',
      editedAt: now,
      editorId: String(callerId),
      source: 'server',
    },
    messageUpdate: { text: newText, isEdited: true, editedAt: now },
  };
}

function decideRecall({ conversation, message, callerId, now }) {
  const common = refuseCommon({ conversation, message, callerId });
  if (common) return common;
  if (String(message.senderId) !== String(callerId)) {
    return refuse(403, 'Only the sender can recall this message');
  }
  if (message.isRecalled === true) return refuse(409, 'Message already recalled');
  const record = {
    text: message.text ?? '',
    type: message.type || EDITABLE_TYPE,
    recalledAt: now,
    recalledBy: String(callerId),
    source: 'server',
  };
  if (Array.isArray(message.imageUrls)) record.imageUrls = message.imageUrls;
  return { ok: true, record, messageUpdate: { isRecalled: true, text: '' } };
}

/** What a route logs about an edit or recall: ids and caller, never text. */
function historyLogFields({ conversationId, messageId, callerId, changed }) {
  const fields = { conversationId, messageId, callerId: String(callerId) };
  if (changed !== undefined) fields.changed = changed;
  return fields;
}

module.exports = { decideEdit, decideRecall, historyLogFields, MAX_TEXT_LENGTH };
