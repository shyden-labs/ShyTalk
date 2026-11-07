import { describe, it, expect } from 'vitest';
import {
  Announcer,
  announce,
  UI_VERSION_HEADER,
  type AnnouncerRuntime,
  type AnnouncerState,
  type LiveSocket,
} from '../../workers/web/src/app/announcer.ts';
import { handle, type WebEnv } from '../../workers/web/src/web.ts';
import { DOOR_SECRET_HEADER } from '../../packages/environment/index.ts';

/**
 * The live announcement (plan 4 Task 8, shyden-labs/ShyTalk#81): one
 * hibernating Durable Object holds every app's socket and sends each one
 * `{"type":"ui","version":N}` when a version is published. The runtime's own
 * hibernation (sockets kept while the object sleeps, closed ones dropped) is
 * checked in CI's integration suite; here the object is a plain class over
 * stood-in state.
 */

/** A stood-in socket: records what is sent to it, and any listener added (the hibernation API adds none). */
class FakeSocket implements LiveSocket {
  sent: string[] = [];
  closed: [number | undefined, string | undefined][] = [];
  listeners: string[] = [];
  private readonly failing: boolean;
  constructor(failing = false) {
    this.failing = failing;
  }
  send(message: string): void {
    if (this.failing) throw new TypeError('WebSocket send() after close');
    this.sent.push(message);
  }
  close(code?: number, reason?: string): void {
    this.closed.push([code, reason]);
  }
  addEventListener(type: string): void {
    this.listeners.push(type);
  }
}

class FakeState implements AnnouncerState {
  accepted: LiveSocket[] = [];
  acceptWebSocket(socket: LiveSocket): void {
    this.accepted.push(socket);
  }
  getWebSockets(): LiveSocket[] {
    return this.accepted;
  }
}

/** The runtime's socket pair and 101 answer, stood in. */
function fakeRuntime(): AnnouncerRuntime & { client: FakeSocket; server: FakeSocket; upgraded: LiveSocket[] } {
  const client = new FakeSocket();
  const server = new FakeSocket();
  const upgraded: LiveSocket[] = [];
  return {
    client,
    server,
    upgraded,
    pair: () => [client, server],
    upgrade: (socket) => {
      upgraded.push(socket);
      return new Response('upgraded', { status: 200 });
    },
  };
}

const connect = (version?: number): Request =>
  new Request('https://announcer/connect', {
    headers: { upgrade: 'websocket', ...(version === undefined ? {} : { [UI_VERSION_HEADER]: String(version) }) },
  });

const announceRequest = (body: unknown): Request =>
  new Request('https://announcer/announce', { method: 'POST', body: JSON.stringify(body) });

