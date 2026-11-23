import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addressHash } from '../../workers/web/src/app/email-code.ts';
import { FORGET_TRIES_MS, replaceRecoveryCodes, useRecoveryCode, type CodeSignInEnv } from '../../workers/web/src/app/recovery-codes.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * Recovery codes on a real D1 (plan 7 Task 3, shyden-labs/ShyTalk#134 AC3):
 * migrations/0007_passkeys.sql's tables.
 */

let local: LocalDevEnv;
let dispose: () => Promise<void>;
let env: CodeSignInEnv;

beforeAll(async () => {
  ({ env: local, dispose } = await localDev());
  env = {
    ENVIRONMENT_NAME: 'dev',
    BETTER_AUTH_SECRET: 'an-integration-secret-long-enough-for-better-auth',
    DB: local.DB,
  } as unknown as CodeSignInEnv;
});

afterAll(async () => {
  await dispose();
});

async function memberWithCodes(id: string, email: string): Promise<string[]> {
  const at = new Date().toISOString();
  await local.DB.prepare('INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)')
    .bind(id, 'Member', email, at, at)
    .run();
  const { statements, codes } = await replaceRecoveryCodes(env, id, `user:${id}`);
  await local.DB.batch(statements as Parameters<LocalDevEnv['DB']['batch']>[0]);
  return codes;
}

describe('recovery codes on D1', () => {
  // One member's set, made once, carries every check (shyden-labs/ShyTalk#180).
  it('works each code once, counts down the codes left, and ends the old set when a new one is made', async () => {
    const codes = await memberWithCodes('u-codes', 'codes@example.test');
    const [first = '', second = '', third = ''] = codes;
    expect.soft(await useRecoveryCode(env, 'codes@example.test', first, Date.now())).toEqual({ userId: 'u-codes', left: 9 });
    expect.soft(await useRecoveryCode(env, 'codes@example.test', first, Date.now())).toBeNull();
    expect.soft(await useRecoveryCode(env, 'codes@example.test', second.toLowerCase(), Date.now())).toEqual({ userId: 'u-codes', left: 8 });

    const { statements } = await replaceRecoveryCodes(env, 'u-codes', 'user:u-codes');
    await local.DB.batch(statements as Parameters<LocalDevEnv['DB']['batch']>[0]);
    expect.soft(await useRecoveryCode(env, 'codes@example.test', third, Date.now())).toBeNull();
  });

  it('locks the address after five wrong tries, even for a right code, however many arrive at once', async () => {
    const [good = ''] = await memberWithCodes('u-lock', 'lock@example.test');
    const wrong = await Promise.all(
      Array.from({ length: 8 }, () => useRecoveryCode(env, 'lock@example.test', '0000-0000-0000-0000', Date.now())),
    );
    expect(wrong.every((answer) => answer === null)).toBe(true);
    expect(await useRecoveryCode(env, 'lock@example.test', good, Date.now())).toBeNull();
    expect(await useRecoveryCode(env, 'lock@example.test', good, Date.now() + 15 * 60_000 + 1)).toEqual({ userId: 'u-lock', left: 9 });
  });

  it('doubles the lock after each spent window', async () => {
    const [good = ''] = await memberWithCodes('u-doubling', 'doubling@example.test');
    const wrongFive = async (at: number) => {
      for (let i = 0; i < 5; i += 1) await useRecoveryCode(env, 'doubling@example.test', '0000-0000-0000-0000', at);
    };
    const start = Date.now();
    const minutes = (n: number) => start + n * 60_000;
    await wrongFive(start);
    await wrongFive(minutes(16));
    // The second lock, from minute 16, lasts 30 minutes: still locked at 45, open at 47.
    expect(await useRecoveryCode(env, 'doubling@example.test', good, minutes(45))).toBeNull();
    expect(await useRecoveryCode(env, 'doubling@example.test', good, minutes(47))).toEqual({ userId: 'u-doubling', left: 9 });
  });

  // shyden-labs/ShyTalk#230: wrong tries are forgotten 30 days after the last one, pruned on write; a right code forgets at once.
  it('forgets an address 30 days after its last wrong try, keeps one inside 30 days, and forgets at once after a right code', async () => {
    const wrong = '0000-0000-0000-0000';
    const row = async (email: string) =>
      local.DB.prepare('SELECT wrong_tries, last_at FROM sign_in_lock WHERE address_hash = ? AND kind = ?')
        .bind(await addressHash(env.BETTER_AUTH_SECRET, email), 'recovery-code')
        .first<{ wrong_tries: number; last_at: number }>();
    const now = Date.now();
    await useRecoveryCode(env, 'forget-old@example.test', wrong, now - FORGET_TRIES_MS - 1);
    await useRecoveryCode(env, 'forget-edge@example.test', wrong, now - FORGET_TRIES_MS);
    await useRecoveryCode(env, 'forget-recent@example.test', wrong, now - 1_000);
    expect.soft(await row('forget-old@example.test')).toEqual({ wrong_tries: 1, last_at: now - FORGET_TRIES_MS - 1 });

    await useRecoveryCode(env, 'forget-trigger@example.test', wrong, now);
    expect.soft(await row('forget-old@example.test')).toBeNull();
    expect.soft(await row('forget-edge@example.test')).toEqual({ wrong_tries: 1, last_at: now - FORGET_TRIES_MS });
    expect.soft(await row('forget-recent@example.test')).toEqual({ wrong_tries: 1, last_at: now - 1_000 });

    const [good = ''] = await memberWithCodes('u-forget', 'forget-right@example.test');
    await useRecoveryCode(env, 'forget-right@example.test', wrong, now);
    expect.soft(await row('forget-right@example.test')).toEqual({ wrong_tries: 1, last_at: now });
    expect.soft(await useRecoveryCode(env, 'forget-right@example.test', good, now)).toEqual({ userId: 'u-forget', left: 9 });
    expect.soft(await row('forget-right@example.test')).toBeNull();
  });
});
