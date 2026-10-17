/**
 * Comprehensive coverage tests for src/routes/reports.js
 */
const express = require('express');
const request = require('supertest');

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();
const mockRtdbSet = jest.fn().mockResolvedValue();
const mockRtdbRemove = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
      set: mockDocSet,
      delete: mockDocDelete,
    })),
    collection: jest.fn(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    }),
    batch: jest.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit })),
  },
  rtdb: { ref: jest.fn(() => ({ set: mockRtdbSet, remove: mockRtdbRemove })) },
  FieldValue: {
    arrayRemove: jest.fn(),
    arrayUnion: jest.fn(),
    increment: jest.fn((n) => 'increment(' + n + ')'),
  },
}));
jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'test-id'),
  now: jest.fn(() => 1700000000000),
}));
jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false),
  clearSuspensionCache: jest.fn(),
}));
jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));
jest.mock('../../src/utils/gcs', () => ({
  computeDisplayScore: jest.fn((score) => score),
}));
jest.mock('../../src/utils/fcm', () => ({
  sendPushToUser: jest.fn().mockResolvedValue(),
  sendFcmToIdentifiers: jest.fn().mockResolvedValue({ invalidTokens: [], invalidFids: [] }),
  cleanupInvalidIdentifiers: jest.fn().mockResolvedValue(),
  sendFcmToTokens: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/routes/admin-users', () => ({
  createWarning: jest.fn().mockResolvedValue(),
}));
// SHY-0605: an upheld appeal ends through endSuspension, which has its own
// tests (tests/utils/end-suspension.unit.test.js); here only the route's part.
const mockEndSuspension = jest.fn();
jest.mock('../../src/utils/end-suspension', () => ({
  ...jest.requireActual('../../src/utils/end-suspension'),
  endSuspension: (...args) => mockEndSuspension(...args),
}));
jest.mock('../../src/utils/firestore-helpers', () => {
  const { db } = require('../../src/utils/firebase');
  return {
    getDoc: jest.fn(async (path) => {
      const snap = await db.doc(path).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    }),
    queryDocs: jest.fn(async () => []),
  };
});

const reportsRouter = require('../../src/routes/reports');

function createApp({ uid = 'admin-firebase-uid', uniqueId = 'admin-1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: { admin: true } };
    next();
  });
  app.use('/api', reportsRouter);
  return app;
}

function createUserApp({ uid = 'user-firebase-uid', uniqueId = 'user-123' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: {} };
    next();
  });
  app.use('/api', reportsRouter);
  return app;
}

// =================================================================
// cleanupInvalidAdminTokens + FCM (lines 36-54, 117, 120-133)
// =================================================================

// =================================================================
// GET /api/reports - search + enrichment (lines 172,190,205,213-222,237)
// =================================================================

// =================================================================
// POST /api/reports/:id/resolve - edge cases (lines 372-378,418,430,453,465-469)
// =================================================================

// =================================================================
// POST /api/reports/resolve-all/:userId (lines 505-532,541-607,647,656-660)
// =================================================================

// =================================================================
// GET /api/reports/stats - error (lines 723-724)
// =================================================================

// =================================================================
// GET /api/reports/export - date filters (lines 743,786-787)
// =================================================================

// =================================================================
// POST/DELETE lock - error paths (lines 811-815, 828-832)
// =================================================================

// =================================================================
// POST /api/admin/users/:uniqueId/suspend (lines 842-909)
// =================================================================

// =================================================================
// POST /api/admin/users/:uniqueId/unsuspend (lines 915-963)
// =================================================================

// =================================================================
// POST /api/appeals - edge cases (line 977, 1018-1019)
// =================================================================
describe('POST /api/appeals - edge cases', () => {
  let app, getDoc;
  beforeEach(() => {
    app = createUserApp({ uid: 'user-uid', uniqueId: 'sus-user' });
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
  });

  it('returns 400 when appealText too long', async () => {
    const res = await request(app)
      .post('/api/appeals')
      .send({ appealText: 'a'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when appealText not string', async () => {
    const res = await request(app).post('/api/appeals').send({ appealText: 12345 });
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    getDoc.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).post('/api/appeals').send({ appealText: 'Valid text' });
    expect(res.status).toBe(500);
  });
});

// =================================================================
// GET /api/appeals - status filter + error (lines 1032, 1068-1069)
// =================================================================
describe('GET /api/appeals - status filter and error', () => {
  let app, queryDocs, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ queryDocs, getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('filters by status param', async () => {
    const { db } = require('../../src/utils/firebase');
    queryDocs.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/appeals?status=approved');
    expect(res.status).toBe(200);
    const calls = db.collection.mock.results[0].value.where.mock.calls;
    expect(calls.some((c) => c[2] === 'approved')).toBe(true);
  });

  it('returns all when no status filter', async () => {
    queryDocs.mockResolvedValueOnce([
      { id: 'a1', userId: 'u1', appealText: 'text', status: 'pending', createdAt: 1700000000000 },
    ]);
    getDoc.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/appeals');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('returns 500 on error', async () => {
    queryDocs.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).get('/api/appeals');
    expect(res.status).toBe(500);
  });
});

