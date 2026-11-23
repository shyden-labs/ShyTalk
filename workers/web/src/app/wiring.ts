/**
 * How the router joins the real pieces for sign-in (plan 7,
 * shyden-labs/ShyTalk#134): each route's dependencies, built from the
 * environment, the request and Better Auth. The routes themselves take these
 * as arguments, so their tests stand them in; tests/unit/wiring.test.ts shows
 * each one reaching the right code.
 */
import type { AuthDatabase, PasskeyHooks, ShyTalkAuth } from '../auth/better-auth.ts';
import { sessionCookie, startSession, type CodeKind, type CodeVerifier } from './code-sign-in.ts';
import { finishSetup, prepareSetup } from './finish-setup.ts';
import { auditPasskeySignIn, undoSignUp, type PasskeyRouteDeps } from './passkey.ts';
import { passkeyHooks, type PreparedPasskeys } from './passkey-hooks.ts';
import { useRecoveryCode } from './recovery-codes.ts';
import { appSession, type AppSession } from './session.ts';
import { setupIdentity, setupIdentityByHash, type SetupDeps, type SetupEnv } from './setup-identity.ts';
import type { SignInEnv } from './sign-in.ts';
import { confirmTotp, setupTotp, signInTotp, totpGoesLive } from './totp.ts';
import type { TotpRouteDeps } from './totp-routes.ts';

/** Everything sign-in needs from the Worker's environment, D1 included. */
export type ReadyEnv = SignInEnv & SetupEnv & { DB: AuthDatabase };

/** Who-is-setting-up's clock and member ids, in production. */
export const SETUP_DEPS: SetupDeps = { now: Date.now, newId: crypto.randomUUID.bind(crypto) };

/** Reads a request's session through Better Auth. */
export const sessionReader =
  (auth: ShyTalkAuth) =>
  (request: Request): Promise<AppSession | null> =>
    appSession(request, auth);

/** The sign-in rate limit for the request's address. */
export const ipLimit = (request: Request, ready: ReadyEnv) => async (): Promise<boolean> =>
  (await ready.SIGN_IN_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' })).success;

/** The check for a code sign-in of `kind`: an authenticator code under `totpKey` (the router refuses that kind without one), or a recovery code. */
export function codeVerifier(kind: CodeKind, ready: ReadyEnv, totpKey: string | undefined): CodeVerifier {
  if (kind === 'recovery-code') return (email, code, now) => useRecoveryCode(ready, email, code, now);
  return async (email, code, now) => {
    const userId = await signInTotp({ ...ready, TOTP_KEY: totpKey as string }, email, code, now);
    return userId === null ? null : { userId };
  };
}

/**
 * The authenticator setup routes' dependencies. Who is setting up decides the
 * flow the pending authenticator is tied to (a session, or the token's hash)
 * and whether a recovery's new one may replace a live one.
 */
export function totpRouteDeps(request: Request, ready: ReadyEnv, totpKey: string, auth: ShyTalkAuth): TotpRouteDeps {
  const totpEnv = { ...ready, TOTP_KEY: totpKey };
  let flow = 'session';
  let recovering = false;
  return {
    limit: ipLimit(request, ready),
    identity: async (token) => {
      const identity = await setupIdentity(ready, await appSession(request, auth), token, SETUP_DEPS);
      if (!(identity instanceof Response) && identity.kind !== 'session') {
        flow = identity.tokenHash;
        recovering = identity.kind === 'recovery';
      }
      return identity;
    },
    emailOf: async (userId) => {
      const answers = (await ready.DB.batch([ready.DB.prepare('SELECT email FROM "user" WHERE id = ?').bind(userId)])) as {
        results: { email: string }[];
      }[];
      const row = (answers[0] as { results: { email: string }[] }).results[0];
      return row === undefined ? '' : row.email;
    },
    setup: (userId, email) => setupTotp(totpEnv, userId, email, Date.now(), { flow, replaceLive: recovering }),
    confirm: (userId, code) => confirmTotp(totpEnv, userId, code, Date.now(), flow),
    finish: (identity, confirmed) => {
      const now = Date.now();
      return finishSetup(ready, auth, identity, 'totp', now, totpGoesLive(totpEnv, identity.userId, confirmed, now));
    },
    sessionCookie: (token) => sessionCookie(auth, token),
  };
}

/** The passkey plugin's registration hooks, reaching the app's own tables. */
export function passkeyHooksFor(ready: ReadyEnv, prepared: PreparedPasskeys): PasskeyHooks {
  return passkeyHooks(
    {
      identityByHash: (hash) => setupIdentityByHash(ready, hash, SETUP_DEPS),
      prepare: (identity) => prepareSetup(ready, identity, 'passkey', Date.now()),
    },
    prepared,
  );
}

/** The passkey routes' dependencies. */
export function passkeyRouteDeps(request: Request, ready: ReadyEnv, auth: ShyTalkAuth, prepared: PreparedPasskeys): PasskeyRouteDeps {
  return {
    auth,
    prepared,
    limit: ipLimit(request, ready),
    session: () => appSession(request, auth),
    identity: (session, token) => setupIdentity(ready, session, token, SETUP_DEPS),
    startSession: (userId, detail) => startSession(ready, auth, userId, detail),
    signedIn: (userId, sessionToken) => auditPasskeySignIn(ready, auth, userId, sessionToken),
    sessionCookie: (token) => sessionCookie(auth, token),
    undoSignUp: (userId) => undoSignUp(ready, userId),
  };
}
