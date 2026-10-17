/**
 * Ending a suspension puts back what it took — REAL-services integration test
 * (SHY-0605).
 *
 * A suspension masks the profile (name, uploaded photo, cover, bio, sign-in
 * photo) and writes a suspension warning that takes the GCS to 0. Five routes
 * end one. Before SHY-0605 none put everything back: the bio and sign-in photo
 * stayed blank, and the lift of an expired suspension nulled the saves outright.
 * Now each ends through `endSuspension`, and only an upheld appeal gives the
 * GCS back (Shyden, 2026-10-17): every other ending leaves it where the
 * suspension put it.
 *
 * One test per end path: suspend through the real admin route, end the
 * suspension that path's way, then read the user and the suspension warning
 * back from Firestore. The point is what lands in the emulator, which a mocked
 * db cannot show; the steps and their failures are unit-tested in
 * tests/utils/end-suspension.unit.test.js and each route's own test file.
 *
 * NODE_ENV='local' is set BEFORE requiring src/utils/firebase so the Admin SDK
 * and Auth emulator target localhost. PER-FILE opt-in only.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const { authMiddleware } = require('../../src/middleware/auth');
const usersRouter = require('../../src/routes/users');
const reportsRouter = require('../../src/routes/reports');
const adminUsersRouter = require('../../src/routes/admin-users');
const identityGraphRouter = require('../../src/routes/identity-graph');

const MEMBER = 50990605;
const ADMIN_ID = 50990606;

// What the member had before the suspension, every field it masks.
const PROFILE = {
  displayName: 'Ana Lima',
  profilePhotoUrl: 'https://img.example/shy0605/photo.png',
  coverPhotoUrl: 'https://img.example/shy0605/cover.png',
  description: 'Learning Portuguese, happy to help with English.',
  avatarUrl: 'https://img.example/shy0605/sign-in.png',
};
const GCS_BEFORE = 80;

function app() {
  const a = express();
  a.set('trust proxy', 1);
  a.use(express.json());
  a.use('/api', authMiddleware);
  a.use('/api', usersRouter);
  a.use('/api', reportsRouter);
  a.use('/api', adminUsersRouter);
  a.use('/api', identityGraphRouter);
  return a;
}

async function readUser() {
  return (await db.doc(`users/${MEMBER}`).get()).data();
}

async function suspensionWarnings() {
  const snap = await db.collection(`users/${MEMBER}/warnings`).get();
  return snap.docs.map((d) => d.data()).filter((w) => w.source === 'suspension');
}

async function clearMember() {
  const warnings = await db.collection(`users/${MEMBER}/warnings`).get();
  await Promise.all(warnings.docs.map((d) => d.ref.delete()));
  const appeals = await db.collection('suspensionAppeals').where('userId', '==', MEMBER).get();
  await Promise.all(appeals.docs.map((d) => d.ref.delete()));
  await Promise.all((await endingsRecorded()).docs.map((d) => d.ref.delete()));
  await db.doc(`users/${MEMBER}`).delete();
}

function endingsRecorded() {
  return db
    .collection('adminAuditLog')
    .where('targetId', '==', String(MEMBER))
    .where('action', '==', 'END_SUSPENSION')
    .get();
}

/** Each end path: how it ends the suspension, and whether the GCS comes back. */
const END_PATHS = [
  [
    'the admin unsuspend (admin-users)',
    false,
    ({ admin }) => request(app()).post(`/api/user/${MEMBER}/unsuspend`).set(admin.headers),
  ],
  [
    'the admin unsuspend (reports)',
    false,
    ({ admin }) =>
      request(app()).post(`/api/admin/users/${MEMBER}/unsuspend`).set(admin.headers).send({}),
  ],
  [
    'an upheld appeal',
    true,
    async ({ admin, member }) => {
      await request(app())
        .post(`/api/users/${MEMBER}/appeal`)
        .set(member.headers)
        .send({ appealText: 'I was helping a learner, not harassing them.' })
        .expect(200);
      const appeals = await db.collection('suspensionAppeals').where('userId', '==', MEMBER).get();
      expect(appeals.size).toBe(1);
      return request(app())
        .patch(`/api/appeals/${appeals.docs[0].id}`)
        .set(admin.headers)
        .send({ status: 'approved' });
    },
  ],
  [
    'the lift of an expired suspension',
    false,
    async ({ member }) => {
      await db.doc(`users/${MEMBER}`).update({ suspensionEndDate: Date.now() - 60_000 });
      clearAuthCaches();
      return request(app()).post(`/api/users/${MEMBER}/lift-suspension`).set(member.headers);
    },
  ],
  [
    'identity-graph unsuspend-all',
    false,
    ({ admin }) =>
      request(app())
        .post(`/api/admin/identity-graph/${MEMBER}/unsuspend-all`)
        .set(admin.headers)
        .send({}),
  ],
];

