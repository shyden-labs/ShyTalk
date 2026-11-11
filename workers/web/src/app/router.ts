/**
 * The app's API (plan 4 Task 1, shyden-labs/ShyTalk#74): every path under
 * `/api/app/`, reached after the site's door and environment-marker checks.
 * Sign-in and sign-out (plan 4 Task 3, shyden-labs/ShyTalk#76) answer only
 * when the Worker has all they need, and 503 otherwise.
 */
import { json } from '../http.ts';
import type { WebEnv } from '../web.ts';
import { getAuth } from '../auth/better-auth.ts';
import { handleSignIn, handleSignOut, type Provider } from './sign-in.ts';
import { handleAnnounce, handleLive } from './announcer.ts';
import { d1UiStore, handleUi } from './ui.ts';
import { emailDeps, handleEmailStart, handleEmailVerify } from './email-routes.ts';
import { handleRecoveryCancel, handleRecoveryPending } from './recovery.ts';
import { handleCodeSignIn, type CodeKind } from './code-sign-in.ts';
import { handleTotpConfirm, handleTotpSetup } from './totp-routes.ts';
import { handlePasskey, type PasskeyOperation } from './passkey.ts';
import type { PreparedPasskeys } from './passkey-hooks.ts';
import { handleMethods } from './methods.ts';
import { codeVerifier, passkeyHooksFor, passkeyRouteDeps, sessionReader, totpRouteDeps, type ReadyEnv } from './wiring.ts';

export const APP_API_PREFIX = '/api/app/';

/** Whether `pathname` belongs to the app's API: `/api/app` itself or anything under it. */
export const isAppApi = (pathname: string): boolean => pathname === '/api/app' || pathname.startsWith(APP_API_PREFIX);

const SIGN_IN: Record<string, Provider> = {
  [`${APP_API_PREFIX}sign-in/google`]: 'google',
  [`${APP_API_PREFIX}sign-in/apple`]: 'apple',
};
const CODE_SIGN_IN: Record<string, CodeKind> = {
  [`${APP_API_PREFIX}sign-in/totp`]: 'totp',
  [`${APP_API_PREFIX}sign-in/recovery-code`]: 'recovery-code',
};
const SIGN_OUT = `${APP_API_PREFIX}sign-out`;
const TOTP_SETUP = `${APP_API_PREFIX}totp/setup`;
const PASSKEY: Record<string, PasskeyOperation> = {
  [`${APP_API_PREFIX}passkey/register/options`]: 'register/options',
  [`${APP_API_PREFIX}passkey/register/verify`]: 'register/verify',
  [`${APP_API_PREFIX}passkey/sign-in/options`]: 'sign-in/options',
  [`${APP_API_PREFIX}passkey/sign-in/verify`]: 'sign-in/verify',
};
/** A registration's prepared setup, from the plugin's hook to its route, within one request. */
const PREPARED_PASSKEYS: PreparedPasskeys = new Map();
const TOTP_CONFIRM = `${APP_API_PREFIX}totp/confirm`;
const EMAIL_START = `${APP_API_PREFIX}email/start`;
const EMAIL_VERIFY = `${APP_API_PREFIX}email/verify`;
const RECOVERY = `${APP_API_PREFIX}recovery`;
const RECOVERY_CANCEL = `${RECOVERY}/cancel`;
const UI = `${APP_API_PREFIX}ui`;
const LIVE = `${APP_API_PREFIX}live`;
const LIVE_ANNOUNCE = `${LIVE}/announce`;

/** Whether `pathname` is `/api/app/<area>` or below it. */
const isUnder = (pathname: string, area: string): boolean =>
  pathname === `${APP_API_PREFIX}${area}` || pathname.startsWith(`${APP_API_PREFIX}${area}/`);

/** A Worker's D1 binding, which the unit tests' marker-only stand-ins are not. */
const isD1 = (db: NonNullable<WebEnv['DB']>): db is NonNullable<WebEnv['DB']> & ReadyEnv['DB'] => 'batch' in db && 'exec' in db;

/** `env` when it holds everything sign-in needs: its settings, the rate limit and a D1 database. */
function readyForSignIn(env: WebEnv): ReadyEnv | null {
  const { ENVIRONMENT_NAME, DB, SITE_ORIGIN, BETTER_AUTH_SECRET, GOOGLE_CLIENT_IDS, APPLE_AUDIENCES, SIGN_IN_LIMIT } = env;
  if (SITE_ORIGIN === undefined || BETTER_AUTH_SECRET === undefined || GOOGLE_CLIENT_IDS === undefined || APPLE_AUDIENCES === undefined)
    return null;
  if (SIGN_IN_LIMIT === undefined || DB === undefined || !isD1(DB)) return null;
  return { ENVIRONMENT_NAME, DB, SITE_ORIGIN, BETTER_AUTH_SECRET, GOOGLE_CLIENT_IDS, APPLE_AUDIENCES, SIGN_IN_LIMIT };
}

