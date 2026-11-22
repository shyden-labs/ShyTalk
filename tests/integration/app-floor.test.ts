import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkFloor, d1FloorStore, type FloorStore } from '../../workers/web/src/app/floor.ts';
import { appHeaders } from '../support/app-headers.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * The version floor on a real D1 (plan 6.1 Task 3, shyden-labs/ShyTalk#77):
 * the table migrations/0012_app_floor.sql makes, read before an app route.
 */

let env: LocalDevEnv;
let dispose: () => Promise<void>;
let store: FloorStore;

beforeAll(async () => {
  ({ env, dispose } = await localDev());
  store = d1FloorStore(env.DB);
  await env.DB.prepare(
    "INSERT INTO app_floor (platform, min_version, set_at, set_by) VALUES ('android', '1.10.0', 0, 'ci:integration')",
  ).run();
});

afterAll(async () => {
  await env.DB.prepare('DELETE FROM app_floor').run();
  await dispose();
});

const ui = (version: string): Request => new Request('https://site.example.test/api/app/ui', { headers: appHeaders('android', version) });

describe('the version floor on D1', () => {
  it('refuses an Android app under the floor in the table', async () => {
    const response = await checkFloor(ui('1.9.0'), store);
    expect(response?.status).toBe(426);
    expect(await response?.text()).toBe('{"error":"update_required","floor":"1.10.0"}');
  });

  it('lets an Android app at the floor through', async () => {
    expect(await checkFloor(ui('1.10.0'), store)).toBeNull();
  });

  it('holds the iPhone app to no floor while its row is absent', async () => {
    expect(await store.floor('ios')).toBeNull();
  });

  it('refuses a floor row for the website', async () => {
    await expect(
      env.DB.prepare("INSERT INTO app_floor (platform, min_version, set_at, set_by) VALUES ('web', '1.0.0', 0, 'ci:integration')").run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});