describe('Announcer', () => {
  it('accepts a connecting socket through the hibernation API and answers the upgrade with its client end', async () => {
    const state = new FakeState();
    const runtime = fakeRuntime();
    const response = await new Announcer(state, {}, runtime).fetch(connect(3));
    expect(state.accepted).toEqual([runtime.server]);
    expect(runtime.upgraded).toEqual([runtime.client]);
    expect(await response.text()).toBe('upgraded');
  });

  it('sends a connecting socket the current version at once', async () => {
    const runtime = fakeRuntime();
    await new Announcer(new FakeState(), {}, runtime).fetch(connect(7));
    expect(runtime.server.sent).toEqual(['{"type":"ui","version":7}']);
  });

  it('sends a connecting socket nothing while no version is published yet', async () => {
    const runtime = fakeRuntime();
    await new Announcer(new FakeState(), {}, runtime).fetch(connect());
    expect(runtime.server.sent).toEqual([]);
  });

  it.each(['0', '-1', '1.5', 'seven', ''])('refuses a connect naming version %j, accepting nothing', async (version) => {
    const state = new FakeState();
    const request = new Request('https://announcer/connect', { headers: { upgrade: 'websocket', [UI_VERSION_HEADER]: version } });
    const response = await new Announcer(state, {}, fakeRuntime()).fetch(request);
    expect(response.status).toBe(400);
    expect(state.accepted).toEqual([]);
  });

  it('refuses a connect that is not a WebSocket upgrade', async () => {
    const state = new FakeState();
    const response = await new Announcer(state, {}, fakeRuntime()).fetch(new Request('https://announcer/connect'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'websocket_required' });
    expect(state.accepted).toEqual([]);
  });

  it('sends one message to each connected socket on an announcement', async () => {
    const state = new FakeState();
    const sockets = [new FakeSocket(), new FakeSocket(), new FakeSocket()];
    for (const socket of sockets) state.acceptWebSocket(socket);
    const response = await new Announcer(state, {}, fakeRuntime()).fetch(announceRequest({ version: 8 }));
    expect(response.status).toBe(204);
    expect(sockets.map((socket) => socket.sent)).toEqual([
      ['{"type":"ui","version":8}'],
      ['{"type":"ui","version":8}'],
      ['{"type":"ui","version":8}'],
    ]);
  });

  it('still reaches every other socket when one has closed, and closes that one', async () => {
    const state = new FakeState();
    const gone = new FakeSocket(true);
    const live = new FakeSocket();
    state.acceptWebSocket(gone);
    state.acceptWebSocket(live);
    const response = await new Announcer(state, {}, fakeRuntime()).fetch(announceRequest({ version: 9 }));
    expect(response.status).toBe(204);
    expect(live.sent).toEqual(['{"type":"ui","version":9}']);
    expect(gone.closed).toEqual([[1011, 'send failed']]);
  });

  it.each([{}, { version: 0 }, { version: 2.5 }, { version: '3' }, null])('refuses announcing %j and sends nothing', async (body) => {
    const state = new FakeState();
    const socket = new FakeSocket();
    state.acceptWebSocket(socket);
    const response = await new Announcer(state, {}, fakeRuntime()).fetch(announceRequest(body));
    expect(response.status).toBe(400);
    expect(socket.sent).toEqual([]);
  });

  it('refuses an announcement that is not JSON', async () => {
    const request = new Request('https://announcer/announce', { method: 'POST', body: 'not json' });
    const response = await new Announcer(new FakeState(), {}, fakeRuntime()).fetch(request);
    expect(response.status).toBe(400);
  });

  it('refuses an announcement by GET', async () => {
    const response = await new Announcer(new FakeState(), {}, fakeRuntime()).fetch(new Request('https://announcer/announce'));
    expect(response.status).toBe(405);
  });

  it('answers 404 for any other path', async () => {
    const response = await new Announcer(new FakeState(), {}, fakeRuntime()).fetch(new Request('https://announcer/other'));
    expect(response.status).toBe(404);
  });

  it('never adds a listener to a socket it holds (the hibernation API delivers events instead)', async () => {
    const state = new FakeState();
    const runtime = fakeRuntime();
    const announcer = new Announcer(state, {}, runtime);
    await announcer.fetch(connect(1));
    await announcer.fetch(announceRequest({ version: 2 }));
    expect(runtime.server.listeners).toEqual([]);
    expect(runtime.client.listeners).toEqual([]);
  });

  it('completes the close a socket starts', () => {
    const socket = new FakeSocket();
    new Announcer(new FakeState(), {}, fakeRuntime()).webSocketClose(socket, 1000, 'bye');
    expect(socket.closed).toEqual([[1000, 'bye']]);
  });

  it('ignores a message an app sends', () => {
    const state = new FakeState();
    const socket = new FakeSocket();
    state.acceptWebSocket(socket);
    new Announcer(state, {}, fakeRuntime()).webSocketMessage();
    expect(socket.sent).toEqual([]);
    expect(socket.closed).toEqual([]);
    expect(state.getWebSockets()).toEqual([socket]);
  });
});

/** A stood-in Durable Object namespace recording each stub's name and requests. */
function fakeNamespace(answer: (request: Request) => Response | object) {
  const names: string[] = [];
  const requests: Request[] = [];
  return {
    names,
    requests,
    namespace: {
      idFromName: (name: string) => {
        names.push(name);
        return { name };
      },
      get: () => ({
        fetch: (request: Request) => {
          requests.push(request);
          return Promise.resolve(answer(request) as Response);
        },
      }),
    },
  };
}

