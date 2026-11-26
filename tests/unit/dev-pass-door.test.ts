import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { webcrypto } from 'node:crypto';
import { handleDevDoor, PASS_COOKIE, PASS_HEADER, SIGNIN_ORIGIN, SUB_HEADER, type DoorEnv } from '../../workers/door/src/dev-pass/door.ts';
import { mintPass, type PassKind, type SigningKey } from '../../workers/door/src/dev-pass/pass.ts';

/**
 * Each product's `dev.` door (shyden-labs/repo-template#207, spec §4): nothing
 * reaches the origin without a valid DEV pass, and the origin never sees one.
 * The origin is a mock, so its call count proves what got through.
 */

const HOST = 'dev.yaweloidle.com';
const NOW = 1_800_000_000;
const SECRET_HEADER = 'X-Door-Secret';
const SECRET = 'origin-door-secret';

let key: SigningKey;
let env: DoorEnv;
const forward = vi.fn<(request: Request) => Promise<Response>>();

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
  key = { kid: 'k1', privateKey: pair.privateKey };
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  env = { host: HOST, keys: { k1: jwk.x ?? '' }, secretHeader: SECRET_HEADER, secret: SECRET, now: NOW };
});

beforeEach(() => {
  forward.mockReset();
  forward.mockResolvedValue(new Response('origin page', { status: 200 }));
});

const pass = (aud = HOST, kind: PassKind = 'browser', now = NOW) => mintPass({ aud, sub: 'shyden@example.com', kind }, key, now);
const url = (path: string) => `https://${HOST}${path}`;
const door = (request: Request) => handleDevDoor(request, env, forward);
const html = { accept: 'text/html,application/xhtml+xml' };

function accept(body: string, headers: Record<string, string> = {}): Request {
  return new Request(url('/__devpass/accept'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: SIGNIN_ORIGIN, ...headers },
    body,
  });
}

function forwarded(): Request {
  expect(forward).toHaveBeenCalledTimes(1);
  const request = forward.mock.calls[0]?.[0];
  if (request === undefined) throw new Error('forward got no request');
  return request;
}

async function expectRefusal(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  expect(await response.text()).toBe('');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(forward).not.toHaveBeenCalled();
}

