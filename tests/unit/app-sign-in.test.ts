import { beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuth, getAuth, type AuthDatabase, type AuthEnv, type ShyTalkAuth } from '../../workers/web/src/auth/better-auth.ts';
import { END_SESSION_SQL, handleSignIn, handleSignOut, type SignInEnv } from '../../workers/web/src/app/sign-in.ts';
import { appSession, signedOut } from '../../workers/web/src/app/session.ts';
import { verifyIdToken } from '../../workers/web/src/auth/id-token.ts';
import { APPLE_ID, APPLE_ISSUER, GOOGLE_IDS, GOOGLE_ISSUER, issuer, sha256Hex, type Claims, type Issuer } from '../support/id-tokens.ts';

/**
 * App sign-in (plan 4 Task 3, shyden-labs/ShyTalk#76): Google and Apple ID
 * tokens from the phone become a Better Auth session the app holds as a
 * bearer token. Better Auth runs on its memory adapter here; the provider
 * keys are a local JWKS standing in for Google's and Apple's.
 */

let provider: Issuer;
let jwks: Issuer['keys'];

beforeAll(async () => {
  provider = await issuer(inject('idTokenKeys'));
  jwks = provider.keys;
});

const idToken = (claims?: Claims): Promise<string> => provider.idToken(claims);
const appleToken = (rawNonce: string, claims?: Claims): Promise<string> => provider.appleToken(rawNonce, claims);

interface Bound {
  sql: string;
  values: unknown[];
}

interface World {
  env: SignInEnv;
  auth: ShyTalkAuth;
  store: Record<string, Record<string, unknown>[]>;
  audits: Bound[];
  limited: string[];
  setAuditFails(fails: boolean): void;
  /** Fails, whole, every batch holding an audit row for one of `actions`. */
  setAuditFailsOn(actions: string[]): void;
  setLimited(limited: boolean): void;
}

function world(): World {
  const audits: Bound[] = [];
  const limited: string[] = [];
  let auditFails = false;
  let failingActions: string[] = [];
  let overLimit = false;
  const store: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification: [] };
  const env: SignInEnv = {
    ENVIRONMENT_NAME: 'dev',
    SITE_ORIGIN: 'https://site.example.test',
    BETTER_AUTH_SECRET: 'a-test-secret-that-is-long-enough-for-better-auth',
    GOOGLE_CLIENT_IDS: GOOGLE_IDS.join(','),
    APPLE_AUDIENCES: APPLE_ID,
    DB: {
      prepare: (sql: string) => ({ bind: (...values: unknown[]): Bound => ({ sql, values }) }),
      // Like D1, a batch lands whole or not at all: audit rows are kept, and a
      // session DELETE is applied to the memory store, only when nothing fails.
      batch: (statements: Bound[]) => {
        if (auditFails) return Promise.reject(new Error('D1 is down'));
        if (statements.some((statement) => failingActions.includes(String(statement.values[2]))))
          return Promise.reject(new Error('D1 is down'));
        for (const statement of statements) {
          if (statement.sql === END_SESSION_SQL)
            store['session'] = (store['session'] ?? []).filter((row) => row['id'] !== statement.values[0]);
          else audits.push(statement);
        }
        return Promise.resolve([]);
      },
    },
    SIGN_IN_LIMIT: {
      limit: ({ key }: { key: string }) => {
        limited.push(key);
        return Promise.resolve({ success: !overLimit });
      },
    },
  };
  const authEnv: AuthEnv = env;
  const auth = createAuth(authEnv, { database: memoryAdapter(store), googleKeys: jwks, appleKeys: jwks });
  return {
    env,
    auth,
    store,
    audits,
    limited,
    setAuditFailsOn: (actions) => {
      failingActions = actions;
    },
    setAuditFails: (fails) => {
      auditFails = fails;
    },
    setLimited: (value) => {
      overLimit = value;
    },
  };
}

/** The store's rows of `model`: the memory adapter keeps one array per model. */
const rows = (w: World, model: string): Record<string, unknown>[] => w.store[model] ?? [];
/** Item `index` of `items`, failing the test when it is missing. */
function nth<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected an item at ${index} of ${items.length}`);
  return item;
}
const first = (items: Record<string, unknown>[] | undefined): Record<string, unknown> => nth(items ?? [], 0);

const post = (path: string, body: unknown, headers: Record<string, string> = {}): Request =>
  new Request(`https://site.example.test/api/app/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const google = async (w: World, token: string): Promise<Response> =>
  handleSignIn(post('sign-in/google', { idToken: token }), w.env, w.auth, 'google');
