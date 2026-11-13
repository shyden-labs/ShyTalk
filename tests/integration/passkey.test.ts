import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuth, type ShyTalkAuth } from '../../workers/web/src/auth/better-auth.ts';
import { sessionCookie, startSession } from '../../workers/web/src/app/code-sign-in.ts';
import { tokenHash } from '../../workers/web/src/app/email-code.ts';
import { prepareSetup } from '../../workers/web/src/app/finish-setup.ts';
import {
  auditPasskeySignIn,
  handlePasskey,
  undoSignUp,
  type PasskeyOperation,
  type PasskeyRouteDeps,
} from '../../workers/web/src/app/passkey.ts';
import { passkeyHooks, type PreparedPasskeys } from '../../workers/web/src/app/passkey-hooks.ts';
import { appSession } from '../../workers/web/src/app/session.ts';
import { setupIdentity, setupIdentityByHash, type SetupEnv } from '../../workers/web/src/app/setup-identity.ts';
import type { SignInEnv } from '../../workers/web/src/app/sign-in.ts';
import { issuer } from '../support/id-tokens.ts';
import { assert, register } from '../support/webauthn.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * A passkey on a real D1, through the real pieces as the router joins them
 * (plan 7 Task 5, shyden-labs/ShyTalk#134 AC1, with #133's sign-up token):
 * Better Auth's D1 adapter, the passkey table's foreign key on the user, the
 * hooks and prepareSetup. The software authenticator stands in for the phone.
 */

const ORIGIN = 'https://site.example.test';
const RP = 'site.example.test';

let local: LocalDevEnv;
let dispose: () => Promise<void>;
let auth: ShyTalkAuth;
let env: SignInEnv & SetupEnv;
const prepared: PreparedPasskeys = new Map();
const REAL = { now: Date.now, newId: () => crypto.randomUUID() };

beforeAll(async () => {
  ({ env: local, dispose } = await localDev());
  const settings = {
    ENVIRONMENT_NAME: 'dev',
    SITE_ORIGIN: ORIGIN,
    BETTER_AUTH_SECRET: 'an-integration-secret-long-enough-for-better-auth',
    GOOGLE_CLIENT_IDS: 'g',
    APPLE_AUDIENCES: 'a',
  } as const;
  env = { ...settings, DB: local.DB, SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: true }) } };
  const keys = (await issuer(inject('idTokenKeys'))).keys;
  auth = createAuth(settings, {
    database: local.DB,
    googleKeys: keys,
    appleKeys: keys,
    passkeys: passkeyHooks(
      {
        identityByHash: (hash) => setupIdentityByHash(env, hash, REAL),
        prepare: (identity) => prepareSetup(env, identity, 'passkey', Date.now()),
      },
      prepared,
    ),
  });
});

afterAll(async () => {
  await dispose();
});

function deps(request: Request): PasskeyRouteDeps {
  return {
    auth,
    prepared,
    limit: () => Promise.resolve(true),
    session: () => appSession(request, auth),
    identity: (session, token) => setupIdentity(env, session, token, REAL),
    startSession: (userId, detail) => startSession(env, auth, userId, detail),
    signedIn: (userId, sessionToken) => auditPasskeySignIn(env, auth, userId, sessionToken),
    sessionCookie: (token) => sessionCookie(auth, token),
    undoSignUp: (userId) => undoSignUp(env, userId),
  };
}

const call = (operation: PasskeyOperation, body: unknown, cookie = ''): Promise<Response> => {
  const request = new Request(`${ORIGIN}/api/app/passkey/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie === '' ? {} : { cookie }) },
    body: JSON.stringify(body),
  });
  return handlePasskey(request, operation, deps(request));
};

const cookiesFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

describe('a passkey on D1', () => {
  it('signs up with #133 token and a passkey, refuses a second registration with the spent token, then signs in with the passkey', async () => {
    await local.DB.prepare("INSERT INTO one_time_token (token_hash, purpose, user_id, email, expires_at) VALUES (?, 'sign-up', NULL, ?, ?)")
      .bind(await tokenHash('d1-sign-up'), 'passkey-person@example.test', Date.now() + 600_000)
      .run();

    const options = await call('register/options', { token: 'd1-sign-up' });
    expect(options.status).toBe(200);
    const { challenge } = (await options.json()) as { challenge: string };
    const { credential, response } = await register({ rpId: RP, origin: ORIGIN, challenge });
    const registered = await call('register/verify', { response, token: 'd1-sign-up' }, cookiesFrom(options));
    expect(registered.status).toBe(200);
    const made = (await registered.json()) as { userId: string; token: string; recoveryCodes: string[] };
    expect(made.recoveryCodes).toHaveLength(10);
    // The spent sign-up token starts no second registration (shyden-labs/ShyTalk#180: was its own journey).
    expect((await call('register/options', { token: 'd1-sign-up' })).status).toBe(401);
    const signedUp = new Request(`${ORIGIN}/x`, { headers: { authorization: `Bearer ${made.token}` } });
    expect((await appSession(signedUp, auth))?.email).toBe('passkey-person@example.test');
    const stored = await local.DB.prepare('SELECT "userId", "publicKey" FROM passkey WHERE "userId" = ?')
      .bind(made.userId)
      .first<{ publicKey: string }>();
    expect(stored?.publicKey.length).toBeGreaterThan(0);

    const signInOptions = await call('sign-in/options', {});
    const signIn = (await signInOptions.json()) as { challenge: string };
    const signedIn = await call(
      'sign-in/verify',
      { response: await assert(credential, { rpId: RP, origin: ORIGIN, challenge: signIn.challenge }) },
      cookiesFrom(signInOptions),
    );
    expect(signedIn.status).toBe(200);
    expect(((await signedIn.json()) as { userId: string }).userId).toBe(made.userId);
    const audited = await local.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit WHERE subject = ? AND action IN ('user.create', 'method.add', 'method.use')",
    )
      .bind(`user:${made.userId}`)
      .first<{ n: number }>();
    expect(audited?.n).toBe(3);
  });
});
