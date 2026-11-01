/**
 * The site's Worker (plan 3 Task 1, shyden-labs/ShyTalk#51; design 4.17).
 * PROD answers shytalk.app; TEST and DEV are the workers.dev origins behind
 * their doors, so there every request needs the door secret
 * (packages/environment). `/api/*` goes to the API; everything else to the
 * built pages (Workers static assets, Astro's output). Every answer carries
 * the security headers.
 *
 * It checks no environment marker yet: it has no store to mark until plan 3
 * Task 5 brings D1 (decision 215's reasoning).
 */
import { requireDoorSecret } from '../../../packages/environment/index.ts';

/** Everything comes from this site: no inline script or style, no `data:`, no frames. */
export const CONTENT_SECURITY_POLICY = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'";

export interface WebEnv {
  /** Which environment this Worker is (a var): only TEST and DEV sit behind a door. */
  ENVIRONMENT_NAME: 'prod' | 'test' | 'dev';
  /** The environment's door secret (a Wrangler secret, TEST and DEV only). */
  DOOR_SECRET?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const ENVIRONMENTS = new Set(['prod', 'test', 'dev']);

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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
  if (new URL(request.url).pathname.startsWith('/api/')) return handleApi();
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

export default {
  fetch: (request: Request, env: WebEnv): Promise<Response> => handle(request, env),
};