const apple = async (w: World, token: string, nonce?: string): Promise<Response> =>
  handleSignIn(post('sign-in/apple', { idToken: token, nonce }), w.env, w.auth, 'apple');

describe('verifyIdToken', () => {
  const check = (): Parameters<typeof verifyIdToken>[1] => ({ keys: jwks, issuer: [GOOGLE_ISSUER], audience: GOOGLE_IDS });

  it('accepts a token signed by the provider for one of our audiences', async () => {
    expect(await verifyIdToken(await idToken(), check())).toBe(true);
  });

  it.each(GOOGLE_IDS)('accepts each of our client IDs as the audience: %s', async (aud) => {
    expect(await verifyIdToken(await idToken({ aud }), check())).toBe(true);
  });

  it('refuses a foreign audience, issuer, signer or an expired token', async () => {
    expect(await verifyIdToken(await idToken({ aud: 'someone-else.apps.googleusercontent.com' }), check())).toBe(false);
    expect(await verifyIdToken(await idToken({ iss: 'https://evil.example.test' }), check())).toBe(false);
    expect(await verifyIdToken(await idToken({ foreign: true }), check())).toBe(false);
    expect(await verifyIdToken(await idToken({ expiresIn: -120 }), check())).toBe(false);
  });

  it('refuses everything when no audience is configured', async () => {
    expect(await verifyIdToken(await idToken(), { ...check(), audience: [] })).toBe(false);
  });

  it('refuses a token that is not a JWT', async () => {
    expect(await verifyIdToken('not-a-token', check())).toBe(false);
  });

  it('without a required nonce, a nonce the app sends must match the claim exactly', async () => {
    const token = await idToken({ nonce: 'exact-nonce' });
    expect(await verifyIdToken(token, check(), 'exact-nonce')).toBe(true);
    expect(await verifyIdToken(token, check(), await sha256Hex('exact-nonce'))).toBe(false);
    expect(await verifyIdToken(token, check(), 'other')).toBe(false);
  });

  it('with a required nonce, accepts only the SHA-256 of the raw nonce the app sent', async () => {
    const appleCheck = { keys: jwks, issuer: [APPLE_ISSUER], audience: [APPLE_ID], nonce: 'required' as const };
    const token = await appleToken('raw-nonce-1');
    expect(await verifyIdToken(token, appleCheck, 'raw-nonce-1')).toBe(true);
    expect(await verifyIdToken(token, appleCheck, 'another-nonce')).toBe(false);
    expect(await verifyIdToken(token, appleCheck)).toBe(false);
    const plain = await idToken({ iss: APPLE_ISSUER, aud: APPLE_ID, nonce: 'raw-nonce-1' });
    expect(await verifyIdToken(plain, appleCheck, 'raw-nonce-1')).toBe(false);
    const noNonce = await idToken({ iss: APPLE_ISSUER, aud: APPLE_ID });
    expect(await verifyIdToken(noNonce, appleCheck, 'raw-nonce-1')).toBe(false);
  });
});

