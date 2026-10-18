/**
 * Conversation routes - private messaging.
 *
 * GET  /api/conversations/:id/messages -> Get conversation messages
 * POST /api/conversations/:id/messages -> Send message (with FCM push + RTDB broadcast)
 */

const router = require('express').Router();
const { db, rtdb, FieldValue } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');
const { sendPushToUser } = require('../utils/fcm');
const { cohortFromClaim, effectiveCohort } = require('../utils/firebase-claims');
const { checkSuspension } = require('../middleware/auth');
const {
  gateConversationWrite,
  gateCrossCohortConversation,
} = require('../utils/conversation-write-gate');
const log = require('../utils/log');
const { openStream } = require('../utils/sse');

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 200;
const MAX_TEXT_LENGTH = 2000;
const MAX_IMAGES_PER_MESSAGE = 10;
const MAX_SENDER_NAME_LENGTH = 50;
const VALID_MESSAGE_TYPES = ['TEXT', 'IMAGE', 'STICKER', 'ROOM_INVITE', 'MOD_ACTION'];

/**
 * Build a plain message object from a Firestore message doc.
 */
function buildMessage(doc) {
  return {
    id: doc.id,
    messageId: doc.id,
    senderId: doc.senderId || '',
    senderName: doc.senderName || '',
    text: doc.text || '',
    imageUrls: doc.imageUrls || [],
    type: doc.type || 'TEXT',
    createdAt: doc.createdAt || 0,
    editedAt: doc.editedAt || null,
    editCount: doc.editCount || 0,
    replyToMessageId: doc.replyToId || doc.replyToMessageId || null,
    replyToText: doc.replyToText || null,
    replyToSenderName: doc.replyToSenderName || null,
    stickerUrl: doc.stickerUrl || null,
    roomInviteId: doc.roomInviteId || null,
    roomInviteName: doc.roomInviteName || null,
    reactions: doc.reactions || {},
    isRecalled: !!doc.isRecalled,
    isHidden: !!doc.isHidden,
    hiddenBy: doc.hiddenBy || null,
  };
}

/** Check if the current time falls within a user's DND schedule. */
function isInDndPeriod(user) {
  if (!user.dndEnabled) return false;
  const utcNow = new Date();
  const currentMinutes = utcNow.getUTCHours() * 60 + utcNow.getUTCMinutes();
  const dndStart = (user.dndStartHour || 0) * 60 + (user.dndStartMinute || 0);
  const dndEnd = (user.dndEndHour || 0) * 60 + (user.dndEndMinute || 0);

  if (dndStart <= dndEnd) {
    return currentMinutes >= dndStart && currentMinutes < dndEnd;
  }
  return currentMinutes >= dndStart || currentMinutes < dndEnd;
}

/** Determine if a recipient should receive a notification. */
function shouldNotifyRecipient(user, settings) {
  if (!user) return false;
  if (user.pmNotificationsEnabled === false) return false;
  if (isInDndPeriod(user)) return false;
  if (settings?.isMuted) return false;
  // SHY-0496: a migrated device appears ONLY in fcmInstallationIds. Checking
  // fcmTokens alone made this return false for every upgraded user, so their
  // DM notifications stopped -- silently, because "should not notify" is
  // indistinguishable from "notified successfully" downstream.
  const reachable = (user.fcmTokens?.length ?? 0) > 0 || (user.fcmInstallationIds?.length ?? 0) > 0;
  if (!reachable) return false;
  return true;
}

/**
 * Send FCM push notifications to conversation participants (except sender).
 * Uses batch Firestore reads to minimize read cost.
 */
