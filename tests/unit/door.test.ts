import { describe, it, expect, vi, afterEach } from 'vitest';
import door from '../../workers/door/src/index.ts';
import { DOOR_SECRET_HEADER, forward, type DoorEnv } from '../../workers/door/src/door.ts';

/**
 * The front door (design 4.17, ShyTalk#28): a Worker in PROD's zone that passes
 * every request to its environment's workers.dev origin, adding the door
 * secret. The origin's fetch is stood in; the tests use a neutral host.
 */

const ENV: DoorEnv = { ORIGIN: 'https://origin.example.test', DOOR_SECRET: 'the-door-secret' };

type Send = (request: Request) => Promise<Response>;

/** A stand-in origin that records the one request it is sent. */
function recordingOrigin(response: Response = new Response('ok')): { send: Send; sent: () => Request } {
  const calls: Request[] = [];
  return {
    send: (request) => {
      calls.push(request);
      return Promise.resolve(response);
    },
    sent: () => {
      expect(calls).toHaveLength(1);
      return calls[0] as Request;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('door: passes requests through unchanged', () => {
  it('keeps the method, path, query, headers and body, sending them to the origin', async () => {
    const origin = recordingOrigin();
    const request = new Request('https://door.example.test/api/rooms/7?lang=id&page=2', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer abc', 'x-custom': 'kept' },
      body: '{"name":"Belajar"}',
    });

    await forward(request, ENV, origin.send);

    const sent = origin.sent();
    expect(sent.url).toBe('https://origin.example.test/api/rooms/7?lang=id&page=2');
    expect(sent.method).toBe('POST');
    expect(sent.headers.get('content-type')).toBe('application/json');
    expect(sent.headers.get('authorization')).toBe('Bearer abc');
    expect(sent.headers.get('x-custom')).toBe('kept');
    expect(await sent.text()).toBe('{"name":"Belajar"}');
  });

  it('keeps an encoded path as it is', async () => {
    const origin = recordingOrigin();
    await forward(new Request('https://door.example.test/a%20b/%E2%9C%93'), ENV, origin.send);
    expect(origin.sent().url).toBe('https://origin.example.test/a%20b/%E2%9C%93');
  });

  it.each(['//attacker.example/steal', '/\\attacker.example/steal', '/..//attacker.example/steal'])(
    'never leaves the origin host, even for the path %s',
    async (path) => {
      const origin = recordingOrigin();
      await forward(new Request(`https://door.example.test${path}`), ENV, origin.send);
      expect(new URL(origin.sent().url).host).toBe('origin.example.test');
    },
  );

  it('sends a GET without a body', async () => {
    const origin = recordingOrigin();
    await forward(new Request('https://door.example.test/'), ENV, origin.send);
    const sent = origin.sent();
    expect(sent.method).toBe('GET');
    expect(sent.body).toBeNull();
  });

  it('returns the origin response as it is, status, headers and body', async () => {
    const reply = new Response('created', { status: 201, headers: { 'x-origin': 'yes' } });
    const response = await forward(new Request('https://door.example.test/'), ENV, recordingOrigin(reply).send);
    expect(response).toBe(reply);
  });

  it('does not follow redirects: the 302 comes back to the caller', async () => {
    const origin = recordingOrigin(new Response(null, { status: 302, headers: { location: '/elsewhere' } }));
    const response = await forward(new Request('https://door.example.test/old'), ENV, origin.send);
    expect(origin.sent().redirect).toBe('manual');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/elsewhere');
  });

  it('keeps a WebSocket upgrade: Upgrade and Connection reach the origin, its response comes back as is', async () => {
    const switching = new Response(null, { status: 200, headers: { upgrade: 'websocket' } });
    const origin = recordingOrigin(switching);
    const response = await forward(
      new Request('https://door.example.test/rooms/7/live', {
        headers: { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
      }),
      ENV,
      origin.send,
    );
    const sent = origin.sent();
    expect(sent.headers.get('upgrade')).toBe('websocket');
    expect(sent.headers.get('connection')).toBe('Upgrade');
    expect(sent.headers.get('sec-websocket-key')).toBe('dGhlIHNhbXBsZSBub25jZQ==');
    expect(response).toBe(switching);
  });
});

describe('door: the door secret', () => {
  it('adds the door secret', async () => {
    const origin = recordingOrigin();
    await forward(new Request('https://door.example.test/'), ENV, origin.send);
    expect(origin.sent().headers.get(DOOR_SECRET_HEADER)).toBe('the-door-secret');
  });

  it("overwrites a caller's own copy of the door secret header", async () => {
    const origin = recordingOrigin();
    await forward(new Request('https://door.example.test/', { headers: { [DOOR_SECRET_HEADER]: 'forged' } }), ENV, origin.send);
    expect(origin.sent().headers.get(DOOR_SECRET_HEADER)).toBe('the-door-secret');
  });

  it('names the header x-shytalk-door-secret', () => {
    expect(DOOR_SECRET_HEADER).toBe('x-shytalk-door-secret');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
  ])('sends nothing and answers a plain 500 when its secret is %s', async (_case, secret) => {
    const send = vi.fn<Send>();
    const env = { ORIGIN: ENV.ORIGIN, DOOR_SECRET: secret } as unknown as DoorEnv;
    const response = await forward(new Request('https://door.example.test/'), env, send);
    expect(send).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Door not configured');
  });
});

describe('door: an unreachable origin', () => {
  it('answers a plain 502 when the origin cannot be reached', async () => {
    const response = await forward(new Request('https://door.example.test/'), ENV, () => Promise.reject(new TypeError('fetch failed')));
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('Bad Gateway');
  });
});

describe('door: the Worker entry', () => {
  it("sends through the runtime's fetch", async () => {
    const runtimeFetch = vi.fn<(request: Request) => Promise<Response>>(() => Promise.resolve(new Response('from origin')));
    vi.stubGlobal('fetch', runtimeFetch);

    const response = await door.fetch(new Request('https://door.example.test/x'), ENV);

    expect(runtimeFetch).toHaveBeenCalledTimes(1);
    expect(runtimeFetch.mock.calls[0]?.[0].url).toBe('https://origin.example.test/x');
    expect(await response.text()).toBe('from origin');
  });
});