// =================================================================
// PATCH /api/appeals/:id - edge cases (lines 1150-1154)
// =================================================================
describe('PATCH /api/appeals/:id - edge cases', () => {
  let app, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    mockDocUpdate.mockResolvedValue();
    mockDocSet.mockResolvedValue();
    // The user, read after the appeal: suspended, its run's start unknown, so
    // an appeal that names no run answers the suspension in force (SHY-0605).
    mockDocGet.mockResolvedValue({ exists: true, id: 'u1', data: () => ({ isSuspended: true }) });
  });

  it('returns 404 when not found', async () => {
    getDoc.mockResolvedValueOnce(null);
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });
    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    getDoc.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });
    expect(res.status).toBe(500);
  });

  it('includes adminNote when provided', async () => {
    getDoc.mockResolvedValueOnce({ id: 'a1', userId: 'u1', status: 'pending' });
    const res = await request(app)
      .patch('/api/appeals/a1')
      .send({ status: 'denied', adminNote: 'reason' });
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'denied', adminNote: 'reason' }),
    );
  });

  it('writes APPEAL_DENIED audit log', async () => {
    getDoc.mockResolvedValueOnce({ id: 'a1', userId: 'u1', status: 'pending' });
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'denied' });
    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPEAL_DENIED' }), {
      merge: true,
    });
  });

  it('writes APPEAL_APPROVED audit log', async () => {
    mockEndSuspension.mockResolvedValueOnce({ alreadyEnded: false });
    getDoc.mockResolvedValueOnce({ id: 'a1', userId: 'u1', status: 'pending' });
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'APPEAL_APPROVED' }),
      { merge: true },
    );
  });
});

// GET /api/admin/audit-log — removed from reports.js; now served by
// admin-audit-log.js. See admin-audit-log-suggestions.test.js.

// =================================================================
// evictSuspendedUser (lines 1214-1277) - via suspend endpoint
// =================================================================

// =================================================================
// Additional branch coverage tests
// =================================================================

