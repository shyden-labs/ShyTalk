import { describe, expect, it } from 'vitest';
import { d1StaffFloorStore, handleStaffApi, type FloorChange, type StaffDeps } from '../../workers/web/src/staff/floor-route.ts';
import { floorMessage } from '../../apps/web/src/staff/answers.ts';

/**
 * The staff floor routes (plan 6.1 Task 4, shyden-labs/ShyTalk#77 AC 3-4):
 * who may see and move each platform's oldest allowed app version, and the
 * audit row every move writes beside it.
 */

const ADMIN = 'u-admin';
const MEMBER = 'u-member';

function deps(userId: string | null, floors: { android: string | null; ios: string | null } = { android: '1.4.0', ios: null }) {
  const changes: FloorChange[] = [];
  const value: StaffDeps = {
    session: () => Promise.resolve(userId === null ? null : { userId }),
    staff: { STAFF_ADMINS: ADMIN },
    store: {
      read: () => Promise.resolve(floors),
      set: (change) => {
        changes.push(change);
        return Promise.resolve();
      },
    },
  };
  return { value, changes };
}

const get = (path: string): Request => new Request(`https://site.example.test/api/staff/${path}`);
const post = (body: unknown): Request =>
  new Request('https://site.example.test/api/staff/floor', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('GET /api/staff/me', () => {
  it('lists an admin’s permissions', async () => {
    const response = await handleStaffApi(get('me'), deps(ADMIN).value);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ permissions: ['floor.manage'] });
  });

  it('lists no permissions for a member with no role', async () => {
    expect(await (await handleStaffApi(get('me'), deps(MEMBER).value)).json()).toEqual({ permissions: [] });
  });

  it('answers 401 signed out', async () => {
    expect((await handleStaffApi(get('me'), deps(null).value)).status).toBe(401);
  });
});

describe('GET /api/staff/floor', () => {
  it('shows an admin both floors', async () => {
    const response = await handleStaffApi(get('floor'), deps(ADMIN).value);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ android: '1.4.0', ios: null });
  });

  it('answers 401 signed out', async () => {
    expect((await handleStaffApi(get('floor'), deps(null).value)).status).toBe(401);
  });

  it('answers 403 without floor.manage', async () => {
    const response = await handleStaffApi(get('floor'), deps(MEMBER).value);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'not_allowed' });
  });
});

describe('POST /api/staff/floor', () => {
  it('raises the floor and records the change', async () => {
    const { value, changes } = deps(ADMIN);
    const response = await handleStaffApi(post({ platform: 'android', version: '1.5.0' }), value);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ platform: 'android', version: '1.5.0' });
    expect(changes).toEqual([{ platform: 'android', from: '1.4.0', to: '1.5.0', force: false, actor: `staff:${ADMIN}` }]);
  });

  it('sets a first floor where none was set', async () => {
    const { value, changes } = deps(ADMIN);
    expect((await handleStaffApi(post({ platform: 'ios', version: '1.0.0' }), value)).status).toBe(200);
    expect(changes).toEqual([{ platform: 'ios', from: null, to: '1.0.0', force: false, actor: `staff:${ADMIN}` }]);
  });

  it('sets the same version again without force', async () => {
    const { value } = deps(ADMIN);
    expect((await handleStaffApi(post({ platform: 'android', version: '1.4.0' }), value)).status).toBe(200);
  });

  it('refuses a lower floor without force, naming the current one, and changes nothing', async () => {
    const { value, changes } = deps(ADMIN);
    const response = await handleStaffApi(post({ platform: 'android', version: '1.3.9' }), value);
    expect(response.status).toBe(409);
    expect(await response.text()).toBe('{"error":"floor_lower","current":"1.4.0"}');
    expect(changes).toEqual([]);
  });

  it('sets a lower floor with force and records the force', async () => {
    const { value, changes } = deps(ADMIN);
    const response = await handleStaffApi(post({ platform: 'android', version: '1.3.9', force: true }), value);
    expect(response.status).toBe(200);
    expect(changes).toEqual([{ platform: 'android', from: '1.4.0', to: '1.3.9', force: true, actor: `staff:${ADMIN}` }]);
  });

  it('orders versions by number, so 1.10.0 is above 1.9.0', async () => {
    const { value } = deps(ADMIN, { android: '1.9.0', ios: null });
    expect((await handleStaffApi(post({ platform: 'android', version: '1.10.0' }), value)).status).toBe(200);
  });

  it('answers 400 for a version that is not MAJOR.MINOR.PATCH', async () => {
    const { value, changes } = deps(ADMIN);
    const response = await handleStaffApi(post({ platform: 'android', version: '1.5' }), value);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad_version' });
    expect(changes).toEqual([]);
  });

  it('answers 400 for a version that is not text', async () => {
    expect((await handleStaffApi(post({ platform: 'android', version: 150 }), deps(ADMIN).value)).status).toBe(400);
  });

  it('answers 400 for the website, which has no floor', async () => {
    const response = await handleStaffApi(post({ platform: 'web', version: '1.0.0' }), deps(ADMIN).value);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad_platform' });
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await handleStaffApi(post('not json'), deps(ADMIN).value);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad_request' });
  });

  it('answers 400 for a JSON body that is not an object', async () => {
    expect((await handleStaffApi(post('null'), deps(ADMIN).value)).status).toBe(400);
  });

  it('answers 400 for a force that is not true or false', async () => {
    expect((await handleStaffApi(post({ platform: 'android', version: '1.3.0', force: 'yes' }), deps(ADMIN).value)).status).toBe(400);
  });

  it('answers 401 signed out', async () => {
    expect((await handleStaffApi(post({ platform: 'android', version: '1.5.0' }), deps(null).value)).status).toBe(401);
  });

  it('answers 403 without floor.manage and changes nothing', async () => {
    const { value, changes } = deps(MEMBER);
    expect((await handleStaffApi(post({ platform: 'android', version: '1.5.0' }), value)).status).toBe(403);
    expect(changes).toEqual([]);
  });
});