describe('announce', () => {
  it('posts the version to the one ui Announcer', async () => {
    const fake = fakeNamespace(() => new Response(null, { status: 204 }));
    await announce({ ANNOUNCER: fake.namespace }, 12);
    expect(fake.names).toEqual(['ui']);
    expect(fake.requests).toHaveLength(1);
    const [request] = fake.requests;
    expect(request?.method).toBe('POST');
    expect(new URL(request?.url ?? '').pathname).toBe('/announce');
    expect(await request?.json()).toEqual({ version: 12 });
  });

  it('fails naming the status when the Announcer refuses', async () => {
    const fake = fakeNamespace(() => new Response(null, { status: 400 }));
    await expect(announce({ ANNOUNCER: fake.namespace }, 12)).rejects.toThrow('the Announcer answered 400');
  });
});

const SECRET = 'the-door-secret';

/** A D1 stand-in that is marked `dev` and answers `newest` with `version` (or no row). */
function d1(version: number | null): NonNullable<WebEnv['DB']> {
  const statement = {
    bind: () => statement,
    first: <T>() => Promise.resolve({ name: 'dev' } as T),
    all: () => Promise.resolve({ results: version === null ? [] : [{ version, body: '{}', audience: 'everyone' }] }),
  };
  return { prepare: () => statement, batch: () => Promise.resolve([]), exec: () => Promise.resolve() } as unknown as NonNullable<
    WebEnv['DB']
  >;
}

const live = (headers: Record<string, string> = { upgrade: 'websocket' }): Request =>
  new Request('https://site.example.test/api/app/live', { headers: { [DOOR_SECRET_HEADER]: SECRET, ...headers } });

function webEnv(version: number | null, announcer?: ReturnType<typeof fakeNamespace>): WebEnv {
  return {
    ENVIRONMENT_NAME: 'dev',
    DOOR_SECRET: SECRET,
    DB: d1(version),
    ASSETS: { fetch: () => Promise.resolve(new Response('page')) },
    ...(announcer === undefined ? {} : { ANNOUNCER: announcer.namespace }),
  };
}

describe('GET /api/app/live', () => {
  // The runtime's 101 answer carries the socket; Node cannot build one, so a marked object stands in.
  const upgraded = { status: 101, upgraded: true };

  it('hands an upgrade to the ui Announcer with the current version, and returns its 101 answer as it is', async () => {
    const fake = fakeNamespace(() => upgraded);
    const response = await handle(live(), webEnv(5, fake));
    expect(response).toBe(upgraded);
    expect(fake.names).toEqual(['ui']);
    expect(fake.requests[0]?.headers.get(UI_VERSION_HEADER)).toBe('5');
    expect(fake.requests[0]?.headers.get('upgrade')).toBe('websocket');
    expect(new URL(fake.requests[0]?.url ?? '').pathname).toBe('/connect');
  });

  it('names no version while none is published', async () => {
    const fake = fakeNamespace(() => upgraded);
    await handle(live(), webEnv(null, fake));
    expect(fake.requests[0]?.headers.has(UI_VERSION_HEADER)).toBe(false);
  });

  it('never passes on a version the caller names', async () => {
    const fake = fakeNamespace(() => upgraded);
    await handle(live({ upgrade: 'websocket', [UI_VERSION_HEADER]: '999' }), webEnv(null, fake));
    expect(fake.requests[0]?.headers.has(UI_VERSION_HEADER)).toBe(false);
  });

  it('answers 400 websocket_required to a plain GET, reaching no Announcer', async () => {
    const fake = fakeNamespace(() => upgraded);
    const response = await handle(live({}), webEnv(5, fake));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'websocket_required' });
    expect(fake.requests).toEqual([]);
  });

  it('answers 405 to anything but GET, reaching no Announcer', async () => {
    const fake = fakeNamespace(() => upgraded);
    const request = new Request('https://site.example.test/api/app/live', {
      method: 'POST',
      headers: { [DOOR_SECRET_HEADER]: SECRET, upgrade: 'websocket' },
    });
    const response = await handle(request, webEnv(5, fake));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(fake.requests).toEqual([]);
  });

  it('answers 503 live_unavailable in a Worker without the Announcer', async () => {
    const response = await handle(live(), webEnv(5));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'live_unavailable' });
  });

  it('is behind the door like every app route', async () => {
    const fake = fakeNamespace(() => upgraded);
    const response = await handle(
      new Request('https://site.example.test/api/app/live', { headers: { upgrade: 'websocket' } }),
      webEnv(5, fake),
    );
    expect(response.status).not.toBe(101);
    expect(fake.requests).toEqual([]);
  });
});

