import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { d1StaffFloorStore, handleStaffApi, type StaffDeps } from '../../workers/web/src/staff/floor-route.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * The staff floor routes on a real D1 (plan 6.1 Task 4, shyden-labs/ShyTalk#77
 * AC 3-4): each move lands in `app_floor` with its audit row, and a lower floor
 * needs force. The session is stood in; the staff list is the real check.
 */

let env: LocalDevEnv;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await localDev());
});

afterAll(async () => {
  await env.DB.prepare('DELETE FROM app_floor').run();
  await dispose();
});

const as = (userId: string): StaffDeps => ({
  session: () => Promise.resolve({ userId }),
  staff: { STAFF_ADMINS: 'u-admin' },
  store: d1StaffFloorStore(env),
});

const post = (body: unknown): Request =>
  new Request('https://site.example.test/api/staff/floor', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const read = (): Request => new Request('https://site.example.test/api/staff/floor');

describe('the staff floor on D1', () => {
  it('sets, reads, refuses a lower floor until forced, and audits each move', async () => {
    expect((await handleStaffApi(post({ platform: 'android', version: '1.5.0' }), as('u-admin'))).status).toBe(200);
    expect(await (await handleStaffApi(read(), as('u-admin'))).json()).toEqual({ android: '1.5.0', ios: null });

    const lower = await handleStaffApi(post({ platform: 'android', version: '1.4.0' }), as('u-admin'));
    expect(lower.status).toBe(409);
    expect(await lower.json()).toEqual({ error: 'floor_lower', current: '1.5.0' });

    expect((await handleStaffApi(post({ platform: 'android', version: '1.6.0' }), as('u-member'))).status).toBe(403);

    expect((await handleStaffApi(post({ platform: 'android', version: '1.4.0', force: true }), as('u-admin'))).status).toBe(200);
    expect(await (await handleStaffApi(read(), as('u-admin'))).json()).toEqual({ android: '1.4.0', ios: null });

    const row = await env.DB.prepare('SELECT min_version, set_by FROM app_floor WHERE platform = ?').bind('android').first();
    expect(row).toEqual({ min_version: '1.4.0', set_by: 'staff:u-admin' });
    const audits = await env.DB.prepare(
      "SELECT actor, subject, detail, environment FROM audit WHERE action = 'floor.set' ORDER BY id",
    ).all();
    expect(audits.results).toEqual([
      {
        actor: 'staff:u-admin',
        subject: 'app_floor',
        detail: '{"platform":"android","from":null,"to":"1.5.0","force":false}',
        environment: 'dev',
      },
      {
        actor: 'staff:u-admin',
        subject: 'app_floor',
        detail: '{"platform":"android","from":"1.5.0","to":"1.4.0","force":true}',
        environment: 'dev',
      },
    ]);
  });
});
