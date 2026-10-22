'use strict';

/**
 * Firestore, written as one person, through the security rules (SHY-0645).
 *
 * Reactions and group creation have no API route: the app writes them
 * straight to Firestore. A journey whose second person is not on the phone
 * must write the same way, as that person, or it proves nothing about the
 * rules (the admin SDK skips them). This speaks Firestore's REST API with the
 * person's own ID token, so the rules judge every write exactly as they
 * judge the app's.
 *
 * Nothing here retries: a refusal is the finding, and it is thrown with the
 * HTTP status and Firestore's own message.
 */

const { pollUntil } = require('../drivers/poll-until');

class FirestoreRefusal extends Error {
  constructor({ op, path, who, status, code, message }) {
    super(`Firestore refused ${op} ${path} as ${who}: HTTP ${status} ${code}: ${message}`);
    this.name = 'FirestoreRefusal';
    this.op = op;
    this.path = path;
    this.who = who;
    this.status = status;
    this.code = code;
    this.firestoreMessage = message;
  }
}

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function encodeValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError(`cannot store ${v} in Firestore`);
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(encodeValue) } : {} };
  if (typeof v === 'object')
    return { mapValue: Object.keys(v).length ? { fields: encodeFields(v) } : {} };
  throw new TypeError(`cannot store a ${typeof v} in Firestore`);
}

function encodeFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, encodeValue(v)]));
}

function decodeValue(v) {
  if (!v || typeof v !== 'object')
    throw new TypeError(`not a Firestore value: ${JSON.stringify(v)}`);
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  throw new TypeError(`unhandled Firestore value: ${Object.keys(v).join(',')}`);
}

function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}

/**
 * A Firestore client for ONE person.
 *
 * `documentsUrl` ends in `/databases/(default)/documents`: the emulator's
 * (`http://localhost:8080/v1/projects/demo-shytalk/...`) or the real one's.
 */
function firestoreAsPerson({ documentsUrl, token, who, fetchImpl = fetch }) {
  const marker = '/v1/';
  const at = documentsUrl.indexOf(marker);
  if (at < 0 || !documentsUrl.endsWith('/documents')) {
    throw new Error(`not a Firestore documents URL: ${documentsUrl}`);
  }
  const root = documentsUrl.slice(at + marker.length);

  async function send(op, path, method, url, body) {
    const r = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!r.ok) {
      const e = json && typeof json === 'object' ? json.error : undefined;
      throw new FirestoreRefusal({
        op,
        path,
        who,
        status: r.status,
        code: e?.status ?? 'NO_STATUS',
        message: e?.message ?? text.slice(0, 200),
      });
    }
    if (json === null || typeof json !== 'object') {
      throw new Error(
        `Firestore answered ${op} ${path} as ${who} with HTTP ${r.status} and no JSON object: ${text.slice(0, 120)}`,
      );
    }
    return json;
  }

  return {
    who,
    docName: (path) => `${root}/${path}`,
    async get(path) {
      const j = await send('get', path, 'GET', `${documentsUrl}/${path}`);
      if (typeof j.name !== 'string' || typeof j.updateTime !== 'string') {
        throw new Error(
          `Firestore answered get ${path} as ${who} without a name and updateTime: ${JSON.stringify(j).slice(0, 120)}`,
        );
      }
      return {
        id: j.name.split('/').pop(),
        updateTime: j.updateTime,
        data: decodeFields(j.fields || {}),
      };
    },
    async create(collectionPath, data) {
      const j = await send('create', collectionPath, 'POST', `${documentsUrl}/${collectionPath}`, {
        fields: encodeFields(data),
      });
      if (typeof j.name !== 'string') {
        throw new Error(`Firestore answered create in ${collectionPath} as ${who} without a name`);
      }
      return { id: j.name.split('/').pop() };
    },
    commit: (label, writes) => send('commit', label, 'POST', `${documentsUrl}:commit`, { writes }),
  };
}

function setWrite(fs, path, data) {
  return { update: { name: fs.docName(path), fields: encodeFields(data) } };
}

function updateFieldsWrite(fs, path, data, { updateTime } = {}) {
  for (const k of Object.keys(data)) {
    if (!FIELD_NAME.test(k)) throw new Error(`field name needs quoting: ${k}`);
  }
  const w = {
    update: { name: fs.docName(path), fields: encodeFields(data) },
    updateMask: { fieldPaths: Object.keys(data) },
  };
  if (updateTime) w.currentDocument = { updateTime };
  return w;
}

