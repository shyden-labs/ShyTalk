/**
 * The site's Worker (plan 3 Task 1, shyden-labs/ShyTalk#51; design 4.17).
 * PROD answers shytalk.app; TEST and DEV are the workers.dev origins behind
 * their doors, so there every request needs the door secret
 * (packages/environment) and then the site password (shyden-labs/ShyTalk#262). `/api/*` goes to the API; everything else to the
 * built pages (Workers static assets, Astro's output). Every answer carries
 * the security headers. After the door, every request checks that `DB` names
 * this environment (plan 4 Task 2, shyden-labs/ShyTalk#75), PROD included, so
 * no Worker serves from another environment's database.
 */
import { createMarkerGuard, requireDoorSecret, requireSitePassword, type D1Like } from '../../../packages/environment/index.ts';
import { handleClosedTesting, isClosedTesting, type ClosedTestingEnv } from './api/closed-testing.ts';
import { handleAppApi, isAppApi } from './app/router.ts';
import { devPassGate } from './dev-pass-gate.ts';
import { json } from './http.ts';
import { SHYDESK_CALLBACK_PATH, handleShyDeskCallback, type ShyDeskCallbackEnv } from './moderation/callback-route.ts';
import type { RateLimit } from './app/sign-in.ts';
import type { AnnouncerNamespace } from './app/announcer.ts';
import { HOOK_PATH, handleGithubHook, type HookEnv } from './roadmap/hook-route.ts';
import { handleRoadmapApi, isRoadmapApi } from './roadmap/routes.ts';

/** Everything comes from this site: no inline script or style, no `data:`, no frames. */
export const CONTENT_SECURITY_POLICY = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'";

/** Where ShyDesk's support piece runs its human check: Cloudflare Turnstile. */
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/**
 * The support page in every language, its one ticket page and the appeal page, the only pages that embed ShyDesk
 * (shyden-labs/ShyTalk#37, #310).
 */
const SUPPORT_PATH = /^\/(?:(?:id|th|vi|zh)\/)?(?:support(?:\/ticket|\/)?|appeal)$/u;

/**
 * The support pages' policy: the site's own plus only what ShyDesk's piece needs, its scripts and API on the
 * environment's ShyDesk, Turnstile, and `blob:` previews of the photos and videos a member attaches. Inline styles
 * are allowed until the piece adopts its style sheets (shyden-labs/shydesk#266).
 */
