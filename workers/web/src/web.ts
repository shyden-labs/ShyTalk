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
import { handleAppApi, isAppApi } from './app/router.ts';
import { json } from './http.ts';

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

/** The API: nothing yet (plan 3 Task 5 adds the closed-testing form). */
export function handleApi(): Promise<Response> {
  return Promise.resolve(json(404, { error: 'not_found' }));
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
  if (pathname.startsWith('/api/')) return handleApi();
  return env.ASSETS.fetch(request);
}

/** Routes the request and puts the security headers on whatever answers. */
export async function handle(request: Request, env: WebEnv): Promise<Response> {
  const answer = await route(request, env);
  const response = new Response(answer.body, answer);
  response.headers.set('content-security-policy', CONTENT_SECURITY_POLICY);
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  return response;
}
