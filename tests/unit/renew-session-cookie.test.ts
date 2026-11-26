import { describe, expect, it } from 'vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuth, SESSION_COOKIE_SECONDS } from '../../workers/web/src/auth/better-auth.ts';
import { sessionCookie } from '../../workers/web/src/app/code-sign-in.ts';
import { renewSessionCookie } from '../../workers/web/src/app/renew-session-cookie.ts';
import { json } from '../../workers/web/src/http.ts';
import type { SignInEnv } from '../../workers/web/src/app/sign-in.ts';

/**
 * The website's session cookie is renewed on use (shyden-labs/ShyTalk#184; Shyden 2026-11-13, "Re-set on use"):
 * the cookie lives 400 days, the browser's ceiling, while the session row lasts until ended, so each signed-in
 * request answered by the website sets the cookie again for a fresh 400 days. Better Auth runs on its memory adapter.
 */

function world() {
  const store: Record<string, Record<string, unknown>[]> = {
    user: [{ id: 'u-1', name: 'Member', email: 'm@example.test', emailVerified: true, createdAt: new Date(), updatedAt: new Date() }],
    session: [],
    account: [],
    verification: [],
  };
  const env = {
    ENVIRONMENT_NAME: 'dev',
    SITE_ORIGIN: 'https://site.example.test',
    BETTER_AUTH_SECRET: 'a-test-secret-that-is-long-enough-for-better-auth',
    GOOGLE_CLIENT_IDS: 'g',
    APPLE_AUDIENCES: 'a',
  } as unknown as SignInEnv;
  const auth = createAuth(env, {
    database: memoryAdapter(store),
    googleKeys: () => Promise.reject(new Error('unused')),
    appleKeys: () => Promise.reject(new Error('unused')),
  });
  return { auth, store };
}

/** A live session's cookie pair (`name=value`), as the browser sends it back. */
async function signedIn(w: ReturnType<typeof world>): Promise<{ pair: string; name: string; token: string }> {
  const session = await (await w.auth.$context).internalAdapter.createSession('u-1');
  const [pair = ''] = (await sessionCookie(w.auth, session.token)).split(';');
  const [name = ''] = pair.split('=');
  return { pair, name, token: session.token };
}

const request = (cookie?: string): Request =>
  new Request('https://site.example.test/api/app/sign-in-methods', cookie === undefined ? {} : { headers: { cookie } });

const sessionCookies = (response: Response, name: string): string[] =>
  response.headers.getSetCookie().filter((cookie) => cookie.startsWith(`${name}=`));

// The first session cookie in a process pays one-off warm-up (Better Auth's context, the signing key's import);
// paid once here at module load, in a world of its own, so no test body pays it (shyden-labs/ShyTalk#328).
await signedIn(world());

describe('renewSessionCookie', () => {
  it('re-sets the session cookie of a signed-in request with a fresh 400-day life, keeping the answer', async () => {
    const w = world();
    const { pair, name } = await signedIn(w);
    const renewed = await renewSessionCookie(request(`other=1; ${pair}`), json(200, { methods: [] }), w.auth);
    expect(renewed.status).toBe(200);
    expect(await renewed.json()).toEqual({ methods: [] });
    const [cookie = '', ...more] = sessionCookies(renewed, name);
    expect(more).toEqual([]);
    expect(cookie).toContain(`Max-Age=${String(SESSION_COOKIE_SECONDS)}`);
    expect(SESSION_COOKIE_SECONDS).toBe(400 * 86_400);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
  });

  it('renews a cookie the browser keeps using: the new cookie still finds the same session', async () => {
    const w = world();
    const { pair, name } = await signedIn(w);
    const renewed = await renewSessionCookie(request(pair), json(200, {}), w.auth);
    const [newPair = ''] = (sessionCookies(renewed, name)[0] ?? '').split(';');
    const found = await w.auth.api.getSession({ headers: new Headers({ cookie: newPair }) });
    expect(found?.user.id).toBe('u-1');
  });

  it('sets no cookie on a request with no cookie at all', async () => {
    const w = world();
    const renewed = await renewSessionCookie(request(), json(200, {}), w.auth);
    expect(renewed.headers.getSetCookie()).toEqual([]);
  });

  it('sets no cookie on a request whose cookies are not the session cookie', async () => {
    const w = world();
    const renewed = await renewSessionCookie(request('theme=dark; other=1'), json(200, {}), w.auth);
    expect(renewed.headers.getSetCookie()).toEqual([]);
  });

  it("sets no cookie on the app's request, signed in by its bearer token, even beside other cookies", async () => {
    const w = world();
    const { token } = await signedIn(w);
    const app = new Request('https://site.example.test/api/app/sign-in-methods', {
      headers: { authorization: `Bearer ${token}`, cookie: 'theme=dark' },
    });
    expect((await w.auth.api.getSession({ headers: app.headers }))?.user.id).toBe('u-1');
    const renewed = await renewSessionCookie(app, json(200, {}), w.auth);
    expect(renewed.headers.getSetCookie()).toEqual([]);
  });

  it('sets no cookie when the session cookie is forged', async () => {
    const w = world();
    const { name, token } = await signedIn(w);
    const renewed = await renewSessionCookie(request(`${name}=${token}.forged`), json(200, {}), w.auth);
    expect(renewed.headers.getSetCookie()).toEqual([]);
  });

  it('sets no cookie when the session has ended', async () => {
    const w = world();
    const { pair, token } = await signedIn(w);
    await (await w.auth.$context).internalAdapter.deleteSession(token);
    const renewed = await renewSessionCookie(request(pair), json(401, { error: 'signed_out' }), w.auth);
    expect(renewed.status).toBe(401);
    expect(renewed.headers.getSetCookie()).toEqual([]);
  });

  it('leaves an answer that sets the session cookie itself (a sign-in or sign-out) as it is', async () => {
    const w = world();
    const { pair, name } = await signedIn(w);
    const answer = json(200, {});
    answer.headers.append('set-cookie', `${name}=; Max-Age=0; Path=/`);
    const renewed = await renewSessionCookie(request(pair), answer, w.auth);
    expect(renewed.headers.getSetCookie()).toEqual([`${name}=; Max-Age=0; Path=/`]);
  });

  it('leaves a WebSocket upgrade as it is', async () => {
    const w = world();
    const { pair } = await signedIn(w);
    // A Worker answers an upgrade with a real 101 Response; Node's own Response refuses 101 in its constructor, so a
    // real one is made and given the upgrade's status.
    const upgrade = Object.defineProperty(new Response(null), 'status', { value: 101 });
    expect(await renewSessionCookie(request(pair), upgrade, w.auth)).toBe(upgrade);
  });
});
