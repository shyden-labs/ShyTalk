import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth, type ShyTalkAuth } from '../../workers/web/src/auth/better-auth.ts';
import { END_SESSION_SQL, handleSignIn, handleSignOut, type SignInEnv } from '../../workers/web/src/app/sign-in.ts';
import { APPLE_ID, GOOGLE_IDS, issuer, type Issuer } from '../support/id-tokens.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * App sign-in on a real D1 (plan 4 Task 3, shyden-labs/ShyTalk#76): Better
 * Auth's tables from migrations/0003_auth.sql, the audit table from 0002, and
 * provider keys stood in by a local JWKS.
 */

let local: LocalDevEnv;
let dispose: () => Promise<void>;
let provider: Issuer;
let auth: ShyTalkAuth;
let env: SignInEnv;

const settings = {
  ENVIRONMENT_NAME: 'dev',
  SITE_ORIGIN: 'https://site.example.test',
  BETTER_AUTH_SECRET: 'an-integration-secret-long-enough-for-better-auth',
  GOOGLE_CLIENT_IDS: GOOGLE_IDS.join(','),
  APPLE_AUDIENCES: APPLE_ID,
} as const;

beforeAll(async () => {
  ({ env: local, dispose } = await localDev());
  provider = await issuer();
  auth = createAuth(settings, { database: local.DB, googleKeys: provider.keys, appleKeys: provider.keys });
  env = { ...settings, DB: local.DB, SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: true }) } };
});

afterAll(async () => {
  await dispose();
});

const count = async (sql: string, ...values: unknown[]): Promise<number> =>
  (
    await local.DB.prepare(`SELECT COUNT(*) AS n FROM ${sql}`)
      .bind(...values)
      .first<{ n: number }>()
  )?.n ?? -1;