const ANNOUNCE_SECRET = 'the-announce-secret';

const announceCall = (headers: Record<string, string> = { authorization: `Bearer ${ANNOUNCE_SECRET}` }, method = 'POST'): Request =>
  new Request('https://site.example.test/api/app/live/announce', { method, headers: { [DOOR_SECRET_HEADER]: SECRET, ...headers } });

const withSecret = (env: WebEnv): WebEnv => ({ ...env, ANNOUNCE_SECRET });

describe('POST /api/app/live/announce', () => {
  it('announces the newest everyone version to the ui Announcer and names it', async () => {
    const fake = fakeNamespace(() => new Response(null, { status: 204 }));
    const response = await handle(announceCall(), withSecret(webEnv(6, fake)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ announced: 6 });
    expect(fake.names).toEqual(['ui']);
    expect(new URL(fake.requests[0]?.url ?? '').pathname).toBe('/announce');
    expect(await fake.requests[0]?.json()).toEqual({ version: 6 });
  });

  it('answers 404 no_ui_document while nothing is published, announcing nothing', async () => {
    const fake = fakeNamespace(() => new Response(null, { status: 204 }));
    const response = await handle(announceCall(), withSecret(webEnv(null, fake)));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'no_ui_document' });
    expect(fake.requests).toEqual([]);
  });

  it.each([
    ['no authorization', {}],
    ['a wrong secret', { authorization: 'Bearer not-the-secret' }],
    ['a prefix of the secret', { authorization: `Bearer ${ANNOUNCE_SECRET.slice(0, -1)}` }],
    ['the secret with more after it', { authorization: `Bearer ${ANNOUNCE_SECRET}x` }],
    ['the secret without Bearer', { authorization: ANNOUNCE_SECRET }],
  ])('answers 401 unauthorized to %s, announcing nothing', async (_case, headers) => {
    const fake = fakeNamespace(() => new Response(null, { status: 204 }));
    const response = await handle(announceCall(headers), withSecret(webEnv(6, fake)));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(fake.requests).toEqual([]);
  });

  it('answers 503 live_unavailable in a Worker without the announce secret, whatever the caller sends', async () => {
    const fake = fakeNamespace(() => new Response(null, { status: 204 }));
    const response = await handle(announceCall({ authorization: 'Bearer ' }), webEnv(6, fake));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'live_unavailable' });
    expect(fake.requests).toEqual([]);
  });

  it('answers 503 live_unavailable in a Worker without the Announcer', async () => {
    const response = await handle(announceCall(), withSecret(webEnv(6)));
    expect(response.status).toBe(503);
  });

  it('answers 405 to anything but POST', async () => {
    const fake = fakeNamespace(() => new Response(null, { status: 204 }));
    const response = await handle(announceCall(undefined, 'GET'), withSecret(webEnv(6, fake)));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(fake.requests).toEqual([]);
  });

  it('answers 502 announce_failed when the Announcer refuses', async () => {
    const fake = fakeNamespace(() => new Response(null, { status: 400 }));
    const response = await handle(announceCall(), withSecret(webEnv(6, fake)));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'announce_failed' });
  });
});

describe('the site Worker main module', () => {
  it('exports the Announcer class the Wrangler config binds', async () => {
    const entry = await import('../../workers/web/src/index.ts');
    expect((entry as Record<string, unknown>)['Announcer']).toBe(Announcer);
  });
});
