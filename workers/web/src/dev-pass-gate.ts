/**
 * The partner site's link into dev (shyden-labs/ShyTalk#263): a request on dev
 * carrying `?dev_pass=<token>`. A valid pass (../../../packages/environment/dev-pass.ts)
 * whose nonce is recorded here for the first time sets the site pass cookie
 * and sends the browser to the same address without the pass. Any other pass
 * gets the password box; once the box (or the cookie) is answered, the pass is
 * dropped from the address the same way, so typing the password never loops
 * back to a refused pass. Test and production read no pass.
 */
import { readDevPass } from '../../../packages/environment/dev-pass.ts';
import { SITE_PASS_COOKIE, SITE_PASS_SECONDS, requireSitePassword, sitePassCookie } from '../../../packages/environment/index.ts';

const PARAMETER = 'dev_pass';

interface Statement {
  bind(...values: unknown[]): unknown;
}

export interface DevPassEnv {
  ENVIRONMENT_NAME: 'prod' | 'test' | 'dev';
  SITE_ORIGIN?: string | undefined;
  SITE_PASSWORD?: string | undefined;
  DEV_PASS_SECRET?: string | undefined;
  DB?: { prepare(sql: string): Statement; batch(statements: unknown[]): Promise<{ meta: { changes: number } }[]> } | undefined;
}

/** Records `nonce` until `exp`, forgetting expired ones; whether it was new. A failure counts as used. */
async function firstUse(db: NonNullable<DevPassEnv['DB']>, nonce: string, exp: number, now: number): Promise<boolean> {
  try {
    const [, recorded] = await db.batch([
      db.prepare('DELETE FROM dev_pass_nonce WHERE exp < ?').bind(now),
      db.prepare('INSERT INTO dev_pass_nonce (nonce, exp) VALUES (?, ?) ON CONFLICT (nonce) DO NOTHING').bind(nonce, exp),
    ]);
    return recorded?.meta.changes === 1;
  } catch {
    return false;
  }
}

/** The cookie value a valid, first-used pass in `token` earns on this dev site, or null. */
async function earnedCookie(token: string, env: DevPassEnv, now: number): Promise<string | null> {
  const { SITE_ORIGIN, SITE_PASSWORD, DEV_PASS_SECRET, DB } = env;
  if (!SITE_ORIGIN || !SITE_PASSWORD || !DEV_PASS_SECRET || DB === undefined) return null;
  const pass = await readDevPass(token, DEV_PASS_SECRET, new URL(SITE_ORIGIN).host, now);
  if (pass === null || !(await firstUse(DB, pass.nonce, pass.exp, now))) return null;
  return sitePassCookie(SITE_PASSWORD, DEV_PASS_SECRET, now + SITE_PASS_SECONDS);
}

/** The answer to a request carrying a pass on dev, or null when the request carries none or this is not dev. `now` is in unix seconds. */
export async function devPassGate(request: Request, env: DevPassEnv, now: number): Promise<Response | null> {
  const url = new URL(request.url);
  const token = url.searchParams.get(PARAMETER);
  if (env.ENVIRONMENT_NAME !== 'dev' || token === null) return null;
  url.searchParams.delete(PARAMETER);
  // One leading slash only: two slashes, or a slash and a backslash, would send the browser to another site.
  const path = `/${url.pathname.replace(/^[/\\]+/, '')}`;
  const headers = new Headers({ location: `${path}${url.search}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  const value = await earnedCookie(token, env, now);
  if (value !== null) {
    headers.set('set-cookie', `${SITE_PASS_COOKIE}=${value}; Path=/; Max-Age=${SITE_PASS_SECONDS}; Secure; HttpOnly; SameSite=Lax`);
    return new Response(null, { status: 302, headers });
  }
  const asked = await requireSitePassword(request, env.SITE_PASSWORD, `ShyTalk ${env.ENVIRONMENT_NAME}`, { key: env.DEV_PASS_SECRET, now });
  return asked ?? new Response(null, { status: 302, headers });
}