async function sendMessageNotifications(
  conversationId,
  senderId,
  senderName,
  previewText,
  type,
  recipients,
  isGroup,
  groupName,
) {
  try {
    if (recipients.length === 0) return;

    const userRefs = recipients.map((p) => db.doc(`users/${p.userId}`));
    const settingsRefs = recipients.map((p) =>
      db.doc(`conversations/${conversationId}/userSettings/${p.userId}`),
    );

    const [userSnaps, settingsSnaps] = await Promise.all([
      db.getAll(...userRefs),
      db.getAll(...settingsRefs),
    ]);

    const usersById = {};
    for (const snap of userSnaps) {
      if (snap.exists) usersById[snap.id] = snap.data();
    }
    const settingsById = {};
    for (const snap of settingsSnaps) {
      if (snap.exists) settingsById[snap.id] = snap.data();
    }

    for (const p of recipients) {
      const recipientId = p.userId;
      const user = usersById[recipientId];
      const settings = settingsById[recipientId];

      if (!shouldNotifyRecipient(user, settings)) continue;

      const showPreview = user.pmNotificationPreview !== false;
      const data = {
        type: 'PM',
        senderId,
        senderName: isGroup ? `${senderName} (${groupName || 'Group'})` : senderName,
        messageText: showPreview ? previewText : 'New message',
        conversationId,
        isGroup: String(isGroup),
        showPreview: String(showPreview),
      };

      await sendPushToUser(recipientId, data, {
        userData: user,
        senderUniqueId: senderId,
        recipientUniqueId: recipientId,
      });
    }
  } catch (err) {
    log.error('conversations', 'Failed to send message notifications', {
      conversationId,
      error: err.message,
    });
  }
}

/** Broadcast a conversation event via RTDB. */
async function broadcastToConversation(conversationId, data) {
  try {
    await rtdb.ref(`conversations/${conversationId}/events/lastEvent`).set({
      type: data.type,
      ts: Date.now(),
    });
  } catch (err) {
    log.error('conversations', 'Failed to write RTDB event', {
      conversationId,
      error: err.message,
    });
  }
}

// -- Get messages --
// -- The conversation READ path (SHY-0458) --
//
// These exist because the client used to read conversations straight from
// Firestore, and could not. `firestore.rules:355` dereferences
// `resource.data.participantIds`, so reading a conversation that does not exist
// YET is a rules EVALUATION ERROR rather than a miss:
//
//   GET /conversations/50000010_50000020 -> 403
//     "evaluation error at L355:21 for 'get' @ L355, Null value error."
//
// `getOrCreateConversation` opens with exactly that read, so no conversation
// could ever be created and every first message was silently dropped. Deciding
// this server-side also puts it where every other authorization decision in
// this app already lives (EPIC-0006).

const DEFAULT_CONVERSATION_LIMIT = 50;
const MAX_CONVERSATION_LIMIT = 200;

/**
 * Orders two id strings deterministically, by code unit.
 *
 * Sonar's S2871 asks for an explicit comparator on `.sort()` and suggests
 * `localeCompare`. Taking that suggestion here would be a defect: these sorts
 * decide a conversation's IDENTITY, and iOS, Android and the server must all
 * compute the same one. `localeCompare` is locale-dependent, so the same pair
 * of people could resolve to different threads on two devices. Code-unit order
 * is what the clients already use, and it is the same everywhere.
 */
const byCodeUnit = (a, b) => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/** The id the clients already generate: both ids sorted, joined with "_". */
function conversationIdFor(a, b) {
  return [String(a), String(b)].sort(byCodeUnit).join('_');
}

