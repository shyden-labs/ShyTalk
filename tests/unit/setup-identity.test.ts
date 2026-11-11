import { describe, expect, it } from 'vitest';
import { tokenHash } from '../../workers/web/src/app/email-code.ts';
import { setupIdentity, setupIdentityByHash, type SetupEnv } from '../../workers/web/src/app/setup-identity.ts';
import type { AppSession } from '../../workers/web/src/app/session.ts';

/**
 * Who is setting up a sign-in method (plan 7 Task 2, shyden-labs/ShyTalk#134):
 * a signed-in member, a sign-up with #133's token (no user yet), or a recovery
 * whose 24 hours have passed. D1 and the id maker are stood in.
 */

const NOW = 1_800_000_000_000;
const SESSION: AppSession = { sessionId: 's-1', userId: 'u-session', email: 'm@example.test', createdAt: NOW - 1 };

interface Recorded {
  sql: string;
  values: unknown[];
}

interface Rows {
  token?: { purpose: string; user_id: string | null; email: string | null; expires_at: number; used_at: number | null } | null;
  /** The user id the read-back after the claim finds (another setup may have claimed first). */
  claimed?: string;
  userWithEmail?: boolean;
  recovery?: { id: number; completes_at: number } | null;
}

function setting(rows: Rows) {
  const batches: Recorded[][] = [];
  const DB = {
    prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) }),
    batch: (statements: unknown[]) => {
      batches.push(statements as Recorded[]);
      return Promise.resolve(
        (statements as Recorded[]).map(({ sql }) => {
          if (sql.startsWith('SELECT purpose')) return { meta: { changes: 0 }, results: rows.token ? [rows.token] : [] };
          if (sql.startsWith('SELECT user_id FROM one_time_token'))
            return { meta: { changes: 0 }, results: [{ user_id: rows.claimed ?? 'u-new' }] };
          if (sql.startsWith('SELECT id FROM "user"'))
            return { meta: { changes: 0 }, results: rows.userWithEmail ? [{ id: 'u-other' }] : [] };
          if (sql.startsWith('SELECT id, completes_at')) return { meta: { changes: 0 }, results: rows.recovery ? [rows.recovery] : [] };
          return { meta: { changes: 1 }, results: [] };
        }),
      );
    },
  };
  const env = { ENVIRONMENT_NAME: 'dev', DB } as unknown as SetupEnv;
  return { env, all: () => batches.flat() };
}

const deps = { now: () => NOW, newId: () => 'u-new' };
const LIVE_SIGN_UP = { purpose: 'sign-up', user_id: null, email: 'new@example.test', expires_at: NOW + 60_000, used_at: null };

async function refusal(answer: unknown): Promise<{ status: number; body: unknown }> {
  if (!(answer instanceof Response)) throw new Error(`expected a refusal, got ${JSON.stringify(answer)}`);
  return { status: answer.status, body: await answer.json() };
}

