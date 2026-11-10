import { describe, expect, it } from 'vitest';
import { AUDIT_IF_CHANGED_SQL } from '../../workers/web/src/audit.ts';
import { RECOVERY_LAPSE_MS, RECOVERY_WAIT_MS, tokenHash } from '../../workers/web/src/app/email-code.ts';
import { handleRecoveryCancel, handleRecoveryPending, type RecoveryEnv, type SessionOf } from '../../workers/web/src/app/recovery.ts';
import type { AppSession } from '../../workers/web/src/app/session.ts';

/**
 * `GET /api/app/recovery` and `POST /api/app/recovery/cancel` (plan 6 Task 4,
 * shyden-labs/ShyTalk#133). D1, the session and the clock are stood in; the
 * SQL on a real D1 is tests/integration/recovery.test.ts.
 */

const ORIGIN = 'https://site.example.test';
const NOW = 1_800_000_000_000;

interface Recorded {
  sql: string;
  values: unknown[];
}

const SESSION: AppSession = { sessionId: 's-1', userId: 'u-1', email: 'member@example.test', createdAt: NOW - 1 };

function setting(
  pending: { id: number; started_at: number; completes_at: number } | null,
  byToken: { id: number; user_id: string } | null = null,
) {
  const batches: Recorded[][] = [];
  const DB = {
    prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) }),
    batch: (statements: unknown[]) => {
      batches.push(statements as Recorded[]);
      return Promise.resolve(
        (statements as Recorded[]).map(({ sql }) => {
          if (sql.startsWith('SELECT id, started_at')) return { meta: { changes: 0 }, results: pending ? [pending] : [] };
          if (sql.startsWith('SELECT id, user_id')) return { meta: { changes: 0 }, results: byToken ? [byToken] : [] };
          return { meta: { changes: 1 }, results: [] };
        }),
      );
    },
  };
  const env = { ENVIRONMENT_NAME: 'dev', DB } as unknown as RecoveryEnv;
  return { env, batches, all: () => batches.flat() };
}

const signedIn: SessionOf = () => Promise.resolve(SESSION);
const signedOut: SessionOf = () => Promise.resolve(null);

const request = (method: string, body?: unknown, type = 'application/json'): Request =>
  new Request(`${ORIGIN}/api/app/recovery${method === 'POST' ? '/cancel' : ''}`, {
    method,
    headers: { 'content-type': type },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });

const answerOf = async (response: Response) => ({ status: response.status, body: await response.json() });

const PENDING = { id: 3, started_at: NOW - 3_600_000, completes_at: NOW - 3_600_000 + RECOVERY_WAIT_MS };

describe('GET /api/app/recovery', () => {
  it('answers 401 signed_out without a session', async () => {
    const { env } = setting(PENDING);
    expect(await answerOf(await handleRecoveryPending(request('GET'), env, signedOut, () => NOW))).toEqual({
      status: 401,
      body: { error: 'signed_out' },
    });
  });

  it('answers 405 to anything but GET', async () => {
    const { env } = setting(PENDING);
    expect((await handleRecoveryPending(request('PUT', {}), env, signedIn, () => NOW)).status).toBe(405);
  });

  it("answers the member's pending recovery", async () => {
    const { env, all } = setting(PENDING);
    expect(await answerOf(await handleRecoveryPending(request('GET'), env, signedIn, () => NOW))).toEqual({
      status: 200,
      body: {
        pending: { startedAt: new Date(PENDING.started_at).toISOString(), completesAt: new Date(PENDING.completes_at).toISOString() },
      },
    });
    expect(all()[0]?.values).toEqual(['u-1']);
  });

  it('answers null when nothing is pending', async () => {
    const { env } = setting(null);
    expect(await answerOf(await handleRecoveryPending(request('GET'), env, signedIn, () => NOW))).toEqual({
      status: 200,
      body: { pending: null },
    });
  });

  it('still shows a recovery exactly 24 hours past completing', async () => {
    const { env } = setting({ ...PENDING, completes_at: NOW - RECOVERY_LAPSE_MS });
    const { body } = await answerOf(await handleRecoveryPending(request('GET'), env, signedIn, () => NOW));
    expect(body).not.toEqual({ pending: null });
  });

  it('reads a recovery more than 24 hours past completing as not pending', async () => {
    const { env } = setting({ ...PENDING, completes_at: NOW - RECOVERY_LAPSE_MS - 1 });
    expect(await answerOf(await handleRecoveryPending(request('GET'), env, signedIn, () => NOW))).toEqual({
      status: 200,
      body: { pending: null },
    });
  });
});

