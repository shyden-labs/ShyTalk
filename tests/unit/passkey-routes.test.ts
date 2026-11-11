import { describe, expect, it } from 'vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { APIError } from 'better-auth/api';
import { createAuth } from '../../workers/web/src/auth/better-auth.ts';
import { tokenHash } from '../../workers/web/src/app/email-code.ts';
import { passkeyHooks, type PreparedPasskeys } from '../../workers/web/src/app/passkey-hooks.ts';
import { handlePasskey, type PasskeyOperation, type PasskeyRouteDeps } from '../../workers/web/src/app/passkey.ts';
import type { AppSession } from '../../workers/web/src/app/session.ts';
import type { SetupIdentity } from '../../workers/web/src/app/setup-identity.ts';
import { assert, register, type SoftCredential } from '../support/webauthn.ts';

/**
 * The passkey routes (plan 7 Task 5, shyden-labs/ShyTalk#134 AC1, AC5, AC7):
 * `POST /api/app/passkey/register/options|verify` and
 * `/passkey/sign-in/options|verify`. Better Auth's plugin runs for real on the
 * memory adapter, answered by the software authenticator; who is setting up,
 * the setup's database part, and the session's audit rows are stood in.
 */

const ORIGIN = 'https://dev.site.example';
const RP = 'dev.site.example';