describe('accepting a pass', () => {
  it('sets the pass cookie until the pass expires and sends the person back', async () => {
    const response = await door(accept(new URLSearchParams({ pass: await pass(), back: '/rooms/7?tab=chat' }).toString()));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/rooms/7?tab=chat');
    expect(response.headers.get('set-cookie')).toBe(
      `${PASS_COOKIE}=${await pass()}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(forward).not.toHaveBeenCalled();
  });

  it('sets Max-Age to the seconds the pass has left', async () => {
    const response = await door(accept(new URLSearchParams({ pass: await pass(HOST, 'browser', NOW - 43_000) }).toString()));
    expect(response.headers.get('set-cookie')).toMatch(/; Max-Age=200$/);
  });

  it('sends the person to the root when back is missing', async () => {
    const response = await door(accept(new URLSearchParams({ pass: await pass() }).toString()));
    expect(response.headers.get('location')).toBe('/');
  });

  it('sends the person to the root when back names another site', async () => {
    const response = await door(accept(new URLSearchParams({ pass: await pass(), back: '//evil.example/' }).toString()));
    expect(response.headers.get('location')).toBe('/');
  });

  it('refuses a pass for another door with an empty 401 and no cookie', async () => {
    const response = await door(accept(new URLSearchParams({ pass: await pass('dev.shytalk.com') }).toString()));
    expect(response.headers.get('set-cookie')).toBeNull();
    await expectRefusal(response);
  });

  it('refuses a good pass posted with no Origin with 403, so another site cannot sign someone in', async () => {
    const request = new Request(url('/__devpass/accept'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ pass: await pass() }).toString(),
    });
    const response = await door(request);
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a good pass posted from another site with 403', async () => {
    const response = await door(accept(new URLSearchParams({ pass: await pass() }).toString(), { origin: 'https://evil.example' }));
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a good pass posted with Origin null with 403', async () => {
    const response = await door(accept(new URLSearchParams({ pass: await pass() }).toString(), { origin: 'null' }));
    expect(response.status).toBe(403);
  });

  it('refuses a form with no pass field', async () => {
    await expectRefusal(await door(accept('back=%2F')));
  });

  it('refuses a body over 4 KiB with 413', async () => {
    const response = await door(accept(`pass=${'a'.repeat(4_092)}`));
    expect(response.status).toBe(413);
    expect(forward).not.toHaveBeenCalled();
  });

  it('refuses a declared length over 4 KiB with 413 without reading the body', async () => {
    const unread = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('the body was read');
      },
    });
    const request = new Request(url('/__devpass/accept'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '4097', origin: SIGNIN_ORIGIN },
      body: unread,
      duplex: 'half',
    });
    expect((await door(request)).status).toBe(413);
  });

  it('reads a body of exactly 4 KiB', async () => {
    const response = await door(accept(`pass=${'a'.repeat(4_091)}`));
    expect(response.status).toBe(401);
  });

  it('counts the body in bytes, not characters', async () => {
    const response = await door(accept(`pass=${'é'.repeat(2_046)}`));
    expect(response.status).toBe(413);
  });

  it('refuses an accept with no content type with 415', async () => {
    const response = await door(new Request(url('/__devpass/accept'), { method: 'POST', headers: { origin: SIGNIN_ORIGIN } }));
    expect(response.status).toBe(415);
    expect(forward).not.toHaveBeenCalled();
  });

  it('refuses a content type that only starts like a urlencoded form with 415', async () => {
    const response = await door(
      accept(new URLSearchParams({ pass: await pass() }).toString(), { 'content-type': 'application/x-www-form-urlencodedx' }),
    );
    expect(response.status).toBe(415);
  });

  it('refuses a body that is not a urlencoded form with 415', async () => {
    const response = await door(
      accept(new URLSearchParams({ pass: await pass() }).toString(), { 'content-type': 'multipart/form-data; boundary=x' }),
    );
    expect(response.status).toBe(415);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(forward).not.toHaveBeenCalled();
  });

  it('accepts a urlencoded form whose content type names a charset', async () => {
    const response = await door(
      accept(new URLSearchParams({ pass: await pass() }).toString(), {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      }),
    );
    expect(response.status).toBe(303);
  });

  it('refuses any other method on the accept path with 405', async () => {
    const response = await door(new Request(url('/__devpass/accept'), { headers: html }));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(forward).not.toHaveBeenCalled();
  });
});

describe('signing out', () => {
  it('clears the cookie and sends the person to the sign-in signout', async () => {
    const response = await door(new Request(url('/__devpass/signout')));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SIGNIN_ORIGIN}/signout`);
    expect(response.headers.get('set-cookie')).toBe(`${PASS_COOKIE}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    expect(forward).not.toHaveBeenCalled();
  });
});

describe('a request with no valid pass', () => {
  it('sends a page request to the sign-in, naming this door and the way back', async () => {
    const response = await door(new Request(url('/rooms/7?tab=chat'), { headers: html }));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${SIGNIN_ORIGIN}/pass?for=${HOST}&back=%2Frooms%2F7%3Ftab%3Dchat`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(forward).not.toHaveBeenCalled();
  });

  it('refuses an API request with an empty 401', async () => {
    await expectRefusal(await door(new Request(url('/api/me'), { headers: { accept: 'application/json' } })));
  });

  it('refuses a request with no Accept header with an empty 401', async () => {
    await expectRefusal(await door(new Request(url('/'))));
  });

  it('refuses a WebSocket upgrade with an empty 401 even when it asks for HTML', async () => {
    await expectRefusal(await door(new Request(url('/socket'), { headers: { ...html, upgrade: 'websocket' } })));
  });

  it('refuses a POST asking for HTML with an empty 401', async () => {
    await expectRefusal(await door(new Request(url('/form'), { method: 'POST', headers: html, body: 'x=1' })));
  });

  it('refuses a cookie holding a pass for another door', async () => {
    await expectRefusal(
      await door(new Request(url('/api/me'), { headers: { cookie: `${PASS_COOKIE}=${await pass('dev.shytalk.com')}` } })),
    );
  });

  it('refuses an expired header pass', async () => {
    await expectRefusal(await door(new Request(url('/api/me'), { headers: { [PASS_HEADER]: await pass(HOST, 'machine', NOW - 3_600) } })));
  });

  it('lets the header win over the cookie, even when the cookie is good', async () => {
    const headers = { [PASS_HEADER]: await pass('dev.shytalk.com'), cookie: `${PASS_COOKIE}=${await pass()}` };
    await expectRefusal(await door(new Request(url('/api/me'), { headers })));
  });
});

describe('a request with a valid pass', () => {
  it('forwards a cookie pass to the origin and returns its answer', async () => {
    const response = await door(new Request(url('/rooms/7?tab=chat'), { headers: { ...html, cookie: `${PASS_COOKIE}=${await pass()}` } }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('origin page');
    expect(forwarded().url).toBe(url('/rooms/7?tab=chat'));
  });

  it('forwards a header pass, with the door secret and the subject, and no pass', async () => {
    await door(new Request(url('/api/me'), { headers: { [PASS_HEADER]: await pass(HOST, 'app') } }));
    const request = forwarded();
    expect(request.headers.get(SECRET_HEADER)).toBe(SECRET);
    expect(request.headers.get(SUB_HEADER)).toBe('shyden@example.com');
    expect(request.headers.get(PASS_HEADER)).toBeNull();
  });

  it('replaces a door secret or subject the caller sent', async () => {
    await door(
      new Request(url('/api/me'), { headers: { [PASS_HEADER]: await pass(), [SECRET_HEADER]: 'guess', [SUB_HEADER]: 'someone-else' } }),
    );
    const request = forwarded();
    expect(request.headers.get(SECRET_HEADER)).toBe(SECRET);
    expect(request.headers.get(SUB_HEADER)).toBe('shyden@example.com');
  });

  it('strips only the pass from the cookies it forwards', async () => {
    await door(new Request(url('/'), { headers: { cookie: `theme=dark; ${PASS_COOKIE}=${await pass()};session=abc` } }));
    expect(forwarded().headers.get('cookie')).toBe('theme=dark; session=abc');
  });

  it('drops the Cookie header when the pass was its only cookie', async () => {
    await door(new Request(url('/'), { headers: { cookie: `${PASS_COOKIE}=${await pass()}` } }));
    expect(forwarded().headers.get('cookie')).toBeNull();
  });

  it('drops the Cookie header when only the pass and empty entries were in it', async () => {
    await door(new Request(url('/'), { headers: { cookie: `${PASS_COOKIE}=${await pass()}; ;` } }));
    expect(forwarded().headers.get('cookie')).toBeNull();
  });

  it('strips a stale pass cookie when a header pass opened the door', async () => {
    await door(new Request(url('/'), { headers: { [PASS_HEADER]: await pass(), cookie: `${PASS_COOKIE}=old; theme=dark` } }));
    expect(forwarded().headers.get('cookie')).toBe('theme=dark');
  });

  it('keeps a cookie whose name only starts with the pass cookie name', async () => {
    await door(new Request(url('/'), { headers: { [PASS_HEADER]: await pass(), cookie: `${PASS_COOKIE}2=keep` } }));
    expect(forwarded().headers.get('cookie')).toBe(`${PASS_COOKIE}2=keep`);
  });

  it('forwards the method and body', async () => {
    await door(new Request(url('/api/rooms'), { method: 'POST', headers: { [PASS_HEADER]: await pass() }, body: '{"name":"a"}' }));
    const request = forwarded();
    expect(request.method).toBe('POST');
    expect(await request.text()).toBe('{"name":"a"}');
  });
});

describe('getting an embed pass for page code', () => {
  const API_HOST = 'dev-api.shydesk.example';
  const signin = vi.fn<(request: Request) => Promise<Response>>();
  const embedDoor = (request: Request) => handleDevDoor(request, { ...env, signin }, forward);
  const ask = async (options: { origin?: string | null; method?: string; cookie?: string | null; for?: string | null } = {}) => {
    const headers = new Headers();
    const origin = options.origin === undefined ? `https://${HOST}` : options.origin;
    if (origin !== null) headers.set('origin', origin);
    const cookie = options.cookie === undefined ? `${PASS_COOKIE}=${await pass()}` : options.cookie;
    if (cookie !== null) headers.set('cookie', cookie);
    const target = options.for === undefined ? API_HOST : options.for;
    const search = target === null ? '' : `?${new URLSearchParams({ for: target }).toString()}`;
    return embedDoor(new Request(url(`/__devpass/embed${search}`), { method: options.method ?? 'POST', headers }));
  };

  beforeEach(() => {
    signin.mockReset();
    signin.mockResolvedValue(new Response('{"pass":"embed-pass"}', { status: 200, headers: { 'content-type': 'application/json' } }));
  });

  function signinCall(): Request {
    expect(signin).toHaveBeenCalledTimes(1);
    const request = signin.mock.calls[0]?.[0];
    if (request === undefined) throw new Error('signin got no request');
    return request;
  }

  it("swaps the visitor's pass at the sign-in and hands the embed pass to the page, uncached", async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"pass":"embed-pass"}');
    const request = signinCall();
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`${SIGNIN_ORIGIN}/embed`);
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(await request.text()))).toEqual({ pass: await pass(), for: API_HOST });
    expect(forward).not.toHaveBeenCalled();
  });

  it('refuses another site with 403, before asking the sign-in', async () => {
    expect((await ask({ origin: 'https://evil.example' })).status).toBe(403);
    expect(signin).not.toHaveBeenCalled();
  });

  it('refuses a call with no Origin with 403', async () => {
    expect((await ask({ origin: null })).status).toBe(403);
    expect(signin).not.toHaveBeenCalled();
  });

  it('refuses a GET with 405', async () => {
    const response = await ask({ method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(signin).not.toHaveBeenCalled();
  });

  it('refuses a visitor with no pass with 401', async () => {
    expect((await ask({ cookie: null })).status).toBe(401);
    expect(signin).not.toHaveBeenCalled();
  });

  it('refuses a pass for another door with 401', async () => {
    expect((await ask({ cookie: `${PASS_COOKIE}=${await pass('dev.shytalk.com')}` })).status).toBe(401);
    expect(signin).not.toHaveBeenCalled();
  });

  it('refuses a call naming no audience with 400', async () => {
    expect((await ask({ for: null })).status).toBe(400);
    expect(signin).not.toHaveBeenCalled();
  });

  it("passes on the sign-in's refusal with no body", async () => {
    signin.mockResolvedValue(new Response('nope', { status: 401 }));
    const response = await ask();
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('is not found on a door with no sign-in to ask, and is never forwarded', async () => {
    const response = await door(
      new Request(url(`/__devpass/embed?for=${API_HOST}`), {
        method: 'POST',
        headers: { origin: `https://${HOST}`, cookie: `${PASS_COOKIE}=${await pass()}` },
      }),
    );
    expect(response.status).toBe(404);
    expect(forward).not.toHaveBeenCalled();
  });
});

describe("an embed's API door", () => {
  const API_HOST = 'dev-api.shydesk.example';
  const PAGE = `https://${HOST}`;
  const apiDoor = (request: Request, embedOrigins: readonly string[] | null = [PAGE]) =>
    handleDevDoor(request, embedOrigins === null ? { ...env, host: API_HOST } : { ...env, host: API_HOST, embedOrigins }, forward);
  const apiUrl = (path: string) => `https://${API_HOST}${path}`;
  const apiPass = () => mintPass({ aud: API_HOST, sub: 'shyden@example.com', kind: 'embed' }, key, NOW);
  const preflight = (origin: string) =>
    new Request(apiUrl('/tickets'), {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-dev-pass, content-type' },
    });

  it('answers a preflight from a listed page itself, allowing the pass header', async () => {
    const response = await apiDoor(preflight(PAGE));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(PAGE);
    expect(response.headers.get('access-control-allow-headers')).toBe('X-Dev-Pass, Content-Type');
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, PUT, PATCH, DELETE');
    expect(response.headers.get('access-control-max-age')).toBe('600');
    expect(response.headers.get('vary')).toBe('Origin');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(forward).not.toHaveBeenCalled();
  });

  it('refuses a preflight from a page not listed with 403 and no CORS headers', async () => {
    const response = await apiDoor(preflight('https://evil.example'));
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(forward).not.toHaveBeenCalled();
  });

  it('keeps refusing a preflight on a door with no embed pages', async () => {
    const response = await apiDoor(preflight(PAGE), null);
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it("forwards a listed page's call carrying an embed pass, and lets the page read the answer", async () => {
    forward.mockResolvedValue(new Response('{"id":1}', { status: 201, headers: { 'content-type': 'application/json' } }));
    const response = await apiDoor(
      new Request(apiUrl('/tickets'), { method: 'POST', headers: { origin: PAGE, [PASS_HEADER]: await apiPass() }, body: '{}' }),
    );
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('{"id":1}');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('access-control-allow-origin')).toBe(PAGE);
    expect(response.headers.get('vary')).toBe('Origin');
    expect(forwarded().headers.get(PASS_HEADER)).toBeNull();
  });

  it("refuses a listed page's call with no pass with 401 the page can read", async () => {
    const response = await apiDoor(new Request(apiUrl('/tickets'), { method: 'POST', headers: { origin: PAGE }, body: '{}' }));
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBe(PAGE);
    expect(forward).not.toHaveBeenCalled();
  });

  it('refuses an embed pass made for another door', async () => {
    const response = await apiDoor(
      new Request(apiUrl('/tickets'), { headers: { origin: PAGE, [PASS_HEADER]: await pass(HOST, 'embed') } }),
    );
    expect(response.status).toBe(401);
    expect(forward).not.toHaveBeenCalled();
  });

  it('gives no CORS headers to a page not listed', async () => {
    const response = await apiDoor(
      new Request(apiUrl('/tickets'), { headers: { origin: 'https://evil.example', [PASS_HEADER]: await apiPass() } }),
    );
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