describe('POST /api/app/recovery/cancel', () => {
  it("cancels the session's member's recovery, spends its tokens and audits it, in one batch", async () => {
    const { env, batches } = setting(PENDING);
    expect(await answerOf(await handleRecoveryCancel(request('POST', {}), env, signedIn, () => NOW))).toEqual({
      status: 200,
      body: { ok: true },
    });
    const written = batches.at(-1) ?? [];
    expect(written.find(({ sql }) => sql.startsWith("UPDATE account_recovery SET state = 'cancelled'"))?.values).toEqual([NOW, 3]);
    expect(written.find(({ sql }) => sql.startsWith('UPDATE one_time_token SET used_at'))?.values).toEqual([NOW, 'u-1']);
    expect(written.find(({ sql }) => sql.startsWith('DELETE FROM totp_pending'))?.values).toEqual(['u-1']);
    const audited = written.find(({ sql }) => sql.startsWith('INSERT INTO audit'));
    expect(audited?.values.slice(1, 5)).toEqual(['user:u-1', 'recovery.cancel', 'user:u-1', JSON.stringify({ by: 'session' })]);
  });

  it('audits only a cancel that changed the row, so two at one moment write one audit row', async () => {
    const { env, batches } = setting(PENDING);
    await handleRecoveryCancel(request('POST', {}), env, signedIn, () => NOW);
    const order = (batches.at(-1) ?? []).map(({ sql }) => sql);
    expect(order.slice(-2)).toEqual([
      "UPDATE account_recovery SET state = 'cancelled', ended_at = ? WHERE id = ? AND state = 'pending'",
      AUDIT_IF_CHANGED_SQL,
    ]);
  });

  it("cancels the link's recovery even in a browser signed in as someone else", async () => {
    const { env, batches } = setting(null, { id: 3, user_id: 'u-owner' });
    expect((await handleRecoveryCancel(request('POST', { cancelToken: 'cancel-me' }), env, signedIn, () => NOW)).status).toBe(200);
    const written = batches.at(-1) ?? [];
    expect(written.find(({ sql }) => sql.startsWith("UPDATE account_recovery SET state = 'cancelled'"))?.values).toEqual([NOW, 3]);
    expect(written.find(({ sql }) => sql.startsWith('INSERT INTO audit'))?.values.slice(1, 5)).toEqual([
      'public',
      'recovery.cancel',
      'user:u-owner',
      JSON.stringify({ by: 'email-link' }),
    ]);
  });

  it('cancels by the email link token, matching its hash, without a session', async () => {
    const { env, batches, all } = setting(PENDING, { id: 3, user_id: 'u-1' });
    expect(await answerOf(await handleRecoveryCancel(request('POST', { cancelToken: 'cancel-me' }), env, signedOut, () => NOW))).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(all().find(({ sql }) => sql.startsWith('SELECT id, user_id'))?.values).toEqual([await tokenHash('cancel-me')]);
    const audited = (batches.at(-1) ?? []).find(({ sql }) => sql.startsWith('INSERT INTO audit'));
    expect(audited?.values.slice(1, 5)).toEqual(['public', 'recovery.cancel', 'user:u-1', JSON.stringify({ by: 'email-link' })]);
  });

  it.each([
    ['nothing pending, by session', null, null, {}, signedIn],
    ['an unknown token', PENDING, null, { cancelToken: 'unknown' }, signedOut],
    ['no token and no session', PENDING, null, {}, signedOut],
    ['an empty token', PENDING, { id: 3, user_id: 'u-1' }, { cancelToken: '' }, signedOut],
  ] as const)('answers 200 and writes nothing for %s', async (_name, pending, byToken, body, session) => {
    const { env, all } = setting(pending, byToken);
    expect(await answerOf(await handleRecoveryCancel(request('POST', body), env, session, () => NOW))).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(all().filter(({ sql }) => !sql.startsWith('SELECT'))).toEqual([]);
  });

  it('answers 400 to a body that is not a JSON object', async () => {
    const { env } = setting(PENDING);
    expect((await handleRecoveryCancel(request('POST', 'nope'), env, signedOut, () => NOW)).status).toBe(400);
    expect((await handleRecoveryCancel(request('POST', '{}', 'text/plain'), env, signedOut, () => NOW)).status).toBe(400);
  });

  it('answers 405 to anything but POST', async () => {
    const { env } = setting(PENDING);
    expect((await handleRecoveryCancel(request('GET'), env, signedIn, () => NOW)).status).toBe(405);
  });
});
