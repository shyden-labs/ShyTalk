/**
 * The app's API (plan 4 Task 1, shyden-labs/ShyTalk#74): every path under
 * `/api/app/`, reached after the site's door and environment-marker checks.
 * Later tasks add sign-in, the version floor and the UI document here.
 */
import { json } from '../http.ts';
import type { WebEnv } from '../web.ts';

export const APP_API_PREFIX = '/api/app/';

/** Whether `pathname` belongs to the app's API: `/api/app` itself or anything under it. */
export const isAppApi = (pathname: string): boolean => pathname === '/api/app' || pathname.startsWith(APP_API_PREFIX);

export function handleAppApi(request: Request, env: WebEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === `${APP_API_PREFIX}health`) {
    if (request.method !== 'GET') return Promise.resolve(new Response(null, { status: 405, headers: { allow: 'GET' } }));
    return Promise.resolve(json(200, { ok: true, environment: env.ENVIRONMENT_NAME }));
  }
  return Promise.resolve(json(404, { error: 'not_found' }));
}