const post = (path: string, body: unknown, token?: string): Request =>
  new Request(`https://site.example.test/api/app/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });

describe('app sign-in on D1', () => {
  it('a Google sign-in makes one user, one session and one audit row; again reuses the user', async () => {
    const email = 'google-person@example.test';
    const first = await handleSignIn(
      post('sign-in/google', { idToken: await provider.idToken({ email, sub: 'g-1' }) }),
      env,
      auth,
      'google',
    );
    expect(first.status).toBe(200);
    const { token, userId } = (await first.json()) as { token: string; userId: string };
    expect(await count('user WHERE email = ?', email)).toBe(1);
    expect(await count('session WHERE token = ? AND userId = ?', token, userId)).toBe(1);
    expect(await count("audit WHERE action = 'session.start' AND actor = ?", `user:${userId}`)).toBe(1);

    const again = (await (
      await handleSignIn(post('sign-in/google', { idToken: await provider.idToken({ email, sub: 'g-1' }) }), env, auth, 'google')
    ).json()) as {
      userId: string;
    };
    expect(again.userId).toBe(userId);
    expect(await count('user WHERE email = ?', email)).toBe(1);
  });

  it('an Apple sign-in with a wrong nonce is refused and writes nothing', async () => {
    const email = 'apple-wrong@example.test';
    const response = await handleSignIn(
      post('sign-in/apple', { idToken: await provider.appleToken('n-1', { email }), nonce: 'n-2' }),
      env,
      auth,
      'apple',
    );
    expect(response.status).toBe(401);
    expect(await count('user WHERE email = ?', email)).toBe(0);
  });

  it('a verified email-code account is linked; an unverified one is not', async () => {
    const now = Date.now();
    await local.DB.batch([
      local.DB.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').bind(
        'verified-1',
        'V',
        'verified@example.test',
        1,
        now,
        now,
      ),
      local.DB.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').bind(
        'unverified-1',
        'U',
        'unverified@example.test',
        0,
        now,
        now,
      ),
    ]);
    const linked = await handleSignIn(
      post('sign-in/google', { idToken: await provider.idToken({ email: 'verified@example.test', sub: 'g-v' }) }),
      env,
      auth,
      'google',
    );
    expect(((await linked.json()) as { userId: string }).userId).toBe('verified-1');
    const refused = await handleSignIn(
      post('sign-in/google', { idToken: await provider.idToken({ email: 'unverified@example.test', sub: 'g-u' }) }),
      env,
      auth,
      'google',
    );
    expect(refused.status).toBe(401);
    expect(await count("account WHERE userId = 'unverified-1'")).toBe(0);
  });

  it('a failing audit write leaves no session behind', async () => {
    const email = 'audit-fails@example.test';
    const failing: SignInEnv = {
      ...env,
      DB: { prepare: (sql) => local.DB.prepare(sql), batch: () => Promise.reject(new Error('audit write failed')) },
    };
    const response = await handleSignIn(
      post('sign-in/google', { idToken: await provider.idToken({ email, sub: 'g-f' }) }),
      failing,
      auth,
      'google',
    );
    expect(response.status).toBe(500);
    expect(await count('session WHERE userId IN (SELECT id FROM user WHERE email = ?)', email)).toBe(0);
  });

  it('sign-out deletes the session row and writes its attempt and success on one chain; the old token then gets 401', async () => {
    const signedIn = await handleSignIn(
      post('sign-in/google', { idToken: await provider.idToken({ email: 'leaver@example.test', sub: 'g-l' }) }),
      env,
      auth,
      'google',
    );
    const { token, userId } = (await signedIn.json()) as { token: string; userId: string };
    expect((await handleSignOut(post('sign-out', {}, token), env, auth)).status).toBe(200);
    expect(await count('session WHERE token = ?', token)).toBe(0);
    expect(await count("audit WHERE action = 'session.end.attempt' AND actor = ?", `user:${userId}`)).toBe(1);
    const chains = await local.DB.prepare(
      "SELECT action, json_extract(detail, '$.chain') AS chain FROM audit WHERE actor = ? AND action LIKE 'session.end.%' ORDER BY id",
    )
      .bind(`user:${userId}`)
      .all<{ action: string; chain: string }>();
    expect(chains.results.map((row) => row.action)).toEqual(['session.end.attempt', 'session.end.success']);
    expect(new Set(chains.results.map((row) => row.chain)).size).toBe(1);
    expect((await handleSignOut(post('sign-out', {}, token), env, auth)).status).toBe(401);
  });

  it('a sign-out whose end batch fails on D1 keeps the session row and logs the failure on the chain', async () => {
    const signedIn = await handleSignIn(
      post('sign-in/google', { idToken: await provider.idToken({ email: 'stayer@example.test', sub: 'g-s' }) }),
      env,
      auth,
      'google',
    );
    const { token, userId } = (await signedIn.json()) as { token: string; userId: string };
    // The end batch gets one more statement that D1 refuses (audit.actor is NOT NULL),
    // so D1 itself must roll back the session DELETE beside it.
    const refusing: SignInEnv = {
      ...env,
      DB: {
        prepare: (sql) => local.DB.prepare(sql),
        batch: (statements) => {
          const ends = statements.length === 2;
          const all = statements as Parameters<typeof local.DB.batch>[0];
          return local.DB.batch(ends ? [...all, local.DB.prepare('INSERT INTO audit (at) VALUES (1)')] : all);
        },
      },
    };
    const response = await handleSignOut(post('sign-out', {}, token), refusing, auth);
    expect(response.status).toBe(500);
    expect(await count('session WHERE token = ?', token)).toBe(1);
    const chain = await local.DB.prepare(
      "SELECT action, json_extract(detail, '$.chain') AS chain FROM audit WHERE actor = ? AND action LIKE 'session.end.%' ORDER BY id",
    )
      .bind(`user:${userId}`)
      .all<{ action: string; chain: string }>();
    expect(chain.results.map((row) => row.action)).toEqual(['session.end.attempt', 'session.end.failure']);
    expect(new Set(chain.results.map((row) => row.chain)).size).toBe(1);
    expect(END_SESSION_SQL).toContain('DELETE FROM session');
  });
});
