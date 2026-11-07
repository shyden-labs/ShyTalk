/**
 * The app's API (plan 4 Task 1, shyden-labs/ShyTalk#74): every path under
 * `/api/app/`, reached after the site's door and environment-marker checks.
 * Sign-in and sign-out (plan 4 Task 3, shyden-labs/ShyTalk#76) answer only
 * when the Worker has all they need, and 503 otherwise.
 */
import { json } from '../http.ts';
import type { WebEnv } from '../web.ts';
import { getAuth, type AuthDatabase } from '../auth/better-auth.ts';
import { handleSignIn, handleSignOut, type Provider, type SignInEnv } from './sign-in.ts';
import { handleLive } from './announcer.ts';
import { d1UiStore, handleUi } from './ui.ts';

export const APP_API_PREFIX = '/api/app/';

/** Whether `pathname` belongs to the app's API: `/api/app` itself or anything under it. */
export const isAppApi = (pathname: string): boolean => pathname === '/api/app' || pathname.startsWith(APP_API_PREFIX);

const SIGN_IN: Record<string, Provider> = {
  [`${APP_API_PREFIX}sign-in/google`]: 'google',
  [`${APP_API_PREFIX}sign-in/apple`]: 'apple',
};
const SIGN_OUT = `${APP_API_PREFIX}sign-out`;
const UI = `${APP_API_PREFIX}ui`;
const LIVE = `${APP_API_PREFIX}live`;

type ReadyEnv = SignInEnv & { DB: AuthDatabase };

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
  const provider = SIGN_IN[pathname];
  if (provider !== undefined || pathname === SIGN_OUT) {
    const ready = readyForSignIn(env);
    if (ready === null) return Promise.resolve(json(503, { error: 'sign_in_unavailable' }));
    const auth = getAuth(ready);
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