describe('POST /api/appeals - snake_case user fields', () => {
  let app, getDoc, queryDocs;
  beforeEach(() => {
    // A NUMERIC uniqueId, because that is what one is — `users/{id}.uniqueId`
    // is an integer, so `req.auth.uniqueId` is a Number. This suite is about
    // reading snake_case FIELDS, not about the id's type, and the appeal
    // writer now refuses a non-integer owner rather than silently storing
    // `userId: NaN` (SHY-0463).
    app = createUserApp({ uid: 'uid', uniqueId: 50990490 });
    jest.clearAllMocks();
    ({ getDoc, queryDocs } = require('../../src/utils/firestore-helpers'));
  });

  it('uses is_suspended and suspension_can_appeal snake_case fields', async () => {
    getDoc.mockResolvedValueOnce({
      id: '50990490',
      is_suspended: true,
      suspension_can_appeal: true,
    });
    queryDocs.mockResolvedValueOnce([]);
    const res = await request(app).post('/api/appeals').send({ appealText: 'Please reconsider' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // SHY-0605: an appeal belongs to the one suspension it answers (Shyden,
  // 2026-10-18), so an earlier suspension's appeal, still pending, does not
  // stand in the way of appealing the suspension in force.
  it('accepts an appeal while an earlier suspension’s appeal is still pending', async () => {
    getDoc.mockResolvedValueOnce({
      id: '50990490',
      isSuspended: true,
      suspensionCanAppeal: true,
      suspensionRunStartedAt: 1709500000000,
    });
    queryDocs.mockResolvedValueOnce([
      { id: 'earlier', status: 'pending', suspensionRunStartedAt: 1709000000000 },
    ]);

    const res = await request(app).post('/api/appeals').send({ appealText: 'A new appeal' });

    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', suspensionRunStartedAt: 1709500000000 }),
      { merge: true },
    );
  });

  it('refuses a second appeal of the suspension in force', async () => {
    getDoc.mockResolvedValueOnce({
      id: '50990490',
      isSuspended: true,
      suspensionCanAppeal: true,
      suspensionRunStartedAt: 1709500000000,
    });
    queryDocs.mockResolvedValueOnce([
      { id: 'current', status: 'pending', suspensionRunStartedAt: 1709500000000 },
    ]);

    const res = await request(app).post('/api/appeals').send({ appealText: 'Again' });

    expect(res.status).toBe(409);
    expect(mockDocSet).not.toHaveBeenCalled();
  });
});

describe('GET /api/appeals - snake_case enrichment', () => {
  let app, queryDocs, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ queryDocs, getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
  });

  it('uses user_id from appeal and snake_case user fields', async () => {
    queryDocs.mockResolvedValueOnce([
      { id: 'a1', user_id: 'u1', appealText: 'text', status: 'pending', createdAt: 1700000000000 },
    ]);
    getDoc.mockResolvedValueOnce({
      id: 'u1',
      unique_id: 42,
      display_name: 'Snake',
      profile_photo_url: 'sp.jpg',
      suspension_reason: 'spam',
      suspension_start_date: 1699e9,
      suspension_end_date: null,
    });
    const res = await request(app).get('/api/appeals');
    expect(res.status).toBe(200);
    expect(res.body[0].userUniqueId).toBe(42);
    expect(res.body[0].userDisplayName).toBe('Snake');
    expect(res.body[0].userInfo.suspensionReason).toBe('spam');
  });

  it('sorts appeals by createdAt descending', async () => {
    queryDocs.mockResolvedValueOnce([
      { id: 'a1', userId: 'u1', appealText: 't1', status: 'pending', createdAt: 1699e9 },
      { id: 'a2', userId: 'u2', appealText: 't2', status: 'pending', createdAt: 1700e9 },
    ]);
    getDoc.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const res = await request(app).get('/api/appeals');
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe('a2');
    expect(res.body[1].id).toBe('a1');
  });
});

describe('PATCH /api/appeals/:id - requireAdmin blocks + user_id fallback', () => {
  let app, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    mockDocUpdate.mockResolvedValue();
    mockDocSet.mockResolvedValue();
    // The user, read after the appeal: suspended, its run's start unknown, so
    // an appeal that names no run answers the suspension in force (SHY-0605).
    mockDocGet.mockResolvedValue({ exists: true, id: 'u1', data: () => ({ isSuspended: true }) });
  });

  it('returns 403 when admin check fails', async () => {
    require('../../src/middleware/auth').requireAdmin.mockImplementation((_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
      return true;
    });
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });
    expect(res.status).toBe(403);
  });

  it('uses user_id when userId absent', async () => {
    getDoc.mockResolvedValueOnce({ id: 'a1', user_id: 'u1', status: 'pending' });
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'denied' });
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ suspensionAppealStatus: 'denied' }),
    );
  });

  it('ends the suspension of the user named by user_id when userId is absent', async () => {
    mockEndSuspension.mockResolvedValueOnce({ alreadyEnded: false });
    getDoc.mockResolvedValueOnce({ id: 'a1', user_id: 'u1', status: 'pending' });

    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(mockEndSuspension).toHaveBeenCalledWith('u1', expect.anything());
  });
});