export function supportPolicy(shydeskOrigin: string): string {
  const extra = [
    `script-src 'self' ${shydeskOrigin} ${TURNSTILE_ORIGIN}`,
    `connect-src 'self' ${shydeskOrigin}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "img-src 'self' blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
  ];
  return [CONTENT_SECURITY_POLICY, ...extra].join('; ');
}

/** The policy for a path: the support policy on the support pages of a Worker that names its ShyDesk, else the site's. */
function policyFor(pathname: string, shydeskOrigin: string | undefined): string {
  return shydeskOrigin !== undefined && SUPPORT_PATH.test(pathname) ? supportPolicy(shydeskOrigin) : CONTENT_SECURITY_POLICY;
}

export interface WebEnv extends HookEnv {
  /** Which environment this Worker is (a var): only TEST and DEV sit behind a door. */
  ENVIRONMENT_NAME: 'prod' | 'test' | 'dev';
  /** The environment's door secret (a Wrangler secret, TEST and DEV only). */
  DOOR_SECRET?: string;
  /** The site password the browser's box asks for (a Wrangler secret, TEST and DEV only; shyden-labs/ShyTalk#262). */
  SITE_PASSWORD?: string;
  /** The key the partner site signs dev passes with (a Wrangler secret, DEV only; shyden-labs/ShyTalk#263). */
  DEV_PASS_SECRET?: string;
  /** The secret ShyDesk signs punishment deliveries with (a Wrangler secret; shyden-labs/ShyTalk#310). */
  SHYDESK_CALLBACK_SECRET?: string;
  /** The ShyDesk whose support piece this environment's support pages embed (a var; shyden-labs/ShyTalk#37). */
  SHYDESK_ORIGIN?: string;
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

/**
 * Which holding page answers `pathname` (shyden-labs/ShyTalk#273): the home in the visitor's language, each
 * language's home (`/en/`, `/id/` and the rest, with or without the slash) in that language whatever the header asks,
 * so the page's language switch works; every other address the visitor's language as a 404.
 */
export function holdingAnswer(pathname: string, languages: string | null): { page: string; status: 200 | 404 } {
  const home = /^\/([a-z]+)\/?$/.exec(pathname)?.[1];
  if (home === 'en') return { page: '/holding', status: 200 };
  if (home !== undefined && HOLDING_LANGUAGES.includes(home)) return { page: `/${home}/holding`, status: 200 };
  return { page: holdingPath(languages), status: pathname === '/' ? 200 : 404 };
}

/**
 * The legal pages, which answer while production holds (shyden-labs/ShyTalk#317, Shyden 2026-11-22): in English and
 * Indonesian, the only languages they are written in, as ShyDesk's support form links to them.
 */
const HOLDING_LEGAL = /^\/(?:id\/)?(?:privacy|terms|guidelines)\/?$/u;

/** What the holding page itself loads, served as built: its stylesheet, icons, fonts and link-preview picture. */
const HOLDING_ASSETS = ['/styles/', '/previews/', '/icons/', '/_astro/'];

/**
 * Production while it holds: the www address sends the visitor to the bare one; its homes answer the holding page
 * (holdingAnswer); what the page loads, the legal pages and the support pages are served; every other address answers the holding page
 * as a 404.
 */
async function holding(request: Request, env: WebEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname.startsWith('www.')) {
    url.hostname = url.hostname.slice('www.'.length);
    return Response.redirect(url.toString(), 301);
  }
  if (HOLDING_ASSETS.some((prefix) => url.pathname.startsWith(prefix))) return env.ASSETS.fetch(request);
  if (HOLDING_LEGAL.test(url.pathname)) return env.ASSETS.fetch(request);
  // The support and appeal pages answer too, so a request or an appeal can still be sent (shyden-labs/ShyTalk#322).
  if (SUPPORT_PATH.test(url.pathname)) return env.ASSETS.fetch(request);
  const { page: path, status } = holdingAnswer(url.pathname, request.headers.get('accept-language'));
  const page = await env.ASSETS.fetch(new Request(new URL(path, url)));
  const answer = new Response(page.body, { status, headers: page.headers });
  answer.headers.set('vary', 'accept-language');
  return answer;
}

/**
 * ShyDesk's punishment callback (shyden-labs/ShyTalk#310): a server with no password or DEV pass, so it is reached
 * before them, holding included; it still needs this environment's own database, as every other address does.
 */
async function shydeskCallback(request: Request, env: WebEnv): Promise<Response> {
  if (!hasFullD1(env)) return new Response('Service Unavailable', { status: 503 });
  const wrongStore = await markerGuard(env.ENVIRONMENT_NAME, env.DB).assertEnvironmentMarkers();
  if (wrongStore) return wrongStore;
  // The Worker's D1 binding answers every batch with its rows, which ClosedTestingEnv's narrower type leaves out.
  return handleShyDeskCallback(request, { ...env, DB: env.DB as unknown as ShyDeskCallbackEnv['DB'] });
}

async function route(request: Request, env: WebEnv): Promise<Response> {
  // An unnamed environment cannot know whether it needs a door, so it serves nothing.
  if (!ENVIRONMENTS.has(env.ENVIRONMENT_NAME)) return new Response('Service Unavailable', { status: 503 });
  if (env.ENVIRONMENT_NAME !== 'prod') {
    const refused = await requireDoorSecret(request, env.DOOR_SECRET);
    if (refused) return refused;
  }
  // The webhook comes from GitHub, which has no password or DEV pass to give; its signature guards it (shyden-labs/ShyTalk#321).
  if (new URL(request.url).pathname === HOOK_PATH) return handleGithubHook(request, env);
  if (new URL(request.url).pathname === SHYDESK_CALLBACK_PATH) return shydeskCallback(request, env);
  if (env.ENVIRONMENT_NAME !== 'prod') {
    const now = Math.floor(Date.now() / 1000);
    const passed = await devPassGate(request, { ...env, DB: hasFullD1(env) ? env.DB : undefined }, now);
    if (passed) return passed;
    const pass = env.ENVIRONMENT_NAME === 'dev' ? { key: env.DEV_PASS_SECRET, now } : undefined;
    const asked = await requireSitePassword(request, env.SITE_PASSWORD, `ShyTalk ${env.ENVIRONMENT_NAME}`, pass);
    if (asked) return asked;
  }
  // Holding, nothing behind the page is reached, so no database is needed.
  if (env.HOLDING === 'true') return holding(request, env);
  // A Worker deployed without its database cannot prove whose data it serves.
  if (!env.DB) return new Response('Service Unavailable', { status: 503 });
  const wrongStore = await markerGuard(env.ENVIRONMENT_NAME, env.DB).assertEnvironmentMarkers();
  if (wrongStore) return wrongStore;
  const { pathname } = new URL(request.url);
  if (isRoadmapApi(pathname)) return handleRoadmapApi(request, env);
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
  response.headers.set('content-security-policy', policyFor(new URL(request.url).pathname, env.SHYDESK_ORIGIN));
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  return response;
}