export function handleAppApi(request: Request, env: WebEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === `${APP_API_PREFIX}health`) {
    if (request.method !== 'GET') return Promise.resolve(new Response(null, { status: 405, headers: { allow: 'GET' } }));
    return Promise.resolve(json(200, { ok: true, environment: env.ENVIRONMENT_NAME }));
  }
  if (pathname === UI) {
    const { ENVIRONMENT_NAME, DB } = env;
    if (DB === undefined || !isD1(DB)) return Promise.resolve(json(503, { error: 'ui_unavailable' }));
    return handleUi(request, d1UiStore({ ENVIRONMENT_NAME, DB }));
  }
  if (pathname === LIVE) return live(request, env);
  if (pathname === LIVE_ANNOUNCE) return liveAnnounce(request, env);
  if (pathname === EMAIL_START || pathname === EMAIL_VERIFY) {
    const ready = readyForSignIn(env);
    if (ready === null) return Promise.resolve(json(503, { error: 'sign_in_unavailable' }));
    const emailEnv = { ...env, ...ready };
    return pathname === EMAIL_START
      ? handleEmailStart(request, emailEnv, emailDeps(emailEnv))
      : handleEmailVerify(request, emailEnv, emailDeps(emailEnv));
  }
  if (pathname === RECOVERY || pathname === RECOVERY_CANCEL) {
    const ready = readyForSignIn(env);
    if (ready === null) return Promise.resolve(json(503, { error: 'sign_in_unavailable' }));
    const auth = authFor(ready);
    const sessionOf = sessionReader(auth);
    return pathname === RECOVERY ? handleRecoveryPending(request, ready, sessionOf) : handleRecoveryCancel(request, ready, sessionOf);
  }
  if (pathname === TOTP_SETUP || pathname === TOTP_CONFIRM) return totpSetupRoute(request, env, pathname === TOTP_SETUP);
  if (isUnder(pathname, 'sign-in-methods') || isUnder(pathname, 'sessions') || isUnder(pathname, 'recovery-codes')) {
    const ready = readyForSignIn(env);
    if (ready === null) return Promise.resolve(json(503, { error: 'sign_in_unavailable' }));
    const auth = authFor(ready);
    return handleMethods(request, ready, sessionReader(auth));
  }
  const passkeyOperation = PASSKEY[pathname];
  if (passkeyOperation !== undefined) return passkeyRoute(request, env, passkeyOperation);
  const codeKind = CODE_SIGN_IN[pathname];
  if (codeKind !== undefined) {
    const ready = readyForSignIn(env);
    const { TOTP_KEY } = env;
    if (ready === null || (codeKind === 'totp' && TOTP_KEY === undefined))
      return Promise.resolve(json(503, { error: 'sign_in_unavailable' }));
    return handleCodeSignIn(request, ready, authFor(ready), codeKind, codeVerifier(codeKind, ready, TOTP_KEY));
  }
  const provider = SIGN_IN[pathname];
  if (provider !== undefined || pathname === SIGN_OUT) {
    const ready = readyForSignIn(env);
    if (ready === null) return Promise.resolve(json(503, { error: 'sign_in_unavailable' }));
    const auth = authFor(ready);
    return provider === undefined ? handleSignOut(request, ready, auth) : handleSignIn(request, ready, auth, provider);
  }
  return Promise.resolve(json(404, { error: 'not_found' }));
}

/** `GET /api/app/live` (plan 4 Task 8): the WebSocket that tells the app a new UI is published. */
async function live(request: Request, env: WebEnv): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });
  const { ENVIRONMENT_NAME, DB, ANNOUNCER } = env;
  if (ANNOUNCER === undefined || DB === undefined || !isD1(DB)) return json(503, { error: 'live_unavailable' });
  const newest = await d1UiStore({ ENVIRONMENT_NAME, DB }).newest('everyone');
  return handleLive(request, ANNOUNCER, newest?.version ?? null);
}

/** `POST /api/app/live/announce` (plan 4 Task 8): the deploy tells every open app the newest version. */
async function liveAnnounce(request: Request, env: WebEnv): Promise<Response> {
  const { ENVIRONMENT_NAME, DB, ANNOUNCER, ANNOUNCE_SECRET } = env;
  if (ANNOUNCER === undefined || ANNOUNCE_SECRET === undefined || DB === undefined || !isD1(DB))
    return json(503, { error: 'live_unavailable' });
  const newest = await d1UiStore({ ENVIRONMENT_NAME, DB }).newest('everyone');
  return handleAnnounce(request, ANNOUNCER, ANNOUNCE_SECRET, newest?.version ?? null);
}

/** `POST /api/app/totp/setup` and `/totp/confirm` (plan 7, shyden-labs/ShyTalk#134). */
function totpSetupRoute(request: Request, env: WebEnv, isSetup: boolean): Promise<Response> {
  const ready = readyForSignIn(env);
  const { TOTP_KEY } = env;
  if (ready === null || TOTP_KEY === undefined) return Promise.resolve(json(503, { error: 'sign_in_unavailable' }));
  const deps = totpRouteDeps(request, ready, TOTP_KEY, authFor(ready));
  return isSetup ? handleTotpSetup(request, deps) : handleTotpConfirm(request, deps);
}

/** Better Auth with the passkey hooks, which reach the app's own tables (plan 7, shyden-labs/ShyTalk#134). */
function authFor(ready: ReadyEnv) {
  return getAuth(ready, () => passkeyHooksFor(ready, PREPARED_PASSKEYS));
}

/** The four passkey routes (plan 7 Task 5, shyden-labs/ShyTalk#134 AC1). */
function passkeyRoute(request: Request, env: WebEnv, operation: PasskeyOperation): Promise<Response> {
  const ready = readyForSignIn(env);
  if (ready === null) return Promise.resolve(json(503, { error: 'sign_in_unavailable' }));
  return handlePasskey(request, operation, passkeyRouteDeps(request, ready, authFor(ready), PREPARED_PASSKEYS));
}
