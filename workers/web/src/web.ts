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
  /** "true" while production holds (a var, prod only): every address answers the holding page (shyden-labs/ShyTalk#261). */
  HOLDING?: string;
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

/** The site's languages other than English, each with its own holding page under its own folder. */
const HOLDING_LANGUAGES = ['id', 'th', 'vi', 'zh'];

/**
 * The holding page for a visitor's `Accept-Language`: the most wanted of the site's languages (a `zh-*` tag is
 * Chinese, written simplified on this site), English when none is wanted or the header is absent.
 */
export function holdingPath(languages: string | null): string {
  let best = { language: 'en', weight: 0 };
  for (const part of (languages ?? '').split(',')) {
    const [tag = '', ...parameters] = part.trim().split(';');
    const language = tag.trim().toLowerCase().replace(/-.*/, '');
    const q = parameters.map((parameter) => parameter.trim()).find((parameter) => parameter.startsWith('q='));
    const weight = q === undefined ? 1 : Number(q.slice(2));
    const wanted = Number.isNaN(weight) ? 1 : weight;
    if ((language === 'en' || HOLDING_LANGUAGES.includes(language)) && wanted > best.weight) best = { language, weight: wanted };
  }
  return best.language === 'en' ? '/holding' : `/${best.language}/holding`;
}

/** What the holding page itself loads, served as built: its stylesheet and its link-preview picture. */
const HOLDING_ASSETS = ['/styles/', '/previews/'];

/**
 * Production while it holds: the www address sends the visitor to the bare one; its home answers the holding page
 * in the visitor's language; what the page loads is served; every other address answers the holding page as a 404.
 */
async function holding(request: Request, env: WebEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname.startsWith('www.')) {
    url.hostname = url.hostname.slice('www.'.length);
    return Response.redirect(url.toString(), 301);
  }
  if (HOLDING_ASSETS.some((prefix) => url.pathname.startsWith(prefix))) return env.ASSETS.fetch(request);
  const page = await env.ASSETS.fetch(new Request(new URL(holdingPath(request.headers.get('accept-language')), url)));
  const answer = new Response(page.body, { status: url.pathname === '/' ? 200 : 404, headers: page.headers });
  answer.headers.set('vary', 'accept-language');
  return answer;
}

async function route(request: Request, env: WebEnv): Promise<Response> {
  // An unnamed environment cannot know whether it needs a door, so it serves nothing.
  if (!ENVIRONMENTS.has(env.ENVIRONMENT_NAME)) return new Response('Service Unavailable', { status: 503 });
  if (env.ENVIRONMENT_NAME !== 'prod') {
    const refused = await requireDoorSecret(request, env.DOOR_SECRET);
    if (refused) return refused;
  }
  // Holding, nothing behind the page is reached, so no database is needed.
  if (env.HOLDING === 'true') return holding(request, env);
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