describe('POST /api/app/sign-in/google', () => {
  let w: World;
  beforeEach(() => {
    w = world();
  });

  it('a good token creates one user and one session and answers {token, userId}', async () => {
    const response = await google(w, await idToken());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string; userId: string };
    expect(Object.keys(body).sort()).toEqual(['token', 'userId']);
    expect(w.store['user']).toHaveLength(1);
    expect(w.store['session']).toHaveLength(1);
    expect(first(w.store['user'])['id']).toBe(body.userId);
    expect(first(w.store['session'])['token']).toBe(body.token);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('the same person signing in again reuses the user', async () => {
    const first = (await (await google(w, await idToken())).json()) as { userId: string };
    const second = (await (await google(w, await idToken())).json()) as { userId: string };
    expect(second.userId).toBe(first.userId);
    expect(w.store['user']).toHaveLength(1);
    expect(w.store['session']).toHaveLength(2);
  });

  it.each([
    ['a foreign audience', { aud: 'someone-else.apps.googleusercontent.com' }],
    ['an expired token', { expiresIn: -120 }],
    ['a foreign signer', { foreign: true }],
    ['an Apple issuer', { iss: APPLE_ISSUER }],
  ] as const)('%s answers 401 and creates nothing', async (_name, claims) => {
    const response = await google(w, await idToken(claims));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'sign_in_refused' });
    expect(w.store['user']).toHaveLength(0);
    expect(w.store['session']).toHaveLength(0);
    expect(w.audits).toHaveLength(0);
  });

  it('writes one audit row naming the user and provider, never the token', async () => {
    const body = (await (await google(w, await idToken())).json()) as { token: string; userId: string };
    expect(w.audits).toHaveLength(1);
    const row = nth(w.audits, 0);
    expect(row.sql).toMatch(/^INSERT INTO audit /);
    expect(row.values.slice(1)).toEqual([`user:${body.userId}`, 'session.start', `user:${body.userId}`, '{"provider":"google"}', 'dev']);
    expect(JSON.stringify(row.values)).not.toContain(body.token);
  });

  it('a failing audit write leaves no session and answers 500', async () => {
    w.setAuditFails(true);
    const response = await google(w, await idToken());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'sign_in_failed' });
    expect(w.store['session']).toHaveLength(0);
  });

  it('links a Google sign-in to an email-code account holding the same verified email', async () => {
    const now = new Date();
    rows(w, 'user').push({
      id: 'email-user',
      email: 'ana@example.test',
      emailVerified: true,
      name: 'Ana',
      createdAt: now,
      updatedAt: now,
    });
    const body = (await (await google(w, await idToken())).json()) as { userId: string };
    expect(body.userId).toBe('email-user');
    expect(w.store['user']).toHaveLength(1);
    expect(rows(w, 'account').filter((row) => row['providerId'] === 'google')).toHaveLength(1);
  });

  it('does not link to an account whose email was never verified', async () => {
    const now = new Date();
    rows(w, 'user').push({
      id: 'email-user',
      email: 'ana@example.test',
      emailVerified: false,
      name: 'Ana',
      createdAt: now,
      updatedAt: now,
    });
    const response = await google(w, await idToken());
    expect(response.status).toBe(401);
    expect(w.store['account']).toHaveLength(0);
    expect(w.store['session']).toHaveLength(0);
  });

  it('does not link when Google says the email is not verified', async () => {
    const now = new Date();
    rows(w, 'user').push({
      id: 'email-user',
      email: 'ana@example.test',
      emailVerified: true,
      name: 'Ana',
      createdAt: now,
      updatedAt: now,
    });
    const response = await google(w, await idToken({ email_verified: false }));
    expect(response.status).toBe(401);
    expect(w.store['account']).toHaveLength(0);
  });

  it.each([
    ['not JSON', '{'],
    ['no idToken', {}],
    ['a non-string idToken', { idToken: 7 }],
    ['an empty idToken', { idToken: '' }],
    ['a JSON array', [1]],
    ['JSON null', 'null'],
  ] as const)('%s answers 400 bad_request', async (_name, body) => {
    const response = await handleSignIn(post('sign-in/google', body), w.env, w.auth, 'google');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad_request' });
  });

  it('answers 405 to anything but POST', async () => {
    const response = await handleSignIn(new Request('https://site.example.test/api/app/sign-in/google'), w.env, w.auth, 'google');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('is rate limited per IP: over the limit answers 429 slow_down before any check', async () => {
    w.setLimited(true);
    const response = await google(w, await idToken());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'slow_down' });
    expect(w.limited).toEqual(['203.0.113.7']);
    expect(w.store['session']).toHaveLength(0);
  });

  it('keys the limit on the connecting IP, and on "unknown" when there is none', async () => {
    await handleSignIn(
      post('sign-in/google', { idToken: await idToken() }, { 'cf-connecting-ip': '198.51.100.9' }),
      w.env,
      w.auth,
      'google',
    );
    const bare = new Request('https://site.example.test/api/app/sign-in/google', { method: 'POST', body: '{}' });
    await handleSignIn(bare, w.env, w.auth, 'google');
    expect(w.limited).toEqual(['198.51.100.9', 'unknown']);
  });

  it('answers 503 when no Google client IDs are configured, creating nothing', async () => {
    w.env.GOOGLE_CLIENT_IDS = ' , ';
    const response = await google(w, await idToken());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'sign_in_unavailable' });
    expect(w.store['session']).toHaveLength(0);
  });
});

