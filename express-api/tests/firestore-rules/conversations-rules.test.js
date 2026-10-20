/**
 * REAL Firestore security-rules tests for `conversations/{conversationId}`,
 * exercised against the live Firestore emulator via `@firebase/rules-unit-testing`
 * (v5). Companion to `room-rules.test.js` (SHY-0129) — SHY-0130.
 *
 * Pins the `get` + `list` contract for the conversations DM threads. The bug
 * (SHY-0130): the Android client coerces the caller's `uniqueId` to a Long
 * before `array-contains`, but the rule gates on `string(callerUniqueId()) in
 * resource.data.participantIds` and `participantIds` is stored as STRINGS, so
 * the Long query is denied/empty. These tests prove the STRING-typed query is
 * ALLOWED and the LONG-typed query is DENIED, plus DM-privacy + the OSA
 * `crossCohortAtMigration` migration gate, against the real engine.
 *
 * It also covers the `crossCohortAtMigration` LIST-leak + its fix (SHY-0132): the
 * rule's `!= true` clause is NOT enforced as a filter on `list`, so an unconstrained
 * query LEAKS migrated cross-cohort threads; the fix is the client query adding
 * `where('crossCohortAtMigration','==', false)` + a backfill (the `== false` filter
 * excludes absent-field docs). See the `crossCohortAtMigration segregation` block.
 *
 * Requires the Firestore emulator (`FIRESTORE_EMULATOR_HOST`, default
 * `localhost:8080`). Start it with `bash local/start.sh`.
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
const PROJECT_ID = `demo-shytalk-conv-rules-${process.env.JEST_WORKER_ID || '1'}`;

// ── Realistic JWT claim shapes (uniqueId is a NUMBER in the claim, as Express
// mints it; the rule stringifies it via `string(callerUniqueId())`). ──────────
const ADULT = { uid: 'fbuid-adult-1', uniqueId: 50001, cohort: 'adult' };
const ADULT_2 = { uid: 'fbuid-adult-2', uniqueId: 50002, cohort: 'adult' };
// A signed-in caller who is NOT a participant of the seeded threads.
const OUTSIDER = { uid: 'fbuid-out-1', uniqueId: 50003, cohort: 'adult' };
const MINOR = { uid: 'fbuid-minor-1', uniqueId: 50010, cohort: 'minor' };
// Right after sign-in, before the custom-claim mint lands: no uniqueId claim,
// so `callerUniqueId()` throws → deny.
const NO_CLAIMS = { uid: 'fbuid-noclaims-1' };

let testEnv;
const handles = new Map();

function dbFor(persona) {
  const { uid, ...claims } = persona;
  if (!handles.has(uid)) {
    handles.set(uid, testEnv.authenticatedContext(uid, claims).firestore());
  }
  return handles.get(uid);
}

function dbAnon() {
  if (!handles.has('__anon__')) {
    handles.set('__anon__', testEnv.unauthenticatedContext().firestore());
  }
  return handles.get('__anon__');
}

/**
 * A conversation doc as the (fixed) client stamps it: `participantIds` are
 * STRINGS. `participants` is an array of personas; override fields per test.
 */
function convDoc(participants, overrides = {}) {
  return {
    participantIds: participants.map((p) => String(p.uniqueId)),
    lastMessageAt: 1000,
    isGroup: false,
    ...overrides,
  };
}

async function seedDoc(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data);
  });
}

function seedConv(id, data) {
  return seedDoc(`conversations/${id}`, data);
}

/** The STRING-typed array-contains list query (the fix). */
function listAsString(persona) {
  return dbFor(persona)
    .collection('conversations')
    .where('participantIds', 'array-contains', String(persona.uniqueId))
    .get();
}

/** The LONG-typed array-contains list query (the Android bug). */
function listAsLong(persona) {
  return dbFor(persona)
    .collection('conversations')
    .where('participantIds', 'array-contains', persona.uniqueId)
    .get();
}

/** SHY-0132 — the FIXED list query: string array-contains + the crossCohort
 * filter that excludes migrated cross-cohort threads on `list`. */
function listWithCrossCohortFilter(persona) {
  return dbFor(persona)
    .collection('conversations')
    .where('participantIds', 'array-contains', String(persona.uniqueId))
    .where('crossCohortAtMigration', '==', false)
    .get();
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
});

// ═══════════════════════════════════════════════════════════════════════════
// get (single doc) — membership + migration gate
// ═══════════════════════════════════════════════════════════════════════════