// =================================================================
// PATCH /api/appeals/:id --- an upheld appeal ends through endSuspension
// (SHY-0605). What the ending puts back (profile, snake_case saves, GCS,
// bans, cache) is tested once, in tests/utils/end-suspension.unit.test.js.
// =================================================================
describe('PATCH /api/appeals/:id --- an upheld appeal ends through endSuspension (SHY-0605)', () => {
  const { SuspensionEndError } = jest.requireActual('../../src/utils/end-suspension');
  let app, getDoc;
  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    ({ getDoc } = require('../../src/utils/firestore-helpers'));
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    mockDocUpdate.mockResolvedValue();
    mockDocSet.mockResolvedValue();
    // The user, read after the appeal: suspended, its run's start unknown, so
    // an appeal that names no run answers the suspension in force (SHY-0605).
    mockDocGet.mockResolvedValue({ exists: true, id: 'u1', data: () => ({ isSuspended: true }) });
    mockEndSuspension.mockReset().mockResolvedValue({ alreadyEnded: false });
    getDoc.mockResolvedValueOnce({ id: 'a1', userId: 'u1', status: 'pending' });
  });

  it('ends the suspension as the admin, naming the appeal, with the GCS given back', async () => {
    await request(app).patch('/api/appeals/a1').send({ status: 'approved' });

    expect(mockEndSuspension).toHaveBeenCalledTimes(1);
    expect(mockEndSuspension).toHaveBeenCalledWith('u1', {
      actor: 'admin-firebase-uid',
      trigger: 'APPEAL_APPROVED',
      restoreGcs: true,
      appeal: { id: 'a1', userId: 'u1', status: 'pending' },
    });
  });

  it('writes the user’s appeal fields when the appeal answers the suspension in force', async () => {
    await request(app).patch('/api/appeals/a1').send({ status: 'denied' });

    expect(mockDocUpdate).toHaveBeenCalledWith({
      suspensionAppealStatus: 'denied',
      suspensionCanAppeal: false,
    });
  });

  it('ends nothing when the appeal is denied', async () => {
    const res = await request(app).patch('/api/appeals/a1').send({ status: 'denied' });

    expect(res.status).toBe(200);
    expect(mockEndSuspension).not.toHaveBeenCalled();
  });

  it('marks the appeal approved before ending the suspension', async () => {
    await request(app).patch('/api/appeals/a1').send({ status: 'approved' });

    const marked = mockDocUpdate.mock.calls.findIndex(([fields]) => fields.status === 'approved');
    expect(marked).toBeGreaterThanOrEqual(0);
    expect(mockDocUpdate.mock.invocationCallOrder[marked]).toBeLessThan(
      mockEndSuspension.mock.invocationCallOrder[0],
    );
  });

  it('writes no ending itself: the profile and cache are the ending’s', async () => {
    await request(app).patch('/api/appeals/a1').send({ status: 'approved' });

    expect(mockDocUpdate.mock.calls.map(([fields]) => fields.isSuspended)).not.toContain(false);
    expect(require('../../src/middleware/auth').clearSuspensionCache).not.toHaveBeenCalled();
  });

  it('answers success for an appeal whose user is no longer suspended', async () => {
    mockEndSuspension.mockResolvedValueOnce({ alreadyEnded: true });

    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ success: true });
  });

  it('answers 500 naming the step when the ending stops, recording no decision yet', async () => {
    mockEndSuspension.mockRejectedValueOnce(new SuspensionEndError('warnings', 'revoke failed'));

    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });

    expect(res.status).toBe(500);
    expect(res.body).toStrictEqual({
      error: 'The suspension could not be fully ended. The user is still suspended.',
      step: 'warnings',
    });
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  it('answers 500 without a step for any other failure', async () => {
    mockEndSuspension.mockRejectedValueOnce(new Error('boom'));

    const res = await request(app).patch('/api/appeals/a1').send({ status: 'approved' });

    expect(res.status).toBe(500);
    expect(res.body).toStrictEqual({ error: 'Internal server error' });
  });
});

// An appeal belongs to the one suspension it answers (Shyden, 2026-10-18).
// An appeal of an earlier suspension, decided while a later one is in force,
// must not touch the later one's appeal fields: a denial would otherwise
// forbid appealing the later suspension at all (SHY-0605).
describe('PATCH /api/appeals/:id --- an appeal of an earlier suspension, a later one in force', () => {
  const EARLIER = {
    id: 'a1',
    userId: 'u1',
    status: 'pending',
    suspensionRunStartedAt: 1709000000000,
  };
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    require('../../src/middleware/auth').requireAdmin.mockReturnValue(false);
    mockDocUpdate.mockResolvedValue();
    mockDocSet.mockResolvedValue();
    mockEndSuspension.mockReset().mockResolvedValue({ alreadyEnded: true });
    require('../../src/utils/firestore-helpers')
      .getDoc.mockResolvedValueOnce(EARLIER)
      .mockResolvedValueOnce({
        id: 'u1',
        isSuspended: true,
        suspensionRunStartedAt: 1709500000000,
      });
  });

  function userAppealFieldsWritten() {
    return mockDocUpdate.mock.calls.filter(
      ([fields]) => 'suspensionAppealStatus' in fields || 'suspensionCanAppeal' in fields,
    );
  }

  it.each(['approved', 'denied'])('marks the appeal %s', async (status) => {
    const res = await request(app).patch('/api/appeals/a1').send({ status });

    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ status }));
  });

  it.each(['approved', 'denied'])(
    'leaves the later suspension’s appeal fields alone when %s',
    async (status) => {
      await request(app).patch('/api/appeals/a1').send({ status });

      expect(userAppealFieldsWritten()).toStrictEqual([]);
    },
  );

  it('hands the ending the appeal, which decides what it gives back', async () => {
    await request(app).patch('/api/appeals/a1').send({ status: 'approved' });

    expect(mockEndSuspension).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ restoreGcs: true, appeal: EARLIER }),
    );
  });
});

// GET /api/admin/audit-log - admin name enrichment — removed from reports.js;
// now served by admin-audit-log.js. See admin-audit-log-suggestions.test.js.