describe('setupIdentity', () => {
  it('takes a signed-in member, ignoring any token', async () => {
    const { env, all } = setting({ token: LIVE_SIGN_UP });
    expect(await setupIdentity(env, SESSION, 'some-token', deps)).toEqual({ kind: 'session', userId: 'u-session' });
    expect(all()).toEqual([]);
  });

  it('refuses no session and no token with 401', async () => {
    const { env } = setting({});
    expect(await refusal(await setupIdentity(env, null, null, deps))).toEqual({ status: 401, body: { error: 'sign_in_refused' } });
  });

  it.each([
    ['unknown', null],
    ['expired', { ...LIVE_SIGN_UP, expires_at: NOW - 1 }],
    ['used', { ...LIVE_SIGN_UP, used_at: NOW - 5 }],
  ])('refuses an %s token with 401', async (_name, token) => {
    const { env } = setting({ token });
    expect(await refusal(await setupIdentity(env, null, 'tok', deps))).toEqual({ status: 401, body: { error: 'sign_in_refused' } });
  });

  it('looks the token up by its hash', async () => {
    const { env, all } = setting({ token: LIVE_SIGN_UP });
    await setupIdentity(env, null, 'tok', deps);
    expect(all().find(({ sql }) => sql.startsWith('SELECT purpose'))?.values).toEqual([await tokenHash('tok')]);
  });

  it('gives a sign-up token one member id: claimed only while unset, then read back', async () => {
    const { env, all } = setting({ token: LIVE_SIGN_UP, claimed: 'u-first' });
    expect(await setupIdentity(env, null, 'tok', deps)).toEqual({
      kind: 'sign-up',
      userId: 'u-first',
      email: 'new@example.test',
      tokenHash: await tokenHash('tok'),
    });
    const claim = all().find(({ sql }) => sql.startsWith('UPDATE one_time_token SET user_id'));
    expect(claim?.sql).toContain('user_id IS NULL');
    expect(claim?.values).toEqual(['u-new', await tokenHash('tok')]);
  });

  it('keeps the member id of a sign-up token once set', async () => {
    const { env, all } = setting({ token: { ...LIVE_SIGN_UP, user_id: 'u-set' } });
    expect(await setupIdentity(env, null, 'tok', deps)).toMatchObject({ kind: 'sign-up', userId: 'u-set' });
    expect(all().some(({ sql }) => sql.startsWith('UPDATE'))).toBe(false);
  });

  it('answers 409 account_exists when the address got an account meanwhile', async () => {
    const { env } = setting({ token: LIVE_SIGN_UP, userWithEmail: true });
    expect(await refusal(await setupIdentity(env, null, 'tok', deps))).toEqual({ status: 409, body: { error: 'account_exists' } });
  });

  it('answers 403 recovery_waiting with the time while the 24 hours run', async () => {
    const completesAt = NOW + 3_600_000;
    const { env, all } = setting({
      token: { purpose: 'recovery', user_id: 'u-1', email: null, expires_at: completesAt + 86_400_000, used_at: null },
      recovery: { id: 3, completes_at: completesAt },
    });
    expect(await refusal(await setupIdentity(env, null, 'tok', deps))).toEqual({
      status: 403,
      body: { error: 'recovery_waiting', completesAt: new Date(completesAt).toISOString() },
    });
    expect(all().some(({ sql }) => !sql.startsWith('SELECT'))).toBe(false);
  });

  it('takes a recovery once its time has come', async () => {
    const { env } = setting({
      token: { purpose: 'recovery', user_id: 'u-1', email: null, expires_at: NOW + 86_400_000, used_at: null },
      recovery: { id: 3, completes_at: NOW },
    });
    expect(await setupIdentity(env, null, 'tok', deps)).toEqual({
      kind: 'recovery',
      userId: 'u-1',
      recoveryId: 3,
      tokenHash: await tokenHash('tok'),
    });
  });

  it('refuses a recovery token whose recovery was cancelled with 401', async () => {
    const { env } = setting({
      token: { purpose: 'recovery', user_id: 'u-1', email: null, expires_at: NOW + 86_400_000, used_at: null },
      recovery: null,
    });
    expect(await refusal(await setupIdentity(env, null, 'tok', deps))).toEqual({ status: 401, body: { error: 'sign_in_refused' } });
  });
});

describe('setupIdentityByHash (the passkey plugin keeps the hash, never the token)', () => {
  it('answers as setupIdentity does for the token whose hash it is given', async () => {
    const { env, all } = setting({ token: { ...LIVE_SIGN_UP, user_id: 'u-set' } });
    const hash = await tokenHash('tok');
    expect(await setupIdentityByHash(env, hash, deps)).toEqual({
      kind: 'sign-up',
      userId: 'u-set',
      email: 'new@example.test',
      tokenHash: hash,
    });
    expect(all().find(({ sql }) => sql.startsWith('SELECT purpose'))?.values).toEqual([hash]);
  });
});
