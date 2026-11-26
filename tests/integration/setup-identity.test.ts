import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenHash } from '../../workers/web/src/app/email-code.ts';
import { setupIdentity, type SetupEnv } from '../../workers/web/src/app/setup-identity.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * Who is setting up, on a real D1 (plan 7 Task 2, shyden-labs/ShyTalk#134):
 * one sign-up token used from two tabs at one moment names one member.
 */

let local: LocalDevEnv;
let dispose: () => Promise<void>;
let env: SetupEnv;

beforeAll(async () => {
  ({ env: local, dispose } = await localDev());
  env = { ENVIRONMENT_NAME: 'dev', DB: local.DB } as unknown as SetupEnv;
});

afterAll(async () => {
  await dispose();
});

describe('setupIdentity on D1', () => {
  it('names one member when one sign-up token is used twice at once', async () => {
    await local.DB.prepare("INSERT INTO one_time_token (token_hash, purpose, user_id, email, expires_at) VALUES (?, 'sign-up', NULL, ?, ?)")
      .bind(await tokenHash('two-tabs'), 'two-tabs@example.test', Date.now() + 600_000)
      .run();
    let made = 0;
    const deps = { now: Date.now, newId: () => `u-tab-${String((made += 1))}` };
    const [first, second] = await Promise.all([setupIdentity(env, null, 'two-tabs', deps), setupIdentity(env, null, 'two-tabs', deps)]);
    expect(first).toMatchObject({ kind: 'sign-up' });
    expect(second).toMatchObject({ kind: 'sign-up' });
    expect((first as { userId: string }).userId).toBe((second as { userId: string }).userId);
  });
});
