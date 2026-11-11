import { describe, expect, it } from 'vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuth } from '../../workers/web/src/auth/better-auth.ts';
import { auditPasskeySignIn, undoSignUp } from '../../workers/web/src/app/passkey.ts';
import type { SignInEnv } from '../../workers/web/src/app/sign-in.ts';

/**
 * The audit rows around a passkey sign-in, and undoing a sign-up whose passkey
 * was not written (plan 7 Task 5, shyden-labs/ShyTalk#134 AC7). D1 is
 * recorded; sessions run on the memory adapter.
 */

interface Bound {
  sql: string;
  values: unknown[];
}

function world(auditFails = false) {
  const batches: Bound[][] = [];
  const store: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification: [], passkey: [] };
  const env = {
    ENVIRONMENT_NAME: 'dev',
    SITE_ORIGIN: 'https://site.example.test',
    BETTER_AUTH_SECRET: 'a-test-secret-that-is-long-enough-for-better-auth',
    GOOGLE_CLIENT_IDS: 'g',
    APPLE_AUDIENCES: 'a',
    DB: {
      prepare: (sql: string) => ({ bind: (...values: unknown[]): Bound => ({ sql, values }) }),
      batch: (statements: Bound[]) => {
        if (auditFails) return Promise.reject(new Error('D1 is down'));
        batches.push(statements);
        return Promise.resolve([]);
      },
    },
    SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: true }) },
  } as unknown as SignInEnv;
  const auth = createAuth(env, {
    database: memoryAdapter(store),
    googleKeys: () => Promise.reject(new Error('unused')),
    appleKeys: () => Promise.reject(new Error('unused')),
  });
  return { env, auth, store, batches };
}

describe('auditPasskeySignIn', () => {
  it('writes method.use and session.start in one batch, and answers null', async () => {
    const w = world();
    const session = await (await w.auth.$context).internalAdapter.createSession('u-1');
    expect(await auditPasskeySignIn(w.env, w.auth, 'u-1', session.token)).toBeNull();
    expect(w.batches).toHaveLength(1);
    expect(w.batches[0]?.map(({ values }) => [values[2], values[4]])).toEqual([
      ['method.use', JSON.stringify({ kind: 'passkey' })],
      ['session.start', JSON.stringify({ method: 'passkey' })],
    ]);
  });

  it('deletes the session and answers 500 when the rows cannot be written', async () => {
    const w = world(true);
    const session = await (await w.auth.$context).internalAdapter.createSession('u-1');
    const answer = await auditPasskeySignIn(w.env, w.auth, 'u-1', session.token);
    expect(answer?.status).toBe(500);
    expect(w.store['session']).toHaveLength(0);
  });
});

describe('undoSignUp', () => {
  it('deletes the member and audits why, in one batch', async () => {
    const w = world();
    await undoSignUp(w.env, 'u-new');
    expect(w.batches).toHaveLength(1);
    expect(w.batches[0]?.[0]).toEqual({ sql: 'DELETE FROM "user" WHERE id = ?', values: ['u-new'] });
    expect(w.batches[0]?.[1]?.values.slice(1, 5)).toEqual([
      'user:u-new',
      'user.create.undone',
      'user:u-new',
      JSON.stringify({ reason: 'passkey not written' }),
    ]);
  });
});