function world(options: { identity?: SetupIdentity | Response; auditFails?: boolean; passkeyWritesFail?: boolean } = {}) {
  const store: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification: [], passkey: [] };
  const prepared: PreparedPasskeys = new Map();
  const events: string[] = [];
  const auth = createAuth(
    {
      ENVIRONMENT_NAME: 'dev',
      SITE_ORIGIN: ORIGIN,
      BETTER_AUTH_SECRET: 'a-test-secret-that-is-long-enough-for-better-auth',
      GOOGLE_CLIENT_IDS: 'g',
      APPLE_AUDIENCES: 'a',
    },
    {
      database: memoryAdapter(store),
      googleKeys: () => Promise.reject(new Error('unused')),
      appleKeys: () => Promise.reject(new Error('unused')),
      passkeys: passkeyHooks(
        {
          identityByHash: (hash) =>
            Promise.resolve(
              options.identity !== undefined &&
                !(options.identity instanceof Response) &&
                options.identity.kind !== 'session' &&
                options.identity.tokenHash === hash
                ? options.identity
                : new Response(null, { status: 401 }),
            ),
          prepare: (identity) => {
            events.push(`prepare:${identity.kind}`);
            if (identity.kind === 'sign-up')
              store['user']?.push({
                id: identity.userId,
                name: 'new',
                email: identity.email,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            return Promise.resolve({ userId: identity.userId, recoveryCodes: ['CODE-1'] });
          },
        },
        prepared,
      ),
    },
  );
  let session: AppSession | null = null;
  // Stands in for D1 failing as the plugin writes the passkey: the real call (and its hook) runs, then it fails.
  const failingWrites = {
    ...auth,
    api: {
      ...auth.api,
      verifyPasskeyRegistration: async (...args: Parameters<typeof auth.api.verifyPasskeyRegistration>) => {
        await auth.api.verifyPasskeyRegistration(...args);
        throw new Error('D1 is down');
      },
    },
  } as unknown as typeof auth;
  const deps: PasskeyRouteDeps = {
    auth: options.passkeyWritesFail === true ? failingWrites : auth,
    prepared,
    limit: () => Promise.resolve(true),
    session: () => Promise.resolve(session),
    identity: (current, token) =>
      Promise.resolve(
        current !== null
          ? { kind: 'session', userId: current.userId }
          : token === null
            ? new Response(null, { status: 401 })
            : (options.identity ?? new Response(null, { status: 401 })),
      ),
    startSession: async (userId) => {
      events.push(`session:${userId}`);
      const made = await (await auth.$context).internalAdapter.createSession(userId);
      return { token: made.token };
    },
    signedIn: (userId) => {
      events.push(`signed-in:${userId}`);
      return Promise.resolve(
        options.auditFails === true ? new Response(JSON.stringify({ error: 'sign_in_failed' }), { status: 500 }) : null,
      );
    },
    sessionCookie: (token) => Promise.resolve(`session_token=${token}; HttpOnly`),
    undoSignUp: (userId) => {
      events.push(`undo:${userId}`);
      return Promise.resolve();
    },
  };
  const signIn = (as: AppSession | null) => {
    session = as;
  };
  return { auth, store, prepared, events, deps, signIn };
}

const call = (deps: PasskeyRouteDeps, operation: PasskeyOperation, body: unknown, cookie = ''): Promise<Response> =>
  handlePasskey(
    new Request(`${ORIGIN}/api/app/passkey/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie === '' ? {} : { cookie }) },
      body: JSON.stringify(body),
    }),
    operation,
    deps,
  );

const cookiesFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

async function registerThrough(deps: PasskeyRouteDeps, token?: string): Promise<{ answer: Response; credential: SoftCredential }> {
  const options = await call(deps, 'register/options', token === undefined ? {} : { token });
  expect(options.status).toBe(200);
  const { challenge } = (await options.json()) as { challenge: string };
  const { credential, response } = await register({ rpId: RP, origin: ORIGIN, challenge });
  const answer = await call(deps, 'register/verify', { response, ...(token === undefined ? {} : { token }) }, cookiesFrom(options));
  return { answer, credential };
}

async function signInThrough(deps: PasskeyRouteDeps, credential: SoftCredential): Promise<Response> {
  const options = await call(deps, 'sign-in/options', {});
  const { challenge } = (await options.json()) as { challenge: string };
  return call(
    deps,
    'sign-in/verify',
    { response: await assert(credential, { rpId: RP, origin: ORIGIN, challenge }) },
    cookiesFrom(options),
  );
}

describe('registering a passkey', () => {
  it("makes a sign-up's member, their passkey and a session, answering the recovery codes", async () => {
    const hash = await tokenHash('sign-up-token');
    const w = world({ identity: { kind: 'sign-up', userId: 'u-new', email: 'new@example.test', tokenHash: hash } });
    const { answer } = await registerThrough(w.deps, 'sign-up-token');
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { userId: string; token: string; recoveryCodes: string[] };
    expect(body.userId).toBe('u-new');
    expect(typeof body.token).toBe('string');
    expect(body.recoveryCodes).toEqual(['CODE-1']);
    expect(w.store['passkey']?.[0]?.['userId']).toBe('u-new');
    expect(w.events).toEqual(['prepare:sign-up', 'session:u-new']);
    expect(w.prepared.size).toBe(0);
    expect(answer.headers.getSetCookie()).toEqual([`session_token=${body.token}; HttpOnly`]);
  });

  it('adds a passkey for a signed-in member without a new session', async () => {
    const w = world();
    w.store['user']?.push({
      id: 'u-1',
      name: 'Member',
      email: 'm@example.test',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const made = await (await w.auth.$context).internalAdapter.createSession('u-1');
    w.signIn({ sessionId: made.id, userId: 'u-1', email: 'm@example.test', createdAt: Date.now() });
    const options = await handlePasskey(
      new Request(`${ORIGIN}/api/app/passkey/register/options`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: `Bearer ${made.token}` },
        body: '{}',
      }),
      'register/options',
      w.deps,
    );
    const { challenge } = (await options.json()) as { challenge: string };
    const { response } = await register({ rpId: RP, origin: ORIGIN, challenge });
    const answer = await handlePasskey(
      new Request(`${ORIGIN}/api/app/passkey/register/verify`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          authorization: `Bearer ${made.token}`,
          cookie: cookiesFrom(options),
        },
        body: JSON.stringify({ response }),
      }),
      'register/verify',
      w.deps,
    );
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ userId: 'u-1', recoveryCodes: ['CODE-1'] });
    expect(w.events).toEqual(['prepare:session']);
  });

  it('passes a refusal of who is setting up straight through, asking the plugin nothing', async () => {
    const w = world({ identity: new Response(JSON.stringify({ error: 'recovery_waiting' }), { status: 403 }) });
    const answer = await call(w.deps, 'register/options', { token: 'waiting' });
    expect(answer.status).toBe(403);
    expect(w.store['verification']).toHaveLength(0);
  });

  it('answers 401 to an answer the plugin cannot verify', async () => {
    const hash = await tokenHash('sign-up-token');
    const w = world({ identity: { kind: 'sign-up', userId: 'u-new', email: 'new@example.test', tokenHash: hash } });
    const options = await call(w.deps, 'register/options', { token: 'sign-up-token' });
    const { challenge } = (await options.json()) as { challenge: string };
    const { response } = await register({ rpId: 'another.example', origin: ORIGIN, challenge });
    const answer = await call(w.deps, 'register/verify', { response, token: 'sign-up-token' }, cookiesFrom(options));
    expect(answer.status).toBe(401);
    expect(w.events).toEqual([]);
  });

  it("undoes a sign-up's member when the passkey cannot be written after the member was made", async () => {
    const hash = await tokenHash('sign-up-token');
    const w = world({
      identity: { kind: 'sign-up', userId: 'u-new', email: 'new@example.test', tokenHash: hash },
      passkeyWritesFail: true,
    });
    const { answer } = await registerThrough(w.deps, 'sign-up-token');
    expect(answer.status).toBe(500);
    expect(w.events).toEqual(['prepare:sign-up', 'undo:u-new']);
    expect(w.prepared.size).toBe(0);
  });
});

describe('registering a passkey: the rest of its paths', () => {
  it('answers 401 with neither a session nor a token', async () => {
    const w = world();
    expect((await call(w.deps, 'register/verify', { response: {} })).status).toBe(401);
  });

  it("answers 500 without undoing anyone when a member's own registration fails after the hook", async () => {
    const w = world({ passkeyWritesFail: true });
    w.store['user']?.push({
      id: 'u-1',
      name: 'Member',
      email: 'm@example.test',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const made = await (await w.auth.$context).internalAdapter.createSession('u-1');
    w.signIn({ sessionId: made.id, userId: 'u-1', email: 'm@example.test', createdAt: Date.now() });
    const headers = { 'content-type': 'application/json', origin: ORIGIN, authorization: `Bearer ${made.token}` };
    const options = await handlePasskey(new Request(`${ORIGIN}/x`, { method: 'POST', headers, body: '{}' }), 'register/options', w.deps);
    const { challenge } = (await options.json()) as { challenge: string };
    const { response } = await register({ rpId: RP, origin: ORIGIN, challenge });
    const answer = await handlePasskey(
      new Request(`${ORIGIN}/x`, {
        method: 'POST',
        headers: { ...headers, cookie: cookiesFrom(options) },
        body: JSON.stringify({ response }),
      }),
      'register/verify',
      w.deps,
    );
    expect(answer.status).toBe(500);
    expect(w.events).toEqual(['prepare:session']);
  });

  it('answers 500 when the registration succeeded but left no prepared setup', async () => {
    const hash = await tokenHash('sign-up-token');
    const w = world({ identity: { kind: 'sign-up', userId: 'u-new', email: 'new@example.test', tokenHash: hash } });
    const forgetful = { ...w.deps, prepared: new Map() as PreparedPasskeys };
    const options = await call(forgetful, 'register/options', { token: 'sign-up-token' });
    const { challenge } = (await options.json()) as { challenge: string };
    const { response } = await register({ rpId: RP, origin: ORIGIN, challenge });
    expect((await call(forgetful, 'register/verify', { response, token: 'sign-up-token' }, cookiesFrom(options))).status).toBe(500);
  });

  it('passes a session that cannot start straight through', async () => {
    const hash = await tokenHash('sign-up-token');
    const w = world({ identity: { kind: 'sign-up', userId: 'u-new', email: 'new@example.test', tokenHash: hash } });
    const failing = { ...w.deps, startSession: () => Promise.resolve(new Response(null, { status: 500 })) };
    expect((await registerThrough(failing, 'sign-up-token')).answer.status).toBe(500);
  });
});

describe("the plugin's errors", () => {
  it("answers 500 to the plugin's own failure, and lets anything else through as the Worker's error", async () => {
    const w = world();
    const failing = (error: Error) =>
      ({
        ...w.deps,
        auth: { ...w.auth, api: { ...w.auth.api, generatePasskeyAuthenticationOptions: () => Promise.reject(error) } },
      }) as unknown as PasskeyRouteDeps;
    expect((await call(failing(new APIError('INTERNAL_SERVER_ERROR')), 'sign-in/options', {})).status).toBe(500);
    await expect(call(failing(new Error('D1 is down')), 'sign-in/options', {})).rejects.toThrow('D1 is down');
  });
});

describe('signing in with a passkey', () => {
  async function registered() {
    const hash = await tokenHash('sign-up-token');
    const w = world({ identity: { kind: 'sign-up', userId: 'u-new', email: 'new@example.test', tokenHash: hash } });
    const { credential } = await registerThrough(w.deps, 'sign-up-token');
    w.events.length = 0;
    return { w, credential };
  }

  it('starts a session for its member and audits it, answering {token, userId}', async () => {
    const { w, credential } = await registered();
    const answer = await signInThrough(w.deps, credential);
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { token: string; userId: string };
    expect(body.userId).toBe('u-new');
    expect(w.events).toEqual(['signed-in:u-new']);
    expect(answer.headers.getSetCookie().some((cookie) => cookie.includes('session_token'))).toBe(true);
  });

  it('answers 401 sign_in_refused to an answer replayed against a fresh challenge', async () => {
    const { w, credential } = await registered();
    const options = await call(w.deps, 'sign-in/options', {});
    const { challenge } = (await options.json()) as { challenge: string };
    const response = await assert(credential, { rpId: RP, origin: ORIGIN, challenge });
    expect((await call(w.deps, 'sign-in/verify', { response }, cookiesFrom(options))).status).toBe(200);
    const fresh = await call(w.deps, 'sign-in/options', {});
    const replayed = await call(w.deps, 'sign-in/verify', { response }, cookiesFrom(fresh));
    expect(replayed.status).toBe(401);
    expect(await replayed.json()).toEqual({ error: 'sign_in_refused' });
  });

  it('passes a failed audit straight through', async () => {
    const hash = await tokenHash('sign-up-token');
    const w = world({ identity: { kind: 'sign-up', userId: 'u-new', email: 'new@example.test', tokenHash: hash }, auditFails: true });
    const { credential } = await registerThrough(w.deps, 'sign-up-token');
    expect((await signInThrough(w.deps, credential)).status).toBe(500);
  });
});

describe('every passkey route', () => {
  it.each(['register/options', 'register/verify', 'sign-in/options', 'sign-in/verify'] as const)(
    '%s answers 405 to GET, 429 over the limit and 400 to a body that is not JSON',
    async (operation) => {
      const w = world();
      expect((await handlePasskey(new Request(`${ORIGIN}/x`, { method: 'GET' }), operation, w.deps)).status).toBe(405);
      expect((await call({ ...w.deps, limit: () => Promise.resolve(false) }, operation, {})).status).toBe(429);
      const notJson = new Request(`${ORIGIN}/x`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
      expect((await handlePasskey(notJson, operation, w.deps)).status).toBe(400);
    },
  );
});