describe('POST /api/app/sign-in/apple', () => {
  let w: World;
  beforeEach(() => {
    w = world();
  });

  it('a good token with the matching raw nonce signs in', async () => {
    const response = await apple(w, await appleToken('n-1'), 'n-1');
    expect(response.status).toBe(200);
    expect(w.store['session']).toHaveLength(1);
    expect(nth(w.audits, 0).values[4]).toBe('{"provider":"apple"}');
  });

  it('a nonce whose hash does not match answers 401', async () => {
    const response = await apple(w, await appleToken('n-1'), 'n-2');
    expect(response.status).toBe(401);
    expect(w.store['session']).toHaveLength(0);
  });

  it('a missing or non-string nonce answers 400', async () => {
    expect((await apple(w, await appleToken('n-1'))).status).toBe(400);
    const numeric = await handleSignIn(post('sign-in/apple', { idToken: await appleToken('n-1'), nonce: 5 }), w.env, w.auth, 'apple');
    expect(numeric.status).toBe(400);
  });

  it('a Google token sent to the Apple route answers 401', async () => {
    const response = await apple(w, await idToken({ nonce: await sha256Hex('n-1') }), 'n-1');
    expect(response.status).toBe(401);
  });

  it('answers 503 when no Apple audience is configured', async () => {
    w.env.APPLE_AUDIENCES = '';
    expect((await apple(w, await appleToken('n-1'), 'n-1')).status).toBe(503);
  });
});

