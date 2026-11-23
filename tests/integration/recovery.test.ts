import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenHash } from '../../workers/web/src/app/email-code.ts';
import { handleRecoveryCancel, handleRecoveryPending, type RecoveryEnv, type SessionOf } from '../../workers/web/src/app/recovery.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * A pending recovery on a real D1 (plan 6 Task 4, shyden-labs/ShyTalk#133):
 * the tables from migrations/0006_email_codes.sql; the session is stood in.
 */

let local: LocalDevEnv;
let dispose: () => Promise<void>;
let env: RecoveryEnv;
const NOW = Date.now();

beforeAll(async () => {
  ({ env: local, dispose } = await localDev());
  env = { ENVIRONMENT_NAME: 'dev', DB: local.DB } as unknown as RecoveryEnv;
});

afterAll(async () => {
  await dispose();
});

async function recovery(userId: string, cancelToken: string, state = 'pending'): Promise<void> {
  await local.DB.prepare(
    'INSERT INTO account_recovery (user_id, started_at, completes_at, cancel_token_hash, state) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(userId, NOW, NOW + 86_400_000, await tokenHash(cancelToken), state)
    .run();
}

const cancelBy = (cancelToken: string): Request =>
  new Request('https://site.example.test/api/app/recovery/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cancelToken }),
  });

const nobody: SessionOf = () => Promise.resolve(null);
const sessionFor =
  (userId: string): SessionOf =>
  () =>
    Promise.resolve({ sessionId: 's', userId, email: `${userId}@example.test`, createdAt: NOW });

const audits = async (subject: string): Promise<number> =>
  (
    await local.DB.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'recovery.cancel' AND subject = ?")
      .bind(subject)
      .first<{ n: number }>()
  )?.n ?? -1;

describe('recovery on D1', () => {
  it('cancels by the email link once; the link used again changes nothing', async () => {
    await recovery('u-link', 'link-token-1');
    expect((await handleRecoveryCancel(cancelBy('link-token-1'), env, nobody)).status).toBe(200);
    expect((await handleRecoveryCancel(cancelBy('link-token-1'), env, nobody)).status).toBe(200);
    const row = await local.DB.prepare('SELECT state FROM account_recovery WHERE user_id = ?').bind('u-link').first<{ state: string }>();
    expect(row?.state).toBe('cancelled');
    expect(await audits('user:u-link')).toBe(1);
  });

  it('leaves a completed recovery alone when its link is used', async () => {
    await recovery('u-done', 'link-token-2', 'completed');
    expect((await handleRecoveryCancel(cancelBy('link-token-2'), env, nobody)).status).toBe(200);
    const row = await local.DB.prepare('SELECT state FROM account_recovery WHERE user_id = ?').bind('u-done').first<{ state: string }>();
    expect(row?.state).toBe('completed');
    expect(await audits('user:u-done')).toBe(0);
  });

  it('shows a signed-in device the pending recovery, then nothing once it is cancelled there', async () => {
    await recovery('u-device', 'link-token-3');
    const pending = await handleRecoveryPending(new Request('https://site.example.test/api/app/recovery'), env, sessionFor('u-device'));
    expect(((await pending.json()) as { pending: unknown }).pending).not.toBeNull();
    const cancel = new Request('https://site.example.test/api/app/recovery/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect((await handleRecoveryCancel(cancel, env, sessionFor('u-device'))).status).toBe(200);
    const after = await handleRecoveryPending(new Request('https://site.example.test/api/app/recovery'), env, sessionFor('u-device'));
    expect(await after.json()).toEqual({ pending: null });
  });

  it('writes one audit row when two cancels arrive at one moment', async () => {
    await recovery('u-twice', 'link-token-4');
    await Promise.all([
      handleRecoveryCancel(cancelBy('link-token-4'), env, nobody),
      handleRecoveryCancel(cancelBy('link-token-4'), env, nobody),
    ]);
    expect(await audits('user:u-twice')).toBe(1);
  });
});