// -- List the caller's conversations --
router.get('/conversations', async (req, res) => {
  try {
    // participantIds are stored as STRINGS; req.auth.uniqueId is a NUMBER.
    // Same coercion the message routes already document.
    const callerId = String(req.auth.uniqueId);
    const limit = Math.min(
      Number.parseInt(req.query.limit, 10) || DEFAULT_CONVERSATION_LIMIT,
      MAX_CONVERSATION_LIMIT,
    );

    const snap = await db
      .collection('conversations')
      .where('participantIds', 'array-contains', callerId)
      .orderBy('lastMessageAt', 'desc')
      .limit(limit)
      .get();

    // Filtered HERE rather than with a `where` on the flag: a query filter also
    // drops documents that simply lack the field, which is every conversation
    // written before the migration backfill. UK OSA #17 — threads frozen at
    // migration stay hidden either way.
    const conversations = snap.docs
      .map((d) => ({ ...d.data(), id: d.id }))
      .filter((c) => c.crossCohortAtMigration !== true);

    return res.json(conversations);
  } catch (err) {
    log.error('conversations', 'Failed to list conversations', {
      callerId: req.auth?.uniqueId,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Live conversation list over SSE (SHY-0169) --
//
// The replacement for the client's own Firestore listener. The server holds the
// listener with the Admin SDK and fans out; the client subscribes to an
// ordinary authed route, so who may see what is decided here rather than by
// rules evaluated on a phone (EPIC-0006).
//
// Authorization is re-checked PER FAN-OUT, not only at subscribe. A stream is a
// single request, so `authMiddleware` runs its suspension check once and then
// never again for the life of a connection that may last hours — without the
// re-check, suspending somebody would not stop their messages arriving.
router.get('/conversations/stream', async (req, res) => {
  const callerId = String(req.auth.uniqueId);
  const stream = openStream(req, res);

  const deliver = async (conversations) => {
    // Re-checked every time. `checkSuspension` is the same function the auth
    // middleware uses, cache and all.
    if (await checkSuspension(callerId)) {
      log.info('conversations', 'Closing stream for suspended caller', { callerId });
      stream.send('closed', { reason: 'suspended' });
      stream.close();
      return;
    }
    stream.send('conversations', conversations);
  };

  try {
    const query = db
      .collection('conversations')
      .where('participantIds', 'array-contains', callerId)
      .orderBy('lastMessageAt', 'desc')
      .limit(DEFAULT_CONVERSATION_LIMIT);

    const unsubscribe = query.onSnapshot(
      (snap) => {
        const conversations = snap.docs
          .map((d) => ({ ...d.data(), id: d.id }))
          .filter((c) => c.crossCohortAtMigration !== true);
        // Deliberately not awaited: onSnapshot is a sync callback, and an
        // unhandled rejection here would take the process down.
        deliver(conversations).catch((err) =>
          log.error('conversations', 'Stream delivery failed', {
            callerId,
            error: err.message,
          }),
        );
      },
      (err) => {
        log.error('conversations', 'Stream listener failed', { callerId, error: err.message });
        stream.send('error', { error: 'stream failed' });
        stream.close();
      },
    );

    // The expensive half. Released when the phone goes away, or it lives for
    // the life of the process.
    stream.onClose(() => {
      try {
        unsubscribe();
      } catch (err) {
        log.error('conversations', 'Failed to detach stream listener', { error: err.message });
      }
    });
  } catch (err) {
    log.error('conversations', 'Failed to open conversation stream', {
      callerId,
      error: err.message,
    });
    stream.send('error', { error: 'stream failed' });
    stream.close();
  }
});

// -- Get or create the 1:1 conversation with another person --
router.post('/conversations', async (req, res) => {
  try {
    const callerId = String(req.auth.uniqueId);
    const raw = req.body?.otherUserId;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return res.status(400).json({ error: 'otherUserId required' });
    }
    const otherId = String(raw).trim();

    if (otherId === callerId) {
      return res.status(400).json({ error: 'Cannot start a conversation with yourself' });
    }

    const otherSnap = await db.doc(`users/${otherId}`).get();
    if (!otherSnap.exists) return res.status(404).json({ error: 'User not found' });
    const other = otherSnap.data() || {};

    // Cohort gate, server-side. 404 rather than 403 so a refusal does not
    // confirm that the account exists — the same posture the read gate takes.
    //
    // SHY-0468: this read `req.auth.cohort`, which `authMiddleware` never
    // sets — the claim lives at `req.auth.token.cohort`. `callerCohort` was
    // therefore always undefined, the `&&` short-circuited, and the gate
    // passed EVERY caller: an adult could open a thread with a minor. The
    // second half was the same shape of hole, one step along — a target whose
    // `cohort` field was missing also skipped the check.
    //
    // Both sides now use the resolvers the rest of the codebase already uses
    // (`sameCohort.js`, `config.js`, `livekit.js`). Each falls back to
    // 'minor' rather than to "unknown", so a stripped claim or an absent
    // field restricts the caller instead of freeing them, and
    // `effectiveCohort` honours an admin `cohortOverride` the raw field
    // ignores.
    const callerCohort = cohortFromClaim(req);
    const otherCohort = effectiveCohort(other);
    if (otherCohort !== callerCohort) {
      log.info('conversations', 'Refused cross-cohort conversation', {
        callerId,
        otherId,
        callerCohort,
        otherCohort,
      });
      return res.status(404).json({ error: 'User not found' });
    }

    const conversationId = conversationIdFor(callerId, otherId);
    const existing = await db.doc(`conversations/${conversationId}`).get();
    if (existing.exists) {
      return res.json({ ...existing.data(), id: conversationId });
    }

    const timestamp = now();
    const doc = {
      participantIds: [callerId, otherId].sort(byCodeUnit),
      isGroup: false,
      crossCohortAtMigration: false,
      createdAt: timestamp,
      lastMessageAt: timestamp,
    };
    await db.doc(`conversations/${conversationId}`).set(doc);
    log.info('conversations', 'Created conversation', { conversationId, callerId, otherId });
    return res.json({ ...doc, id: conversationId });
  } catch (err) {
    log.error('conversations', 'Failed to get or create conversation', {
      callerId: req.auth?.uniqueId,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    // Verify the requester is a participant
    const convSnap = await db.doc(`conversations/${req.params.id}`).get();
    if (!convSnap.exists) return res.status(404).json({ error: 'Conversation not found' });
    const conv = convSnap.data();
    const participantIds = conv.participantIds || [];
    if (!participantIds.map(String).includes(String(req.auth.uniqueId))) {
      return res.status(403).json({ error: 'Not a participant of this conversation' });
    }

    if (await gateCrossCohortConversation(req, res, conv)) return;

    const limit = Math.min(
      Number.parseInt(req.query.limit, 10) || DEFAULT_MESSAGE_LIMIT,
      MAX_MESSAGE_LIMIT,
    );

    const snap = await db
      .collection(`conversations/${req.params.id}/messages`)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    // Spread the payload BEFORE writing the trusted doc-ref id, so that a
    // same-named `id` field in the stored message data (whether from a
    // future schema migration or an adversarial Firestore write) cannot
    // override the doc's true identity in the response. buildMessage
    // below reads `doc.id`, so a payload-supplied id would otherwise
    // propagate all the way to the JSON sent to the client.
    const messages = snap.docs.map((d) => ({ ...d.data(), id: d.id }));

    // Return in chronological order (oldest first)
    return res.json(messages.toReversed().map(buildMessage));
  } catch (err) {
    log.error('conversations', 'Failed to fetch messages', {
      conversationId: req.params.id,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Send message --
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid body' });

    const conversationId = req.params.id;
    const messageId = generateId();
    const timestamp = now();
    const type = body.type || 'TEXT';
    const senderId = uniqueId;
    const senderName = (body.senderName || '').slice(0, MAX_SENDER_NAME_LENGTH);
    const text = (body.text || '').slice(0, MAX_TEXT_LENGTH);

    // Validate message type
    if (!VALID_MESSAGE_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid message type' });
    }

    // Validate imageUrls count
    const imageUrls = Array.isArray(body.imageUrls)
      ? body.imageUrls.slice(0, MAX_IMAGES_PER_MESSAGE)
      : [];

    log.info('conversations', 'Sending message', { conversationId, senderId, type });

    // Build preview text for lastMessage
    let previewText = text;
    if (type === 'IMAGE') previewText = '[Image]';
    else if (type === 'STICKER') previewText = '[Sticker]';
    else if (type === 'ROOM_INVITE') previewText = '[Room Invite]';

    // Read conversation to get participant list and group info
    const convSnap = await db.doc(`conversations/${conversationId}`).get();
    if (!convSnap.exists) return res.status(404).json({ error: 'Conversation not found' });
    const convDoc = convSnap.data();
    if (!convDoc) return res.status(500).json({ error: 'Corrupted conversation data' });

    // Participant check, SHY-0060 DM age gate and cohort gate: one home
    // shared with the edit and recall routes (SHY-0614).
    if (await gateConversationWrite(req, res, convDoc, { ageGate: true })) return;

    const participantIds = convDoc.participantIds || [];

    // Same String/Number coercion as gateConversationWrite's participant check — without it a
    // String-typed participantIds array never filters out the Number senderId,
    // so the sender would be counted as their own recipient (self-unread +
    // self-notify). Recipient ids feed userSettings doc paths (coercion-safe).
    const recipientIds = participantIds.map(String).filter((pid) => pid !== String(senderId));
    const isGroup = !!convDoc.isGroup;
    const groupName = convDoc.groupName || null;

    const msgData = {
      senderId,
      senderName,
      text,
      type,
      imageUrls,
      stickerUrl: body.stickerUrl || null,
      roomInviteId: body.roomInviteId || null,
      roomInviteName: body.roomInviteName || null,
      replyToId: body.replyToMessageId || null,
      replyToText: body.replyToText || null,
      replyToSenderName: body.replyToSenderName || null,
      reactions: {},
      isRecalled: false,
      isHidden: false,
      hiddenBy: null,
      editCount: 0,
      editedAt: null,
      createdAt: timestamp,
    };

    // Batch: write message + update conversation lastMessage + increment unread counts
    const lastMessage = { text: previewText, senderId, senderName, type, createdAt: timestamp };
    const batch = db.batch();

    batch.set(db.doc(`conversations/${conversationId}/messages/${messageId}`), msgData);
    batch.set(
      db.doc(`conversations/${conversationId}`),
      {
        lastMessage,
        lastMessageAt: timestamp,
      },
      { merge: true },
    );

    // Increment unread counts for all recipients (set+merge in case doc doesn't exist yet)
    for (const pid of recipientIds) {
      batch.set(
        db.doc(`conversations/${conversationId}/userSettings/${pid}`),
        {
          unreadCount: FieldValue.increment(1),
        },
        { merge: true },
      );
    }

    await batch.commit();

    // Un-hide conversation for all recipients (fire-and-forget)
    Promise.all(
      recipientIds.map((pid) =>
        db
          .doc(`conversations/${conversationId}/userSettings/${pid}`)
          .set({ isHidden: false }, { merge: true }),
      ),
    ).catch((err) =>
      log.error('conversations', 'Failed to un-hide for recipients', {
        conversationId,
        error: err.message,
      }),
    );

    // FCM notifications + RTDB broadcast (fire-and-forget)
    const recipients = recipientIds.map((id) => ({ userId: id }));
    sendMessageNotifications(
      conversationId,
      senderId,
      senderName,
      previewText,
      type,
      recipients,
      isGroup,
      groupName,
    ).catch((err) =>
      log.error('conversations', 'Failed to send notifications', {
        conversationId,
        error: err.message,
      }),
    );

    broadcastToConversation(conversationId, { type: 'new_message' }).catch((err) =>
      log.error('conversations', 'Failed to broadcast event', {
        conversationId,
        error: err.message,
      }),
    );

    // Spread msgData BEFORE the trusted server-generated `id` so that
    // an `id` field never wins from the spread side — defensive
    // ordering for the day msgData gains an `id` field via a future
    // schema migration. `replyToMessageId` is also written last so it
    // overrides msgData.replyToMessageId if present (the explicit
    // rewrite from `replyToId` is the canonical name).
    return res.json(
      buildMessage({ ...msgData, id: messageId, replyToMessageId: msgData.replyToId }),
    );
  } catch (err) {
    log.error('conversations', 'Failed to send message', {
      conversationId: req.params.id,
      senderId: req.auth?.uniqueId,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