function appendToArrayWrite(fs, path, field, value) {
  return {
    transform: {
      document: fs.docName(path),
      fieldTransforms: [
        { fieldPath: field, appendMissingElements: { values: [encodeValue(value)] } },
      ],
    },
  };
}

/** The app's toggle (PrivateMessageRepositoryImpl.toggleReaction), without mutating its input. */
function toggledReactions(reactions, emoji, uid) {
  const next = {};
  for (const [k, v] of Object.entries(reactions || {})) next[k] = [...v];
  const users = next[emoji] || [];
  if (users.includes(uid)) {
    const left = users.filter((u) => u !== uid);
    if (left.length) next[emoji] = left;
    else delete next[emoji];
  } else {
    next[emoji] = [...users, uid];
  }
  return next;
}

/** One reading of a reactions map, so two equal maps compare equal as text. */
function canonicalReactions(reactions) {
  const keys = Object.keys(reactions || {}).sort();
  return JSON.stringify(
    Object.fromEntries(keys.map((k) => [k, [...reactions[k]].map(String).sort()])),
  );
}

/** React (or take a reaction back) the way the app does: read, toggle, write pinned to that read. */
async function reactAs(fs, { conversationId, messageId, emoji, uid }) {
  const path = `conversations/${conversationId}/messages/${messageId}`;
  const doc = await fs.get(path);
  const next = toggledReactions(doc.data.reactions, emoji, String(uid));
  await fs.commit(path, [
    updateFieldsWrite(fs, path, { reactions: next }, { updateTime: doc.updateTime }),
  ]);
  return next;
}

/**
 * Make a group the way the app does (createGroupConversation): the creator
 * alone first, as the rules require, then each member in their own write so
 * the rules check each one's cohort, then the creator's userSettings row.
 *
 * Two differences from the app, both deliberate:
 *  - a refused member add stops here: a journey must not carry on with a
 *    group missing the person it is about;
 *  - only the creator's own userSettings row is written. The rules let a
 *    person write their own row or, as a group admin, anyone's; a new group
 *    has no admins, so the app's batch of every member's row looks refused
 *    (filed separately to prove). The server writes each recipient's row on
 *    every message send, so members need no row here.
 */
async function createGroupAs(fs, { creatorId, cohort, memberIds, groupName, now }) {
  const creator = String(creatorId);
  const members = memberIds.map(String);
  const { id } = await fs.create('conversations', {
    participantIds: [creator],
    isGroup: true,
    groupName,
    createdBy: creator,
    crossCohortAtMigration: false,
    createdAt: now,
    lastMessageAt: now,
    isClosed: false,
    groupAdminIds: [],
    groupModIds: [],
    modNotifyMode: 'ALL_ADMINS',
    cohort,
  });
  const path = `conversations/${id}`;
  for (const m of members) {
    await fs.commit(`${path} add ${m}`, [appendToArrayWrite(fs, path, 'participantIds', m)]);
  }
  await fs.commit(`${path}/userSettings/${creator}`, [
    setWrite(fs, `${path}/userSettings/${creator}`, { unreadCount: 0, userId: creator }),
  ]);
  return { id, participantIds: [creator, ...members] };
}

/**
 * Read a stored value until `accept` takes it, or fail at `timeoutMs` naming
 * `what` and the last value read. The polling is drivers/poll-until's (the
 * runner's one bounded poll); a read that throws stops at once.
 */
async function waitForStored(
  read,
  accept,
  { timeoutMs, pollMs = 500, what, describe = JSON.stringify },
) {
  const last = await pollUntil(read, accept, { intervalMs: pollMs, deadlineMs: timeoutMs });
  if (accept(last)) return last;
  throw new Error(`${what}: not stored within ${timeoutMs} ms; last read ${describe(last)}`);
}

module.exports = {
  FirestoreRefusal,
  encodeValue,
  encodeFields,
  decodeValue,
  decodeFields,
  firestoreAsPerson,
  setWrite,
  updateFieldsWrite,
  appendToArrayWrite,
  toggledReactions,
  canonicalReactions,
  reactAs,
  createGroupAs,
  waitForStored,
};
