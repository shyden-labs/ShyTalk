/* eslint-disable no-console */
/**
 * SHY-0631 one-off: delete message history whose message or conversation is
 * gone. Deleting a conversation by a hand-made list of subcollections left
 * `messages/{id}/edits` behind, with the earlier text of every edited message.
 *
 * Dry run (counts only, nothing deleted):
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json FIREBASE_DATABASE_URL=... \
 *     node scripts/delete-orphaned-message-history.js
 * Delete, then count again (exit 1 if anything orphaned remains):
 *   ... node scripts/delete-orphaned-message-history.js --apply --project <projectId>
 *
 * `--project` must equal the credential's project, so a command copied from
 * one environment cannot delete in another. Reads document names only
 * (`select()`), never text, and prints numbers only.
 *
 * Every run first plants one orphan of its own (SENTINEL_PATH, an edit under a
 * conversation that does not exist) and fails unless the scan finds it, so a
 * count of zero is never a blind scan. The sentinel is left out of the printed
 * counts and removed before the run ends, even when it fails (Shyden,
 * 2026-10-18: dev and production alike).
 */
const { deleteTree } = require('../src/utils/delete-tree');

/** Collection-group names that hold a message's history. */
const HISTORY_GROUPS = ['edits', 'recall'];

/** A conversation id no real conversation can have, and the orphan planted under it. */
// Not __...__: Firestore reserves ids of that shape and refuses the write.
const SENTINEL_CONVERSATION = 'conversations/shy-0631-orphan-sentinel';
const SENTINEL_PATH = `${SENTINEL_CONVERSATION}/messages/m/edits/e`;

/** Documents read per `getAll` call. */
const READ_GROUP_SIZE = 100;

/**
 * `conversations/{c}/messages/{m}/{edits|recall}/{id}` -> its parents.
 * @returns {{ conversation: string, message: string } | null} null for any other shape
 */
function parentsOf(path) {
  const parts = path.split('/');
  if (
    parts.length !== 6 ||
    parts[0] !== 'conversations' ||
    parts[2] !== 'messages' ||
    !HISTORY_GROUPS.includes(parts[4])
  ) {
    return null;
  }
  return { conversation: parts.slice(0, 2).join('/'), message: parts.slice(0, 4).join('/') };
}

/** path -> whether that document exists, read READ_GROUP_SIZE at a time. */
async function existence(firestore, paths) {
  const result = new Map();
  for (let i = 0; i < paths.length; i += READ_GROUP_SIZE) {
    const refs = paths.slice(i, i + READ_GROUP_SIZE).map((path) => firestore.doc(path));
    for (const snap of await firestore.getAll(...refs)) result.set(snap.ref.path, snap.exists);
  }
  return result;
}

/**
 * Scan every history entry and decide which are orphaned.
 * @returns {Promise<{ scanned: number, orphaned: number, unexpected: number,
 *   messages: string[], conversations: string[] }>} `messages` are gone
 *   messages under live conversations; `conversations` are gone conversations.
 */
async function findOrphans(firestore) {
  const report = { scanned: 0, orphaned: 0, unexpected: 0, messages: [], conversations: [] };
  const byMessage = new Map();
  for (const group of HISTORY_GROUPS) {
    const snap = await firestore.collectionGroup(group).select().get();
    for (const doc of snap.docs) {
      report.scanned += 1;
      const parents = parentsOf(doc.ref.path);
      if (!parents) {
        report.unexpected += 1;
        continue;
      }
      const entry = byMessage.get(parents.message) || {
        conversation: parents.conversation,
        entries: 0,
      };
      entry.entries += 1;
      byMessage.set(parents.message, entry);
    }
  }
  if (byMessage.size === 0) return report;

  const conversationPaths = [...new Set([...byMessage.values()].map((e) => e.conversation))];
  const exists = await existence(firestore, [...byMessage.keys(), ...conversationPaths]);
  const gone = new Set(conversationPaths.filter((path) => !exists.get(path)));
  for (const [message, { conversation, entries }] of byMessage) {
    if (gone.has(conversation)) {
      report.orphaned += entries;
    } else if (!exists.get(message)) {
      report.orphaned += entries;
      report.messages.push(message);
    }
  }
  report.conversations = [...gone];
  return report;
}

/** The report with the planted sentinel taken out: one scanned, orphaned entry and its conversation. */
function withoutSentinel(report) {
  return {
    ...report,
    scanned: report.scanned - 1,
    orphaned: report.orphaned - 1,
    conversations: report.conversations.filter((path) => path !== SENTINEL_CONVERSATION),
  };
}

/** The report as numbers only, for printing. */
function summarise(report) {
  return {
    scanned: report.scanned,
    orphaned: report.orphaned,
    messages: report.messages.length,
    conversations: report.conversations.length,
    unexpected: report.unexpected,
  };
}

/** A gone conversation goes as a whole tree (stray messages too); else the gone message's tree. */
async function deleteOrphans(firestore, report) {
  for (const path of report.conversations) await deleteTree(firestore, firestore.doc(path));
  for (const path of report.messages) await deleteTree(firestore, firestore.doc(path));
}

/**
 * Count, and with `--apply --project <id>` delete then count again.
 * The project id is only known once the first query has run, so the refusal
 * comes after the first scan and before any delete.
 * @returns {Promise<0 | 1>} 1 when orphans remain after `--apply`
 */
async function main(argv, { firestore, log }) {
  await firestore.doc(SENTINEL_PATH).set({ sentinel: true });
  try {
    const before = await findOrphans(firestore);
    if (!before.conversations.includes(SENTINEL_CONVERSATION)) {
      throw new Error(
        `the scan did not find the planted sentinel ${SENTINEL_PATH}, so its counts cannot be trusted; nothing was deleted`,
      );
    }
    const project = firestore.projectId;
    const apply = argv.includes('--apply');
    if (apply) {
      const flag = argv.indexOf('--project');
      if (flag === -1 || argv[flag + 1] !== project) {
        throw new Error(
          `--apply needs --project ${project} (the credential's project); nothing was deleted`,
        );
      }
    }
    log(JSON.stringify({ project, phase: 'before', ...summarise(withoutSentinel(before)) }));
    if (!apply) return 0;

    await deleteOrphans(firestore, before);
    const after = await findOrphans(firestore);
    log(JSON.stringify({ project, phase: 'after', ...summarise(after) }));
    return after.orphaned === 0 ? 0 : 1;
  } finally {
    await deleteTree(firestore, firestore.doc(SENTINEL_CONVERSATION));
  }
}

if (require.main === module) {
  const { db } = require('../src/utils/firebase');
  main(process.argv.slice(2), { firestore: db, log: console.log })
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('Orphaned message history clean-up failed:', err.message);
      process.exit(1);
    });
}

module.exports = {
  SENTINEL_CONVERSATION,
  SENTINEL_PATH,
  parentsOf,
  findOrphans,
  summarise,
  deleteOrphans,
  main,
};