beforeAll(() => {
  assertEmulatorReachable();
});

let admin;
let member;

beforeEach(async () => {
  clearAuthCaches();
  await clearMember();
  admin = await mintRealUser({ uniqueId: ADMIN_ID, admin: true });
  member = await mintRealUser({
    uniqueId: MEMBER,
    extraUserData: { ...PROFILE, gcsScore: GCS_BEFORE },
  });

  // A timed suspension, so the expired-lift path has an end date to pass.
  await request(app())
    .post(`/api/user/${MEMBER}/suspend`)
    .set(admin.headers)
    .send({
      reason: 'harassment confirmed (SHY-0605 test)',
      canAppeal: true,
      endDate: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .expect(200);
  clearAuthCaches();
});

afterAll(async () => {
  await clearMember();
  await db.doc(`users/${ADMIN_ID}`).delete();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

test.each(Object.keys(PROFILE))('a suspension masks %s', async (field) => {
  const user = await readUser();

  expect(user.isSuspended).toBe(true);
  expect(user[field]).not.toBe(PROFILE[field]);
});

test('a suspension takes the GCS to 0 through one unrevoked warning', async () => {
  expect((await readUser()).gcsScore).toBe(0);
  expect((await suspensionWarnings()).map((w) => w.revoked)).toEqual([false]);
});

describe.each(END_PATHS)('%s', (_path, givesGcsBack, end) => {
  test('ends the suspension and puts the whole profile back', async () => {
    const res = await end({ admin, member });

    expect(res.status).toBe(200);
    const user = await readUser();
    expect(user.isSuspended).toBe(false);
    expect({
      displayName: user.displayName,
      profilePhotoUrl: user.profilePhotoUrl,
      coverPhotoUrl: user.coverPhotoUrl,
      description: user.description,
      avatarUrl: user.avatarUrl,
    }).toEqual(PROFILE);
  });

  test(
    givesGcsBack
      ? 'gives back the GCS the suspension took, revoking its warning'
      : 'leaves the GCS and the suspension warning as the suspension left them',
    async () => {
      expect((await end({ admin, member })).status).toBe(200);

      const user = await readUser();
      expect(user.gcsScore).toBe(givesGcsBack ? GCS_BEFORE : 0);
      expect((await suspensionWarnings()).map((w) => w.revoked)).toEqual([givesGcsBack]);
    },
  );

  test('records one ending in the audit log, naming this member', async () => {
    expect((await end({ admin, member })).status).toBe(200);

    expect((await endingsRecorded()).size).toBe(1);
  });
});

// A timed suspension can run out while its appeal waits. The lift clears the
// run start from the user, so the appeal carries it: upheld later, it still
// gives back the GCS that suspension took.
describe('an appeal upheld after its suspension ran out', () => {
  test('gives back the GCS, revoking the warning, with the one ending recorded', async () => {
    await request(app())
      .post(`/api/users/${MEMBER}/appeal`)
      .set(member.headers)
      .send({ appealText: 'I was helping a learner, not harassing them.' })
      .expect(200);
    await db.doc(`users/${MEMBER}`).update({ suspensionEndDate: Date.now() - 60_000 });
    clearAuthCaches();
    await request(app())
      .post(`/api/users/${MEMBER}/lift-suspension`)
      .set(member.headers)
      .expect(200);
    expect((await readUser()).gcsScore).toBe(0);
    const appeals = await db.collection('suspensionAppeals').where('userId', '==', MEMBER).get();
    expect(appeals.size).toBe(1);

    const res = await request(app())
      .patch(`/api/appeals/${appeals.docs[0].id}`)
      .set(admin.headers)
      .send({ status: 'approved' });

    expect(res.status).toBe(200);
    const user = await readUser();
    expect(user.isSuspended).toBe(false);
    expect(user.gcsScore).toBe(GCS_BEFORE);
    expect((await suspensionWarnings()).map((w) => w.revoked)).toEqual([true]);
    expect((await endingsRecorded()).size).toBe(1);
  });
});

// An appeal belongs to the one suspension it answers and never reaches another
// (Shyden, 2026-10-18). Suspension 1 runs out with its appeal waiting, and
// Suspension 2 follows for something new.
describe('an appeal of an earlier suspension, a later one in force', () => {
  async function appeal(text) {
    await request(app())
      .post(`/api/users/${MEMBER}/appeal`)
      .set(member.headers)
      .send({ appealText: text })
      .expect(200);
  }

  async function pendingAppealIds() {
    const snap = await db
      .collection('suspensionAppeals')
      .where('userId', '==', MEMBER)
      .orderBy('createdAt')
      .get();
    return snap.docs.filter((d) => d.data().status === 'pending').map((d) => d.id);
  }

  /** Suspension 1 appealed and run out, Suspension 2 in force and appealed. */
  async function twoSuspensions() {
    await appeal('Suspension 1 was a mistake.');
    await db.doc(`users/${MEMBER}`).update({ suspensionEndDate: Date.now() - 60_000 });
    clearAuthCaches();
    await request(app())
      .post(`/api/users/${MEMBER}/lift-suspension`)
      .set(member.headers)
      .expect(200);
    await request(app())
      .post(`/api/user/${MEMBER}/suspend`)
      .set(admin.headers)
      .send({ reason: 'spam confirmed (SHY-0605 test)', canAppeal: true })
      .expect(200);
    clearAuthCaches();
    await appeal('Suspension 2 was a mistake too.');
    return pendingAppealIds();
  }

  function review(appealId, status) {
    return request(app()).patch(`/api/appeals/${appealId}`).set(admin.headers).send({ status });
  }

  test('the earlier appeal does not stop the later suspension being appealed', async () => {
    expect(await twoSuspensions()).toHaveLength(2);
  });

  test('upholding the earlier appeal leaves the later suspension, its appeal and a 0 score', async () => {
    const [earlier, later] = await twoSuspensions();

    expect((await review(earlier, 'approved')).status).toBe(200);

    const user = await readUser();
    expect(user.isSuspended).toBe(true);
    expect(user.suspensionAppealStatus).toBe('pending');
    expect(user.gcsScore).toBe(0);
    expect(await pendingAppealIds()).toEqual([later]);
    expect((await suspensionWarnings()).map((w) => w.revoked).sort()).toEqual([false, true]);
  });

  test('denying the earlier appeal leaves the later suspension appealable', async () => {
    const [earlier] = await twoSuspensions();

    expect((await review(earlier, 'denied')).status).toBe(200);

    const user = await readUser();
    expect(user.isSuspended).toBe(true);
    expect(user.suspensionCanAppeal).toBe(true);
    expect(user.suspensionAppealStatus).toBe('pending');
  });

  test('upholding both appeals ends the later suspension and gives the whole score back', async () => {
    const [earlier, later] = await twoSuspensions();

    expect((await review(earlier, 'approved')).status).toBe(200);
    expect((await review(later, 'approved')).status).toBe(200);

    const user = await readUser();
    expect(user.isSuspended).toBe(false);
    expect(user.gcsScore).toBe(GCS_BEFORE);
    expect((await suspensionWarnings()).map((w) => w.revoked)).toEqual([true, true]);
  });
});