describe('other staff calls', () => {
  it('answers 404 for a path it does not serve', async () => {
    expect((await handleStaffApi(get('nothing'), deps(ADMIN).value)).status).toBe(404);
  });

  it('answers 405 for a method floor does not take', async () => {
    const response = await handleStaffApi(
      new Request('https://site.example.test/api/staff/floor', { method: 'DELETE' }),
      deps(ADMIN).value,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, POST');
  });

  it('answers 405 for a method me does not take', async () => {
    const response = await handleStaffApi(new Request('https://site.example.test/api/staff/me', { method: 'POST' }), deps(ADMIN).value);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });
});

interface Bound {
  sql: string;
  values: unknown[];
}

function fakeDb(rows: unknown[]) {
  const batches: Bound[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind: (...values: unknown[]) => ({ sql, values }),
        all: () => Promise.resolve({ results: rows }),
      };
    },
    batch(statements: Bound[]) {
      batches.push(statements.map(({ sql, values }) => ({ sql, values })));
      return Promise.resolve([]);
    },
  };
  return { db, batches };
}

describe('d1StaffFloorStore', () => {
  it('reads both platforms’ rows, a missing one as null', async () => {
    const { db } = fakeDb([{ platform: 'android', min_version: '1.4.0' }]);
    expect(await d1StaffFloorStore({ ENVIRONMENT_NAME: 'dev', DB: db }).read()).toEqual({ android: '1.4.0', ios: null });
  });

  it('writes the floor and its audit row in one batch', async () => {
    const { db, batches } = fakeDb([]);
    await d1StaffFloorStore({ ENVIRONMENT_NAME: 'dev', DB: db }).set({
      platform: 'ios',
      from: '1.0.0',
      to: '0.9.0',
      force: true,
      actor: 'staff:u1',
    });
    expect(batches).toHaveLength(1);
    const [upsert, row] = batches[0] ?? [];
    expect(upsert?.sql).toBe(
      'INSERT INTO app_floor (platform, min_version, set_at, set_by) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT (platform) DO UPDATE SET min_version = excluded.min_version, set_at = excluded.set_at, set_by = excluded.set_by',
    );
    expect(upsert?.values.slice(0, 2)).toEqual(['ios', '0.9.0']);
    expect(typeof upsert?.values[2]).toBe('number');
    expect(upsert?.values[3]).toBe('staff:u1');
    expect(row?.values.slice(1)).toEqual([
      'staff:u1',
      'floor.set',
      'app_floor',
      '{"platform":"ios","from":"1.0.0","to":"0.9.0","force":true}',
      'dev',
    ]);
  });
});

describe('floorMessage', () => {
  it.each([
    [200, 'saved'],
    [401, 'signedOut'],
    [403, 'notAllowed'],
    [409, 'lower'],
    [400, 'failed'],
    [500, 'failed'],
    [0, 'failed'],
  ] as const)('answers %i with %s', (status, message) => {
    expect(floorMessage(status)).toBe(message);
  });
});
