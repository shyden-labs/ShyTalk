import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOTP } from '@better-auth/utils/otp';
import { confirmTotp, decryptSecret, setupTotp, signInTotp, totpGoesLive, type TotpEnv } from '../../workers/web/src/app/totp.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * The authenticator app on a real D1 (plan 7 Task 4, shyden-labs/ShyTalk#134
 * AC2): one code signs in once, even when sent twice at one moment.
 */

let local: LocalDevEnv;
let dispose: () => Promise<void>;
let env: TotpEnv;

beforeAll(async () => {
  ({ env: local, dispose } = await localDev());
  env = {
    ENVIRONMENT_NAME: 'dev',
    BETTER_AUTH_SECRET: 'an-integration-secret-long-enough-for-better-auth',
    TOTP_KEY: 'an-integration-totp-key-long-enough',
    DB: local.DB,
  } as unknown as TotpEnv;
});

afterAll(async () => {
  await dispose();
});

async function liveAuthenticator(id: string, email: string): Promise<Uint8Array> {
  const at = new Date().toISOString();
  await local.DB.prepare('INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)')
    .bind(id, 'Member', email, at, at)
    .run();
  expect(await setupTotp(env, id, email, Date.now(), { flow: 'session' })).not.toBeNull();
  const row = await local.DB.prepare('SELECT secret_enc FROM totp_pending WHERE user_id = ?').bind(id).first<{ secret_enc: string }>();
  const secret = await decryptSecret(env.TOTP_KEY, row?.secret_enc ?? '');
  if (secret === null) throw new Error('the stored secret did not open');
  const step = Math.floor(Date.now() / 30_000) - 1;
  const confirmed = await confirmTotp(env, id, await createOTP(secret, { digits: 6, period: 30 }).hotp(step), Date.now(), 'session');
  if (confirmed === null) throw new Error('the code was not confirmed');
  await local.DB.batch(totpGoesLive(env, id, confirmed, Date.now()) as Parameters<LocalDevEnv['DB']['batch']>[0]);
  return secret;
}

describe('the authenticator app on D1', () => {
  it('signs in once with one code, however many times it is sent at one moment', async () => {
    const secret = await liveAuthenticator('u-totp', 'totp@example.test');
    const code = await createOTP(secret, { digits: 6, period: 30 }).hotp(Math.floor(Date.now() / 30_000));
    const answers = await Promise.all([1, 2, 3].map(() => signInTotp(env, 'totp@example.test', code, Date.now())));
    expect(answers.filter((answer) => answer === 'u-totp')).toHaveLength(1);
    expect(await signInTotp(env, 'totp@example.test', code, Date.now())).toBeNull();
  });

  it('keeps a live authenticator when setup is asked for again', async () => {
    await liveAuthenticator('u-totp-2', 'totp-2@example.test');
    expect(await setupTotp(env, 'u-totp-2', 'totp-2@example.test', Date.now(), { flow: 'session' })).toBeNull();
  });

  it('leaves a live authenticator untouched while a recovery sets up a new one', async () => {
    const old = await liveAuthenticator('u-totp-3', 'totp-3@example.test');
    expect(
      await setupTotp(env, 'u-totp-3', 'totp-3@example.test', Date.now(), { flow: 'recovery-hash', replaceLive: true }),
    ).not.toBeNull();
    const code = await createOTP(old, { digits: 6, period: 30 }).hotp(Math.floor(Date.now() / 30_000));
    expect(await signInTotp(env, 'totp-3@example.test', code, Date.now())).toBe('u-totp-3');
  });
});