describe('conversations/{id} get — real rules engine', () => {
  test('a participant CAN get their own conversation', async () => {
    await seedConv('c-get-1', convDoc([ADULT, ADULT_2]));
    await assertSucceeds(dbFor(ADULT).doc('conversations/c-get-1').get());
  });

  test('DENY: a non-participant cannot get the conversation', async () => {
    await seedConv('c-get-2', convDoc([ADULT, ADULT_2]));
    await assertFails(dbFor(OUTSIDER).doc('conversations/c-get-2').get());
  });

  test('DENY: a crossCohortAtMigration:true thread is hidden even from a participant', async () => {
    await seedConv('c-get-3', convDoc([ADULT, MINOR], { crossCohortAtMigration: true }));
    await assertFails(dbFor(ADULT).doc('conversations/c-get-3').get());
  });

  test('DENY: an unauthenticated caller cannot get a conversation', async () => {
    await seedConv('c-get-4', convDoc([ADULT, ADULT_2]));
    await assertFails(dbAnon().doc('conversations/c-get-4').get());
  });

  test('DENY: a caller with no uniqueId claim (propagation race) cannot get', async () => {
    await seedConv('c-get-5', convDoc([ADULT, ADULT_2]));
    await assertFails(dbFor(NO_CLAIMS).doc('conversations/c-get-5').get());
  });

  test('a participant whose id is stored as a STRING is matched (numeric-claim vs string-data)', async () => {
    // The doc stores "50001" (string); the caller's claim uniqueId is 50001
    // (number). The rule `string(callerUniqueId()) in participantIds` bridges
    // them. This is the get-side mirror of the list bug.
    await seedConv('c-get-6', { participantIds: ['50001', '50002'], lastMessageAt: 1 });
    await assertSucceeds(dbFor(ADULT).doc('conversations/c-get-6').get());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// list (collection query) — SHY-0130 contract: STRING query ALLOWED, LONG DENIED
// ═══════════════════════════════════════════════════════════════════════════

describe('conversations list (collection query) — SHY-0130 contract', () => {
  test('a participant CAN list with a STRING array-contains query (the fix)', async () => {
    await seedConv('c-list-1', convDoc([ADULT, ADULT_2]));
    await seedConv('c-list-2', convDoc([ADULT, MINOR]));
    await assertSucceeds(listAsString(ADULT));
  });

  test('DENY: a LONG array-contains query (the Android bug shape)', async () => {
    await seedConv('c-list-1', convDoc([ADULT, ADULT_2]));
    await assertFails(listAsLong(ADULT));
  });

  test('an EMPTY result (participant has no threads) returns empty, not denied', async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(listAsString(ADULT));
  });

  test('DENY: listing for another user’s id (non-participant cannot enumerate)', async () => {
    await seedConv('c-list-3', convDoc([ADULT, ADULT_2]));
    // OUTSIDER tries to read ADULT's threads by querying ADULT's id.
    await assertFails(
      dbFor(OUTSIDER)
        .collection('conversations')
        .where('participantIds', 'array-contains', String(ADULT.uniqueId))
        .get(),
    );
  });

  test('DENY: an unauthenticated caller cannot list conversations', async () => {
    await seedConv('c-list-4', convDoc([ADULT, ADULT_2]));
    await assertFails(
      dbAnon()
        .collection('conversations')
        .where('participantIds', 'array-contains', String(ADULT.uniqueId))
        .get(),
    );
  });
});

// SHY-0132 — the `crossCohortAtMigration` LIST-leak (OSA §17) + its fix.
//
// Mechanics (proven against the real engine): the `!= true` clause IS present in
// the `list` rule text (firestore.rules L327-329, identical to `get`), BUT
// Firestore does NOT apply a `resource.data` condition as a per-document FILTER on
// `list` — the query returns every doc matching its EXPLICIT constraints and the
// engine does not drop docs that fail the rule's data condition. So an
// unconstrained `array-contains(string(uid))` list RETURNS the caller's
// `crossCohortAtMigration: true` threads (fail-OPEN leak of migrated cross-cohort
// thread metadata) even though `get` on the same doc is correctly denied. The fix
// is query + data: the client adds `.where('crossCohortAtMigration','==', false)`
// AND an Admin-SDK backfill stamps the field on EVERY doc (a `== false` filter
// excludes docs where the field is ABSENT — so the backfill is mandatory and new
// writes must always stamp it). No rule change is possible (a rule cannot enforce a
// field the query does not constrain).
describe('conversations list — crossCohortAtMigration segregation (SHY-0132)', () => {
  test('LEAK (pre-fix): an unconstrained list returns the migrated cross-cohort thread', async () => {
    // A normal thread (field present, false) + a migrated cross-cohort thread.
    await seedConv('cc-normal', convDoc([ADULT, ADULT_2], { crossCohortAtMigration: false }));
    await seedConv('cc-migrated', convDoc([ADULT, MINOR], { crossCohortAtMigration: true }));

    const snap = await assertSucceeds(listAsString(ADULT));
    const ids = snap.docs.map((d) => d.id).sort();
    // The leak: the migrated cross-cohort thread is returned alongside the normal
    // one. This documents the vulnerability; the fix below excludes it.
    expect(ids).toEqual(['cc-migrated', 'cc-normal']);
  });

  test('FIX: list + where(crossCohortAtMigration == false) returns ONLY the non-migrated thread', async () => {
    await seedConv('cc-normal', convDoc([ADULT, ADULT_2], { crossCohortAtMigration: false }));
    await seedConv('cc-migrated', convDoc([ADULT, MINOR], { crossCohortAtMigration: true }));

    const snap = await assertSucceeds(listWithCrossCohortFilter(ADULT));
    const ids = snap.docs.map((d) => d.id);
    expect(ids).toEqual(['cc-normal']); // the migrated thread is excluded
  });

  test('the == false filter EXCLUDES a doc with the field ABSENT (backfill is mandatory)', async () => {
    // A legacy thread with NO crossCohortAtMigration field (pre-backfill).
    await seedConv('cc-legacy', convDoc([ADULT, ADULT_2])); // convDoc omits the field
    const before = await assertSucceeds(listWithCrossCohortFilter(ADULT));
    expect(before.docs).toHaveLength(0); // == false does not match an absent field

    // After the backfill stamps the field false, the legitimate thread reappears.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .doc('conversations/cc-legacy')
        .update({ crossCohortAtMigration: false });
    });
    const after = await assertSucceeds(listWithCrossCohortFilter(ADULT));
    expect(after.docs.map((d) => d.id)).toEqual(['cc-legacy']);
  });

  test('a non-participant still cannot list another member’s threads via the filter', async () => {
    await seedConv('cc-normal', convDoc([ADULT, ADULT_2], { crossCohortAtMigration: false }));
    await assertFails(
      dbFor(OUTSIDER)
        .collection('conversations')
        .where('participantIds', 'array-contains', String(ADULT.uniqueId))
        .where('crossCohortAtMigration', '==', false)
        .get(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SHY-0648 — who may change a group. Owner = `createdBy`; admin = owner or in
// `groupAdminIds`; mod = in `groupModIds`; the rest follow the group's
// `permissions` (defaults as `GroupPermissions`). Each write is shaped as the
// app repositories write it; the rules judge the resulting document, so the
// new array stands in for arrayUnion / arrayRemove.
// ═══════════════════════════════════════════════════════════════════════════

const OWNER = ADULT;
const MEMBER = ADULT_2;
const MEMBER_3 = { uid: 'fbuid-adult-4', uniqueId: 50004, cohort: 'adult' };
const NEWCOMER = { uid: 'fbuid-adult-5', uniqueId: 50005, cohort: 'adult' };
const id = (p) => String(p.uniqueId);

function groupDoc(overrides = {}) {
  return convDoc([OWNER, MEMBER, MEMBER_3], {
    isGroup: true,
    groupName: 'Spanish practice',
    createdBy: id(OWNER),
    crossCohortAtMigration: false,
    cohort: 'adult',
    isClosed: false,
    groupAdminIds: [],
    groupModIds: [],
    permissions: {
      whoCanSend: 'EVERYONE',
      whoCanAddMembers: 'EVERYONE',
      whoCanEditInfo: 'EVERYONE',
      whoCanDeleteMessages: 'MODS_AND_ABOVE',
      whoCanMuteMembers: 'MODS_AND_ABOVE',
      whoCanRemoveMembers: 'ADMINS_ONLY',
    },
    systemMessageConfig: { showJoins: true },
    modNotifyMode: 'ALL_ADMINS',
    ...overrides,
  });
}

function groupRef(persona, convId) {
  return dbFor(persona).doc(`conversations/${convId}`);
}

describe('SHY-0648 — a group member cannot give themselves powers', () => {
  test('DENY: a member sets themselves as owner', async () => {
    await seedConv('g-esc-1', groupDoc());
    await assertFails(groupRef(MEMBER, 'g-esc-1').update({ createdBy: id(MEMBER) }));
  });

  test('DENY: a member puts themselves in groupAdminIds', async () => {
    await seedConv('g-esc-2', groupDoc());
    await assertFails(
      groupRef(MEMBER, 'g-esc-2').update({ groupAdminIds: [id(MEMBER)], groupModIds: [] }),
    );
  });

  test('DENY: a member puts themselves in groupModIds', async () => {
    await seedConv('g-esc-3', groupDoc());
    await assertFails(
      groupRef(MEMBER, 'g-esc-3').update({ groupAdminIds: [], groupModIds: [id(MEMBER)] }),
    );
  });

  test('DENY: a member removes another member (whoCanRemoveMembers ADMINS_ONLY)', async () => {
    await seedConv('g-esc-4', groupDoc());
    await assertFails(
      groupRef(MEMBER, 'g-esc-4').update({ participantIds: [id(OWNER), id(MEMBER)] }),
    );
  });

  test('DENY: a member removes the owner', async () => {
    await seedConv('g-esc-5', groupDoc());
    await assertFails(
      groupRef(MEMBER, 'g-esc-5').update({ participantIds: [id(MEMBER), id(MEMBER_3)] }),
    );
  });

  test('DENY: a member closes the group', async () => {
    await seedConv('g-esc-6', groupDoc());
    await assertFails(groupRef(MEMBER, 'g-esc-6').update({ isClosed: true }));
  });

  test("DENY: a member rewrites the group's permissions", async () => {
    await seedConv('g-esc-7', groupDoc());
    await assertFails(
      groupRef(MEMBER, 'g-esc-7').update({
        permissions: { ...groupDoc().permissions, whoCanRemoveMembers: 'EVERYONE' },
      }),
    );
  });

  test("DENY: a member changes the group's system messages", async () => {
    await seedConv('g-esc-8', groupDoc());
    await assertFails(
      groupRef(MEMBER, 'g-esc-8').update({ systemMessageConfig: { showJoins: false } }),
    );
  });

  test("DENY: a member changes the group's mod notify mode", async () => {
    await seedConv('g-esc-9', groupDoc());
    await assertFails(groupRef(MEMBER, 'g-esc-9').update({ modNotifyMode: 'OWNER_ONLY' }));
  });

  test("DENY: a member changes the group's cohort", async () => {
    await seedConv('g-esc-10', groupDoc());
    await assertFails(groupRef(MEMBER, 'g-esc-10').update({ cohort: 'minor' }));
  });

  test('DENY: a member turns the group into a one-to-one', async () => {
    await seedConv('g-esc-11', groupDoc());
    await assertFails(groupRef(MEMBER, 'g-esc-11').update({ isGroup: false }));
  });

  test('DENY: a member renames the group when whoCanEditInfo is ADMINS_ONLY', async () => {
    await seedConv(
      'g-esc-12',
      groupDoc({ permissions: { ...groupDoc().permissions, whoCanEditInfo: 'ADMINS_ONLY' } }),
    );
    await assertFails(groupRef(MEMBER, 'g-esc-12').update({ groupName: 'Taken over' }));
  });

  test('DENY: a mod puts themselves in groupAdminIds', async () => {
    await seedConv('g-esc-13', groupDoc({ groupModIds: [id(MEMBER)] }));
    await assertFails(
      groupRef(MEMBER, 'g-esc-13').update({ groupAdminIds: [id(MEMBER)], groupModIds: [] }),
    );
  });

  test('DENY: an admin who is not the owner sets themselves as owner', async () => {
    await seedConv('g-esc-14', groupDoc({ groupAdminIds: [id(MEMBER)] }));
    await assertFails(groupRef(MEMBER, 'g-esc-14').update({ createdBy: id(MEMBER) }));
  });

  test('DENY: a one-to-one participant turns the thread into a group they run', async () => {
    await seedConv('g-esc-15', convDoc([OWNER, MEMBER]));
    await assertFails(
      groupRef(MEMBER, 'g-esc-15').update({
        isGroup: true,
        createdBy: id(MEMBER),
        groupAdminIds: [id(MEMBER)],
      }),
    );
  });

  test('DENY: the owner hands ownership to someone outside the group', async () => {
    await seedConv('g-esc-16', groupDoc());
    await assertFails(groupRef(OWNER, 'g-esc-16').update({ createdBy: id(NEWCOMER) }));
  });

  test('ALLOW: a member leaves (removes only themselves)', async () => {
    await seedConv('g-ok-1', groupDoc());
    await assertSucceeds(
      groupRef(MEMBER, 'g-ok-1').update({ participantIds: [id(OWNER), id(MEMBER_3)] }),
    );
  });

  test('ALLOW: the owner makes a member an admin (updateGroupRoles)', async () => {
    await seedConv('g-ok-2', groupDoc());
    await assertSucceeds(
      groupRef(OWNER, 'g-ok-2').update({ groupAdminIds: [id(MEMBER)], groupModIds: [] }),
    );
  });

  test('ALLOW: the owner hands ownership to a member (transferOwnership)', async () => {
    await seedConv('g-ok-3', groupDoc());
    await assertSucceeds(groupRef(OWNER, 'g-ok-3').update({ createdBy: id(MEMBER) }));
  });

  test('ALLOW: a member renames the group when whoCanEditInfo is EVERYONE', async () => {
    await seedConv('g-ok-4', groupDoc());
    await assertSucceeds(groupRef(MEMBER, 'g-ok-4').update({ groupName: 'Spanish club' }));
  });

  test('ALLOW: an admin closes the group (closeGroupConversation)', async () => {
    await seedConv('g-ok-5', groupDoc({ groupAdminIds: [id(MEMBER)] }));
    await assertSucceeds(groupRef(MEMBER, 'g-ok-5').update({ isClosed: true }));
  });

  test("ALLOW: the owner changes the group's permissions", async () => {
    await seedConv('g-ok-6', groupDoc());
    await assertSucceeds(
      groupRef(OWNER, 'g-ok-6').update({
        permissions: { ...groupDoc().permissions, whoCanEditInfo: 'ADMINS_ONLY' },
      }),
    );
  });

  test('ALLOW: a member adds a same-cohort user when whoCanAddMembers is EVERYONE', async () => {
    await seedConv('g-ok-7', groupDoc());
    await seedDoc(`users/${id(NEWCOMER)}`, { cohort: 'adult' });
    await assertSucceeds(
      groupRef(MEMBER, 'g-ok-7').update({
        participantIds: [id(OWNER), id(MEMBER), id(MEMBER_3), id(NEWCOMER)],
      }),
    );
  });
});

describe("SHY-0648 — each change follows the group's roles and permissions", () => {
  const withPermissions = (changes) => ({
    permissions: { ...groupDoc().permissions, ...changes },
  });
  // A group written before `permissions` existed: the key is absent.
  const groupDocWithoutPermissions = () => {
    const { permissions: _absent, ...rest } = groupDoc();
    return rest;
  };

  test('DENY: a one-to-one participant adds a third person', async () => {
    await seedConv('g-perm-1', convDoc([OWNER, MEMBER]));
    await seedDoc(`users/${id(NEWCOMER)}`, { cohort: 'adult' });
    await assertFails(
      groupRef(MEMBER, 'g-perm-1').update({
        participantIds: [id(OWNER), id(MEMBER), id(NEWCOMER)],
      }),
    );
  });

  test('DENY: a member writes a field the apps never write', async () => {
    await seedConv('g-perm-2', groupDoc());
    await assertFails(groupRef(MEMBER, 'g-perm-2').update({ lastMessage: 'forged' }));
  });

  test('DENY: even the owner writes a field the apps never write', async () => {
    await seedConv('g-perm-3', groupDoc());
    await assertFails(groupRef(OWNER, 'g-perm-3').update({ lastMessage: 'forged' }));
  });

  test('DENY: a mod closes the group', async () => {
    await seedConv('g-perm-4', groupDoc({ groupModIds: [id(MEMBER)] }));
    await assertFails(groupRef(MEMBER, 'g-perm-4').update({ isClosed: true }));
  });

  test('DENY: a member adds a user when whoCanAddMembers is ADMINS_ONLY', async () => {
    await seedConv('g-perm-5', groupDoc(withPermissions({ whoCanAddMembers: 'ADMINS_ONLY' })));
    await seedDoc(`users/${id(NEWCOMER)}`, { cohort: 'adult' });
    await assertFails(
      groupRef(MEMBER, 'g-perm-5').update({
        participantIds: [id(OWNER), id(MEMBER), id(MEMBER_3), id(NEWCOMER)],
      }),
    );
  });

  test('ALLOW: an admin adds a user when whoCanAddMembers is ADMINS_ONLY', async () => {
    await seedConv(
      'g-perm-6',
      groupDoc({
        groupAdminIds: [id(MEMBER)],
        ...withPermissions({ whoCanAddMembers: 'ADMINS_ONLY' }),
      }),
    );
    await seedDoc(`users/${id(NEWCOMER)}`, { cohort: 'adult' });
    await assertSucceeds(
      groupRef(MEMBER, 'g-perm-6').update({
        participantIds: [id(OWNER), id(MEMBER), id(MEMBER_3), id(NEWCOMER)],
      }),
    );
  });

  test('ALLOW: a member removes another when whoCanRemoveMembers is EVERYONE', async () => {
    await seedConv('g-perm-7', groupDoc(withPermissions({ whoCanRemoveMembers: 'EVERYONE' })));
    await assertSucceeds(
      groupRef(MEMBER, 'g-perm-7').update({ participantIds: [id(OWNER), id(MEMBER)] }),
    );
  });

  test('DENY: nobody removes the owner, even when whoCanRemoveMembers is EVERYONE', async () => {
    await seedConv(
      'g-perm-8',
      groupDoc({
        groupAdminIds: [id(MEMBER)],
        ...withPermissions({ whoCanRemoveMembers: 'EVERYONE' }),
      }),
    );
    await assertFails(
      groupRef(MEMBER, 'g-perm-8').update({ participantIds: [id(MEMBER), id(MEMBER_3)] }),
    );
  });

  test('ALLOW: an admin who is not the owner removes a member (ADMINS_ONLY)', async () => {
    await seedConv('g-perm-9', groupDoc({ groupAdminIds: [id(MEMBER)] }));
    await assertSucceeds(
      groupRef(MEMBER, 'g-perm-9').update({ participantIds: [id(OWNER), id(MEMBER)] }),
    );
  });

  test('ALLOW: the owner removes a member (ADMINS_ONLY)', async () => {
    await seedConv('g-perm-10', groupDoc());
    await assertSucceeds(
      groupRef(OWNER, 'g-perm-10').update({ participantIds: [id(OWNER), id(MEMBER)] }),
    );
  });

  test('ALLOW: a mod removes a member when whoCanRemoveMembers is MODS_AND_ABOVE', async () => {
    await seedConv(
      'g-perm-11',
      groupDoc({
        groupModIds: [id(MEMBER)],
        ...withPermissions({ whoCanRemoveMembers: 'MODS_AND_ABOVE' }),
      }),
    );
    await assertSucceeds(
      groupRef(MEMBER, 'g-perm-11').update({ participantIds: [id(OWNER), id(MEMBER)] }),
    );
  });

  test('ALLOW: a mod removes a member under the old name ADMINS_AND_MODS', async () => {
    await seedConv(
      'g-perm-12',
      groupDoc({
        groupModIds: [id(MEMBER)],
        ...withPermissions({ whoCanRemoveMembers: 'ADMINS_AND_MODS' }),
      }),
    );
    await assertSucceeds(
      groupRef(MEMBER, 'g-perm-12').update({ participantIds: [id(OWNER), id(MEMBER)] }),
    );
  });

  test('ALLOW: with no permissions map a member renames (default EVERYONE)', async () => {
    await seedConv('g-perm-13', groupDocWithoutPermissions());
    await assertSucceeds(groupRef(MEMBER, 'g-perm-13').update({ groupName: 'Spanish club' }));
  });

  test('DENY: with no permissions map a member removes another (default ADMINS_ONLY)', async () => {
    await seedConv('g-perm-14', groupDocWithoutPermissions());
    await assertFails(
      groupRef(MEMBER, 'g-perm-14').update({ participantIds: [id(OWNER), id(MEMBER)] }),
    );
  });

  test('ALLOW: an unknown level reads as its default (a member renames)', async () => {
    await seedConv('g-perm-15', groupDoc(withPermissions({ whoCanEditInfo: 'NOT_A_LEVEL' })));
    await assertSucceeds(groupRef(MEMBER, 'g-perm-15').update({ groupName: 'Spanish club' }));
  });

  test('DENY: an admin renames and promotes in one write (needs the owner for both)', async () => {
    await seedConv('g-perm-16', groupDoc({ groupAdminIds: [id(MEMBER)] }));
    await assertFails(
      groupRef(MEMBER, 'g-perm-16').update({
        groupName: 'Spanish club',
        groupModIds: [id(MEMBER_3)],
      }),
    );
  });

  test('ALLOW: the owner leaves (removes only themselves)', async () => {
    await seedConv('g-perm-17', groupDoc());
    await assertSucceeds(
      groupRef(OWNER, 'g-perm-17').update({ participantIds: [id(MEMBER), id(MEMBER_3)] }),
    );
  });

  test('ALLOW: the owner changes system messages, notify mode, description and photo', async () => {
    await seedConv('g-perm-18', groupDoc());
    await assertSucceeds(
      groupRef(OWNER, 'g-perm-18').update({
        systemMessageConfig: { showJoins: false },
        modNotifyMode: 'OWNER_ONLY',
        groupDescription: 'We practise Spanish',
        groupPhotoUrl: 'https://example.invalid/g.png',
      }),
    );
  });

  test('DENY: a one-to-one participant removes the other person', async () => {
    await seedConv('g-perm-19', convDoc([OWNER, MEMBER]));
    await assertFails(groupRef(MEMBER, 'g-perm-19').update({ participantIds: [id(MEMBER)] }));
  });

  test('DENY: a member removes another when whoCanRemoveMembers is MODS_AND_ABOVE', async () => {
    await seedConv(
      'g-perm-20',
      groupDoc(withPermissions({ whoCanRemoveMembers: 'MODS_AND_ABOVE' })),
    );
    await assertFails(
      groupRef(MEMBER, 'g-perm-20').update({ participantIds: [id(OWNER), id(MEMBER)] }),
    );
  });

  test('DENY: an admin renames the group when whoCanEditInfo is OWNER_ONLY', async () => {
    await seedConv(
      'g-perm-21',
      groupDoc({
        groupAdminIds: [id(MEMBER)],
        ...withPermissions({ whoCanEditInfo: 'OWNER_ONLY' }),
      }),
    );
    await assertFails(groupRef(MEMBER, 'g-perm-21').update({ groupName: 'Spanish club' }));
  });

  test('ALLOW: the owner renames the group when whoCanEditInfo is OWNER_ONLY', async () => {
    await seedConv('g-perm-22', groupDoc(withPermissions({ whoCanEditInfo: 'OWNER_ONLY' })));
    await assertSucceeds(groupRef(OWNER, 'g-perm-22').update({ groupName: 'Spanish club' }));
  });

  test('DENY: an unknown level reads as its default (a member removes another)', async () => {
    await seedConv('g-perm-23', groupDoc(withPermissions({ whoCanRemoveMembers: 'NOT_A_LEVEL' })));
    await assertFails(
      groupRef(MEMBER, 'g-perm-23').update({ participantIds: [id(OWNER), id(MEMBER)] }),
    );
  });
});

// SHY-0647 — both apps make a group, add each member, then write every
// member's `userSettings` row in ONE batch (PrivateMessageRepositoryImpl,
// IosPrivateMessageRepositoryImpl). The owner (`createdBy`) holds every power
// an admin or mod holds (Shyden, 2026-10-20), so the owner may write those
// rows, mute members and hide messages, as the apps offer them
// (`Conversation.isAdmin`, `isModOrAbove`). The group is seeded as it stands
// at that batch: no admins, no mods.
function settingsRef(persona, convId, rowOwner) {
  return dbFor(persona).doc(`conversations/${convId}/userSettings/${id(rowOwner)}`);
}
const settingsRow = (rowOwner) => ({ unreadCount: 0, userId: id(rowOwner) });

describe('SHY-0647 — the owner holds every power an admin or mod holds', () => {
  test('ALLOW: the owner of a group with no admins writes their own row', async () => {
    await seedConv('g-set-1', groupDoc());
    await assertSucceeds(settingsRef(OWNER, 'g-set-1', OWNER).set(settingsRow(OWNER)));
  });

  test("ALLOW: the owner of a group with no admins writes a member's row", async () => {
    await seedConv('g-set-2', groupDoc());
    await assertSucceeds(settingsRef(OWNER, 'g-set-2', MEMBER).set(settingsRow(MEMBER)));
  });

  test("ALLOW: the app's one batch of every member's row, sent by the owner", async () => {
    await seedConv('g-set-3', groupDoc());
    const batch = dbFor(OWNER).batch();
    batch.set(settingsRef(OWNER, 'g-set-3', OWNER), settingsRow(OWNER));
    batch.set(settingsRef(OWNER, 'g-set-3', MEMBER), settingsRow(MEMBER));
    batch.set(settingsRef(OWNER, 'g-set-3', MEMBER_3), settingsRow(MEMBER_3));
    await assertSucceeds(batch.commit());
  });

  test("ALLOW: the owner writes a member's row when they promoted another member to admin", async () => {
    await seedConv('g-set-4', groupDoc({ groupAdminIds: [id(MEMBER)] }));
    await assertSucceeds(settingsRef(OWNER, 'g-set-4', MEMBER_3).set(settingsRow(MEMBER_3)));
  });

  test("DENY: a mod writes another member's row", async () => {
    await seedConv('g-set-7', groupDoc({ groupModIds: [id(MEMBER)] }));
    await assertFails(settingsRef(MEMBER, 'g-set-7', MEMBER_3).set(settingsRow(MEMBER_3)));
  });

  test('ALLOW: the owner of a group with no admins or mods mutes a member', async () => {
    await seedConv('g-mute-1', groupDoc());
    await assertSucceeds(
      dbFor(OWNER)
        .doc(`conversations/g-mute-1/mutes/${id(MEMBER)}`)
        .set({ mutedUntil: 1 }),
    );
  });

  test('DENY: a member mutes another member', async () => {
    await seedConv('g-mute-2', groupDoc());
    await assertFails(
      dbFor(MEMBER)
        .doc(`conversations/g-mute-2/mutes/${id(MEMBER_3)}`)
        .set({ mutedUntil: 1 }),
    );
  });

  test('ALLOW: the owner of a group with no admins or mods hides a message naming themself', async () => {
    await seedConv('g-hide-1', groupDoc());
    await seedDoc('conversations/g-hide-1/messages/m1', {
      senderId: id(MEMBER),
      text: 'hola',
      type: 'TEXT',
    });
    await assertSucceeds(
      dbFor(OWNER)
        .doc('conversations/g-hide-1/messages/m1')
        .update({ isHidden: true, hiddenBy: id(OWNER) }),
    );
  });

  test('DENY: a member hides a message', async () => {
    await seedConv('g-hide-2', groupDoc());
    await seedDoc('conversations/g-hide-2/messages/m1', {
      senderId: id(MEMBER_3),
      text: 'hola',
      type: 'TEXT',
    });
    await assertFails(
      dbFor(MEMBER)
        .doc('conversations/g-hide-2/messages/m1')
        .update({ isHidden: true, hiddenBy: id(MEMBER) }),
    );
  });

  test("ALLOW: a member in groupAdminIds writes another member's row", async () => {
    await seedConv('g-set-5', groupDoc({ groupAdminIds: [id(MEMBER)] }));
    await assertSucceeds(settingsRef(MEMBER, 'g-set-5', MEMBER_3).set(settingsRow(MEMBER_3)));
  });

  test("DENY: a member writes another member's row", async () => {
    await seedConv('g-set-6', groupDoc());
    await assertFails(settingsRef(MEMBER, 'g-set-6', MEMBER_3).set(settingsRow(MEMBER_3)));
  });
});

// SHY-0653 — a group mute is `conversations/{id}/mutes/{mutedUserId}`. Both
// apps write it as `userId`, `mutedAt` (epoch ms) and, for a timed mute,
// `duration` (ms); a permanent mute has no `duration`. The rule lets the
// muted member write their own row (the apps' auto-unmute once a mute ends),
// and the message `create` rule never reads `mutes`. These tests pin what the
// rules do TODAY; the cases named "TODAY" change verdict with the fix.
const HOUR_MS = 60 * 60 * 1000;
const lastingMute = (p) => ({ userId: id(p), mutedAt: Date.now(), duration: HOUR_MS });
const endedMute = (p) => ({ userId: id(p), mutedAt: Date.now() - 2 * HOUR_MS, duration: HOUR_MS });
const permanentMute = (p) => ({ userId: id(p), mutedAt: Date.now() });
const muteRef = (persona, convId, muted) =>
  dbFor(persona).doc(`conversations/${convId}/mutes/${id(muted)}`);
const newMessage = (persona, convId) =>
  dbFor(persona)
    .collection(`conversations/${convId}/messages`)
    .add({ senderId: id(persona), text: 'hola', type: 'TEXT' });

describe('SHY-0653 — a group mute lasts exactly as long as it was set', () => {
  test('ALLOW: a member who is not muted posts', async () => {
    await seedConv('g-mp-1', groupDoc());
    await assertSucceeds(newMessage(MEMBER, 'g-mp-1'));
  });

  test('TODAY ALLOW: a member under a timed mute posts', async () => {
    await seedConv('g-mp-2', groupDoc());
    await seedDoc(`conversations/g-mp-2/mutes/${id(MEMBER)}`, lastingMute(MEMBER));
    await assertSucceeds(newMessage(MEMBER, 'g-mp-2'));
  });

  test('TODAY ALLOW: a member under a permanent mute posts', async () => {
    await seedConv('g-mp-3', groupDoc());
    await seedDoc(`conversations/g-mp-3/mutes/${id(MEMBER)}`, permanentMute(MEMBER));
    await assertSucceeds(newMessage(MEMBER, 'g-mp-3'));
  });

  test('ALLOW: a member whose timed mute has ended posts', async () => {
    await seedConv('g-mp-4', groupDoc());
    await seedDoc(`conversations/g-mp-4/mutes/${id(MEMBER)}`, endedMute(MEMBER));
    await assertSucceeds(newMessage(MEMBER, 'g-mp-4'));
  });

  test('ALLOW: a member posts while another member is muted', async () => {
    await seedConv('g-mp-5', groupDoc());
    await seedDoc(`conversations/g-mp-5/mutes/${id(MEMBER_3)}`, lastingMute(MEMBER_3));
    await assertSucceeds(newMessage(MEMBER, 'g-mp-5'));
  });

  test('TODAY ALLOW: a muted member deletes their own timed mute before it ends', async () => {
    await seedConv('g-mu-1', groupDoc());
    await seedDoc(`conversations/g-mu-1/mutes/${id(MEMBER)}`, lastingMute(MEMBER));
    await assertSucceeds(muteRef(MEMBER, 'g-mu-1', MEMBER).delete());
  });

  test('TODAY ALLOW: a muted member deletes their own permanent mute', async () => {
    await seedConv('g-mu-2', groupDoc());
    await seedDoc(`conversations/g-mu-2/mutes/${id(MEMBER)}`, permanentMute(MEMBER));
    await assertSucceeds(muteRef(MEMBER, 'g-mu-2', MEMBER).delete());
  });

  test('TODAY ALLOW: a muted member shortens their own mute', async () => {
    await seedConv('g-mu-3', groupDoc());
    await seedDoc(`conversations/g-mu-3/mutes/${id(MEMBER)}`, lastingMute(MEMBER));
    await assertSucceeds(
      muteRef(MEMBER, 'g-mu-3', MEMBER).set({ ...lastingMute(MEMBER), duration: 1 }),
    );
  });

  test('ALLOW: a member clears their own mute once it has ended', async () => {
    await seedConv('g-mu-4', groupDoc());
    await seedDoc(`conversations/g-mu-4/mutes/${id(MEMBER)}`, endedMute(MEMBER));
    await assertSucceeds(muteRef(MEMBER, 'g-mu-4', MEMBER).delete());
  });

  test("ALLOW: the owner lifts a member's mute before it ends", async () => {
    await seedConv('g-mu-5', groupDoc());
    await seedDoc(`conversations/g-mu-5/mutes/${id(MEMBER)}`, lastingMute(MEMBER));
    await assertSucceeds(muteRef(OWNER, 'g-mu-5', MEMBER).delete());
  });

  test('ALLOW: a mod mutes a member for an hour', async () => {
    await seedConv('g-mu-6', groupDoc({ groupModIds: [id(MEMBER_3)] }));
    await assertSucceeds(muteRef(MEMBER_3, 'g-mu-6', MEMBER).set(lastingMute(MEMBER)));
  });
});
