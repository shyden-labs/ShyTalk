/**
 * The site's Worker (plan 3 Task 1, shyden-labs/ShyTalk#51; design 4.17).
 * PROD answers shytalk.app; TEST and DEV are the workers.dev origins behind
 * their doors, so there every request needs the door secret
 * (packages/environment). `/api/*` goes to the API; everything else to the
 * built pages (Workers static assets, Astro's output). Every answer carries
 * the security headers. After the door, every request checks that `DB` names
 * this environment (plan 4 Task 2, shyden-labs/ShyTalk#75), PROD included, so
 * no Worker serves from another environment's database.
 */
import { createMarkerGuard, requireDoorSecret, type D1Like } from '../../../packages/environment/index.ts';
import { handleClosedTesting, isClosedTesting, type ClosedTestingEnv } from './api/closed-testing.ts';
import { handleAppApi, isAppApi } from './app/router.ts';
import { json } from './http.ts';
import type { RateLimit } from './app/sign-in.ts';
import type { AnnouncerNamespace } from './app/announcer.ts';

/** Everything comes from this site: no inline script or style, no `data:`, no frames. */
export const CONTENT_SECURITY_POLICY = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'";

export interface WebEnv {
  /** Which environment this Worker is (a var): only TEST and DEV sit behind a door. */
  ENVIRONMENT_NAME: 'prod' | 'test' | 'dev';
  /** The environment's door secret (a Wrangler secret, TEST and DEV only). */
  DOOR_SECRET?: string;
  /** The environment's own D1 database, `shytalk-<env>`, marked with its name; absent only in a Worker deployed without it, which serves nothing. */
  DB?: D1Like;
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** App sign-in's settings (plan 4 Task 3, shyden-labs/ShyTalk#76): see `AuthEnv`; absent, sign-in answers 503. */
  /** The live announcement's Durable Object (plan 4 Task 8, shyden-labs/ShyTalk#81); absent, `/api/app/live` answers 503. */
  ANNOUNCER?: AnnouncerNamespace;
  /** The secret a deploy puts in the Worker and calls `/api/app/live/announce` with; absent, that route answers 503. */
  ANNOUNCE_SECRET?: string;
  SITE_ORIGIN?: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_IDS?: string;
  APPLE_AUDIENCES?: string;
  /** Sign-in attempts per IP (wrangler.json `ratelimits`). */
  SIGN_IN_LIMIT?: RateLimit;
  /** Seals authenticator-app secrets (a Wrangler secret, shyden-labs/ShyTalk#134). */
  TOTP_KEY?: string;
  /** Closed-testing applications per IP (wrangler.json `ratelimits`); absent, the form answers 503. */
  APPLY_LIMIT?: RateLimit;
}

const ENVIRONMENTS = new Set(['prod', 'test', 'dev']);

/**
 * One marker guard per `DB` binding, made on its first request and kept for
 * the isolate's life. Keyed by the binding, so a pass for one database (one
 * unit test's env) never stands for another.
 */
const guards = new WeakMap<D1Like, ReturnType<typeof createMarkerGuard>>();

function markerGuard(environment: string, db: D1Like): ReturnType<typeof createMarkerGuard> {
  let guard = guards.get(db);
  if (guard === undefined) {
    guard = createMarkerGuard(environment, { databases: { DB: db }, buckets: {} });
    guards.set(db, guard);
  }
  return guard;
}

/** A Worker's D1 binding, which the unit tests' marker-only stand-ins are not. */
const hasFullD1 = (env: WebEnv): env is WebEnv & ClosedTestingEnv => env.DB !== undefined && 'batch' in env.DB;

/** The API: the closed-testing form (plan 3 Task 5, shyden-labs/ShyTalk#55). */
export function handleApi(request: Request, env: WebEnv): Promise<Response> {
  if (!isClosedTesting(new URL(request.url).pathname)) return Promise.resolve(json(404, { error: 'not_found' }));
  if (!hasFullD1(env)) return Promise.resolve(json(503, { state: 'send_failed' }));
  return handleClosedTesting(request, env);
}

async function route(request: Request, env: WebEnv): Promise<Response> {
  // An unnamed environment cannot know whether it needs a door, so it serves nothing.
  if (!ENVIRONMENTS.has(env.ENVIRONMENT_NAME)) return new Response('Service Unavailable', { status: 503 });
  if (env.ENVIRONMENT_NAME !== 'prod') {
    const refused = await requireDoorSecret(request, env.DOOR_SECRET);
    if (refused) return refused;
  }
  // A Worker deployed without its database cannot prove whose data it serves.
  if (!env.DB) return new Response('Service Unavailable', { status: 503 });
  const wrongStore = await markerGuard(env.ENVIRONMENT_NAME, env.DB).assertEnvironmentMarkers();
  if (wrongStore) return wrongStore;
  const { pathname } = new URL(request.url);
  if (isAppApi(pathname)) return handleAppApi(request, env);
  if (pathname.startsWith('/api/')) return handleApi(request, env);
  return env.ASSETS.fetch(request);
}

/** Routes the request and puts the security headers on whatever answers. */
export async function handle(request: Request, env: WebEnv): Promise<Response> {
  const answer = await route(request, env);
  // A WebSocket upgrade's 101 carries the socket, which a copied Response would lose; it carries no page to protect.
  if (answer.status === 101) return answer;
  const response = new Response(answer.body, answer);
  response.headers.set('content-security-policy', CONTENT_SECURITY_POLICY);
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  return response;
}
