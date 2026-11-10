import { describe, expect, it } from 'vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuth } from '../../workers/web/src/auth/better-auth.ts';
import { handleCodeSignIn, sessionCookie, type CodeVerifier } from '../../workers/web/src/app/code-sign-in.ts';
import { appSession } from '../../workers/web/src/app/session.ts';
import type { SignInEnv } from '../../workers/web/src/app/sign-in.ts';

/**
 * Signing in with the authenticator app or a recovery code (plan 7 Task 4,
 * shyden-labs/ShyTalk#134 AC2, AC3, AC7): `POST /api/app/sign-in/totp` and
 * `/sign-in/recovery-code {email, code}`. Better Auth runs on its memory
 * adapter; the code check is stood in (it is tests/unit/totp.test.ts and
 * recovery-codes.test.ts); audit rows are recorded.
 */

interface Bound {
  sql: string;
  values: unknown[];
}

function world(options: { auditFails?: boolean; limited?: boolean } = {}) {
  const audits: Bound[] = [];
  const store: Record<string, Record<string, unknown>[]> = {
    user: [{ id: 'u-1', name: 'Member', email: 'm@example.test', emailVerified: true, createdAt: new Date(), updatedAt: new Date() }],
    session: [],
    account: [],
    verification: [],
  };
  const env = {
    ENVIRONMENT_NAME: 'dev',
    SITE_ORIGIN: 'https://site.example.test',
    BETTER_AUTH_SECRET: 'a-test-secret-that-is-long-enough-for-better-auth',
    GOOGLE_CLIENT_IDS: 'g',
    APPLE_AUDIENCES: 'a',
    DB: {
      prepare: (sql: string) => ({ bind: (...values: unknown[]): Bound => ({ sql, values }) }),
      batch: (statements: Bound[]) => {
        if (options.auditFails === true) return Promise.reject(new Error('D1 is down'));
        audits.push(...statements);
        return Promise.resolve([]);
      },
    },
    SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: options.limited !== true }) },
  } as unknown as SignInEnv;
  const auth = createAuth(env, {
    database: memoryAdapter(store),
    googleKeys: () => Promise.reject(new Error('unused')),
    appleKeys: () => Promise.reject(new Error('unused')),
  });
  return { env, auth, store, audits };
}

const post = (path: string, body: unknown): Request =>
  new Request(`https://site.example.test/api/app/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const accepts =
  (answer: { userId: string; left?: number } | null): CodeVerifier =>
  () =>
    Promise.resolve(answer);

describe('POST /api/app/sign-in/totp and /sign-in/recovery-code', () => {
  it('starts a session the bearer token reaches, and audits it with the method, never the code', async () => {
    const w = world();
    const response = await handleCodeSignIn(
      post('sign-in/totp', { email: 'm@example.test', code: '123456' }),
      w.env,
      w.auth,
      'totp',
      accepts({ userId: 'u-1' }),
    );
    expect(response.status).toBe(200);
    const { token, userId } = (await response.json()) as { token: string; userId: string };
    expect(userId).toBe('u-1');
    const signedIn = new Request('https://site.example.test/api/app/anything', { headers: { authorization: `Bearer ${token}` } });
    expect((await appSession(signedIn, w.auth))?.userId).toBe('u-1');
    const started = w.audits.find(({ values }) => values[2] === 'session.start');
    expect(started?.values.slice(1, 5)).toEqual(['user:u-1', 'session.start', 'user:u-1', JSON.stringify({ method: 'totp' })]);
    expect(JSON.stringify(w.audits)).not.toContain('123456');
  });

  it('answers a recovery-code sign-in with the codes left, and audits the code used', async () => {
    const w = world();
    const response = await handleCodeSignIn(
      post('sign-in/recovery-code', { email: 'm@example.test', code: 'ABCD-EFGH-JKMN-PQRS' }),
      w.env,
      w.auth,
      'recovery-code',
      accepts({ userId: 'u-1', left: 4 }),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { left: number }).left).toBe(4);
    const used = w.audits.find(({ values }) => values[2] === 'recovery_code.use');
    expect(used?.values[4]).toBe(JSON.stringify({ left: 4 }));
    expect(JSON.stringify(w.audits)).not.toContain('ABCD');
  });

  it('answers 401 sign_in_refused when the code is refused, making no session', async () => {
    const w = world();
    const response = await handleCodeSignIn(
      post('sign-in/totp', { email: 'm@example.test', code: '000000' }),
      w.env,
      w.auth,
      'totp',
      accepts(null),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'sign_in_refused' });
    expect(w.store['session']).toHaveLength(0);
  });

  it('deletes the session and answers 500 when its audit row cannot be written', async () => {
    const w = world({ auditFails: true });
    const response = await handleCodeSignIn(
      post('sign-in/totp', { email: 'm@example.test', code: '123456' }),
      w.env,
      w.auth,
      'totp',
      accepts({ userId: 'u-1' }),
    );
    expect(response.status).toBe(500);
    expect(w.store['session']).toHaveLength(0);
  });

  it('answers 429 over the IP limit, before checking the code', async () => {
    const w = world({ limited: true });
    let asked = false;
    const response = await handleCodeSignIn(
      post('sign-in/totp', { email: 'm@example.test', code: '123456' }),
      w.env,
      w.auth,
      'totp',
      () => {
        asked = true;
        return Promise.resolve(null);
      },
    );
    expect(response.status).toBe(429);
    expect(asked).toBe(false);
  });

  it.each([
    ['not JSON', 'nope'],
    ['no email', { code: '123456' }],
    ['a bad email', { email: 'nobody', code: '123456' }],
    ['no code', { email: 'm@example.test' }],
    ['a number for a code', { email: 'm@example.test', code: 123456 }],
  ])('answers 400 to %s', async (_name, body) => {
    const w = world();
    expect((await handleCodeSignIn(post('sign-in/totp', body), w.env, w.auth, 'totp', accepts({ userId: 'u-1' }))).status).toBe(400);
  });

  it('answers 405 to anything but POST', async () => {
    const w = world();
    const request = new Request('https://site.example.test/api/app/sign-in/totp', { method: 'GET' });
    expect((await handleCodeSignIn(request, w.env, w.auth, 'totp', accepts({ userId: 'u-1' }))).status).toBe(405);
  });
});

describe('sessionCookie (the website keeps a cookie session, shyden-labs/ShyTalk#134)', () => {
  it("is Better Auth's own signed session cookie, which its getSession accepts", async () => {
    const w = world();
    const session = await (await w.auth.$context).internalAdapter.createSession('u-1');
    const cookie = await sessionCookie(w.auth, session.token);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const found = await w.auth.api.getSession({ headers: new Headers({ cookie: cookie.split(';')[0] ?? '' }) });
    expect(found?.user.id).toBe('u-1');
  });

  it('is refused by getSession when its value is not the signed token', async () => {
    const w = world();
    const session = await (await w.auth.$context).internalAdapter.createSession('u-1');
    const [pair = ''] = (await sessionCookie(w.auth, session.token)).split(';');
    const [name = ''] = pair.split('=');
    expect(await w.auth.api.getSession({ headers: new Headers({ cookie: `${name}=${session.token}.forged` }) })).toBeNull();
  });

  it('comes with a code sign-in, beside the token the app keeps', async () => {
    const w = world();
    const response = await handleCodeSignIn(
      post('sign-in/totp', { email: 'm@example.test', code: '123456' }),
      w.env,
      w.auth,
      'totp',
      accepts({ userId: 'u-1' }),
    );
    expect(response.headers.getSetCookie().some((cookie) => cookie.includes('session_token='))).toBe(true);
  });
});