describe('the app session and sign-out', () => {
  let w: World;
  beforeEach(() => {
    w = world();
  });

  const signedIn = async (): Promise<{ token: string; userId: string }> =>
    (await (await google(w, await idToken())).json()) as { token: string; userId: string };
  const bearer = (path: string, token: string, method = 'POST'): Request =>
    new Request(`https://site.example.test/api/app/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': '203.0.113.7' },
    });

  it('appSession returns the user for a live bearer token', async () => {
    const { token, userId } = await signedIn();
    const session = await appSession(bearer('anything', token, 'GET'), w.auth);
    if (session === null) throw new Error('expected a session');
    expect(session.userId).toBe(userId);
    expect(session.email).toBe('ana@example.test');
    expect(typeof session.createdAt).toBe('number');
  });

  it.each([
    ['no header', undefined],
    ['a wrong token', 'Bearer not-a-session'],
    ['another scheme', 'Basic abc'],
  ])('appSession returns null with %s', async (_name, header) => {
    const headers: Record<string, string> = header === undefined ? {} : { authorization: header };
    const request = new Request('https://site.example.test/api/app/anything', { headers });
    expect(await appSession(request, w.auth)).toBeNull();
  });

  it('signedOut answers 401 signed_out, never cached', async () => {
    const response = signedOut();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'signed_out' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  /** The sign-out rows: everything after the sign-in's `session.start`. */
  const signOutRows = (): Bound[] => w.audits.filter((row) => String(row.values[2]).startsWith('session.end'));
  const detail = (row: Bound): Record<string, unknown> => JSON.parse(String(row.values[4])) as Record<string, unknown>;

  it('sign-out logs an attempt, deletes the session, logs its success on the same chain, and the old token then gets 401', async () => {
    const { token, userId } = await signedIn();
    const response = await handleSignOut(bearer('sign-out', token), w.env, w.auth);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(w.store['session']).toHaveLength(0);
    const [attempt, outcome, ...more] = signOutRows();
    expect(more).toEqual([]);
    if (attempt === undefined || outcome === undefined) throw new Error('expected two sign-out rows');
    expect(attempt.values.slice(1, 4)).toEqual([`user:${userId}`, 'session.end.attempt', `user:${userId}`]);
    expect(outcome.values.slice(1, 4)).toEqual([`user:${userId}`, 'session.end.success', `user:${userId}`]);
    const chain = detail(attempt)['chain'];
    expect(chain).toMatch(/^[0-9a-f-]{36}$/);
    expect(detail(outcome)).toEqual({ chain });
    expect(JSON.stringify(signOutRows())).not.toContain(token);
    const again = await handleSignOut(bearer('sign-out', token), w.env, w.auth);
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ error: 'signed_out' });
  });

  it('each sign-out has its own chain', async () => {
    for (let i = 0; i < 2; i += 1) {
      const { token } = await signedIn();
      await handleSignOut(bearer('sign-out', token), w.env, w.auth);
    }
    const chains = new Set(signOutRows().map((row) => detail(row)['chain']));
    expect(chains.size).toBe(2);
  });

  it('sign-out without a session answers 401 and writes nothing', async () => {
    const response = await handleSignOut(bearer('sign-out', 'not-a-session'), w.env, w.auth);
    expect(response.status).toBe(401);
    expect(w.audits).toHaveLength(0);
  });

  it('when the attempt cannot be logged, sign-out answers 500 and keeps the session, so it can be tried again', async () => {
    const { token } = await signedIn();
    w.setAuditFails(true);
    const response = await handleSignOut(bearer('sign-out', token), w.env, w.auth);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'sign_out_failed' });
    expect(w.store['session']).toHaveLength(1);
    expect(signOutRows()).toEqual([]);
  });

  it('the session ends in the same all-or-nothing batch as its success row', async () => {
    const { token } = await signedIn();
    w.setAuditFailsOn(['session.end.success']);
    const response = await handleSignOut(bearer('sign-out', token), w.env, w.auth);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'sign_out_failed' });
    expect(w.store['session']).toHaveLength(1);
    const [attempt, outcome, ...more] = signOutRows();
    expect(more).toEqual([]);
    if (attempt === undefined || outcome === undefined) throw new Error('expected two sign-out rows');
    expect(outcome.values[2]).toBe('session.end.failure');
    expect(detail(outcome)).toEqual({ chain: detail(attempt)['chain'], error: 'Error: D1 is down' });
    expect((await handleSignOut(bearer('sign-out', token), w.env, w.auth)).status).toBe(500);
  });

  it('when the failure cannot be logged either, the session is kept and sign-out answers 500', async () => {
    const { token } = await signedIn();
    w.setAuditFailsOn(['session.end.success', 'session.end.failure']);
    const response = await handleSignOut(bearer('sign-out', token), w.env, w.auth);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'sign_out_failed' });
    expect(w.store['session']).toHaveLength(1);
    expect(signOutRows().map((row) => row.values[2])).toEqual(['session.end.attempt']);
  });

  it('the end step deletes exactly the signed-in session, by its id', async () => {
    const first = await signedIn();
    const second = await signedIn();
    await handleSignOut(bearer('sign-out', first.token), w.env, w.auth);
    expect(rows(w, 'session').map((row) => row['token'])).toEqual([second.token]);
    expect(END_SESSION_SQL).toBe('DELETE FROM session WHERE id = ?');
  });

  it('sign-out answers 405 to anything but POST', async () => {
    const { token } = await signedIn();
    const response = await handleSignOut(bearer('sign-out', token, 'GET'), w.env, w.auth);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});

describe('getAuth and Better Auth failures', () => {
  const d1 = (): AuthDatabase => ({
    prepare: () => ({ bind: () => d1().prepare(''), all: () => Promise.resolve({ results: [], meta: { changes: 0, last_row_id: 0 } }) }),
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({}),
  });

  it('makes one Better Auth per database binding and keeps it', () => {
    const settings = world().env;
    const db = d1();
    const first = getAuth({ ...settings, DB: db });
    expect(getAuth({ ...settings, DB: db })).toBe(first);
    expect(getAuth({ ...settings, DB: d1() })).not.toBe(first);
  });

  /** A Better Auth whose sign-in answers `answer`, or fails with it. */
  const stubbed = (signInSocial: () => Promise<unknown>): ShyTalkAuth => ({ api: { signInSocial } }) as unknown as ShyTalkAuth;

  it('an error that is not a refusal is not hidden as one: it propagates', async () => {
    const w = world();
    const broken = stubbed(() => Promise.reject(new Error('D1 is down')));
    await expect(handleSignIn(post('sign-in/google', { idToken: 'x' }), w.env, broken, 'google')).rejects.toThrow('D1 is down');
    expect(w.audits).toHaveLength(0);
  });

  it('a sign-in answer without a session token fails rather than answering one', async () => {
    const w = world();
    const redirecting = stubbed(() => Promise.resolve({ redirect: true, url: 'https://accounts.google.com/' }));
    await expect(handleSignIn(post('sign-in/google', { idToken: 'x' }), w.env, redirecting, 'google')).rejects.toThrow('without a session');
    expect(w.audits).toHaveLength(0);
  });
});
