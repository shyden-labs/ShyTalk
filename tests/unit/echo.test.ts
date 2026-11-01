import { describe, it, expect, vi, afterEach } from 'vitest';
import echo, {
  ALARM_EVERY_MS,
  EchoRoom,
  handle,
  type EchoEnv,
  type RoomState,
  type SocketLike,
  type WorkersRuntime,
} from '../../workers/echo/src/index.ts';
import { DOOR_SECRET_HEADER } from '../../packages/environment/index.ts';

/**
 * The throwaway DEV echo Worker for the door spike (plan 2 Task E6 Step 1,
 * shyden-labs/ShyTalk#31; decision 215: door secret only). Deleted in Step 6.
 * The runtime's WebSocketPair, 101 response and Durable Object state are
 * stood in; the tests use a neutral host.
 */

const SECRET = 'the-door-secret';

/** A stand-in socket that records what it is sent. */
class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed: [number, string] | null = null;
  send(message: string): void {
    this.sent.push(message);
  }
  close(code: number, reason: string): void {
    this.closed = [code, reason];
  }
}

/** A stand-in Durable Object state: accepted sockets, one alarm and a key-value store. */
function fakeState(): RoomState & { sockets: FakeSocket[]; alarm: number | null; store: Map<string, unknown> } {
  const state = {
    sockets: [] as FakeSocket[],
    alarm: null as number | null,
    store: new Map<string, unknown>(),
    acceptWebSocket(socket: SocketLike) {
      state.sockets.push(socket as FakeSocket);
    },
    getWebSockets: () => state.sockets,
    storage: {
      getAlarm: () => Promise.resolve(state.alarm),
      setAlarm: (at: number) => {
        state.alarm = at;
        return Promise.resolve();
      },
      get: <T>(key: string) => Promise.resolve(state.store.get(key) as T | undefined),
      put: (key: string, value: unknown) => {
        state.store.set(key, value);
        return Promise.resolve();
      },
    },
  };
  return state;
}

/** A stand-in runtime: each pair is two fake sockets, and the 101 response carries the client. */
function fakeRuntime(): WorkersRuntime & { clients: FakeSocket[] } {
  const runtime = {
    clients: [] as FakeSocket[],
    pair: (): [SocketLike, SocketLike] => {
      const client = new FakeSocket();
      runtime.clients.push(client);
      return [client, new FakeSocket()];
    },
    upgrade: (client: SocketLike) => new Response(`upgraded ${String(runtime.clients.indexOf(client as FakeSocket))}`),
  };
  return runtime;
}

const upgradeRequest = (path = '/ws?id=spike', secret: string | null = SECRET): Request => {
  const headers = new Headers({ upgrade: 'websocket', connection: 'Upgrade' });
  if (secret !== null) headers.set(DOOR_SECRET_HEADER, secret);
  return new Request(`https://origin.example.test${path}`, { headers });
};

/** An env whose ECHO namespace records which name each request was routed to. */
function fakeEnv(answer = new Response('from the room')): { env: EchoEnv; routed: string[] } {
  const routed: string[] = [];
  const env: EchoEnv = {
    DOOR_SECRET: SECRET,
    ECHO: {
      idFromName: (name: string) => ({ name }),
      get: (id: unknown) => ({
        fetch: () => {
          routed.push((id as { name: string }).name);
          return Promise.resolve(answer);
        },
      }),
    },
  };
  return { env, routed };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the echo Worker entry', () => {
  it('refuses a request without the door secret (403) before reaching the room', async () => {
    const { env, routed } = fakeEnv();
    const response = await handle(upgradeRequest('/ws?id=spike', null), env);
    expect(response.status).toBe(403);
    expect(routed).toEqual([]);
  });

  it('refuses a request with the wrong door secret (403)', async () => {
    const { env } = fakeEnv();
    expect((await handle(upgradeRequest('/ws?id=spike', 'wrong'), env)).status).toBe(403);
  });

  it('sends a WebSocket upgrade on /ws to the room named by ?id', async () => {
    const { env, routed } = fakeEnv();
    const response = await handle(upgradeRequest('/ws?id=session-7'), env);
    expect(await response.text()).toBe('from the room');
    expect(routed).toEqual(['session-7']);
  });

  it('names the room "spike" when ?id is missing', async () => {
    const { env, routed } = fakeEnv();
    await handle(upgradeRequest('/ws'), env);
    expect(routed).toEqual(['spike']);
  });

  it('answers any other request with a plain line, so a door read-back can see it', async () => {
    const { env, routed } = fakeEnv();
    const response = await handle(new Request('https://origin.example.test/', { headers: { [DOOR_SECRET_HEADER]: SECRET } }), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('shytalk echo: ok\n');
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(routed).toEqual([]);
  });

  it('is the default export fetch', async () => {
    const { env } = fakeEnv();
    expect((await echo.fetch(upgradeRequest('/ws', 'wrong'), env)).status).toBe(403);
  });
});

describe('the echo room (Durable Object)', () => {
  it('refuses a request that is not a WebSocket upgrade (426)', async () => {
    const room = new EchoRoom(fakeState(), {}, fakeRuntime());
    const response = await room.fetch(new Request('https://origin.example.test/ws'));
    expect(response.status).toBe(426);
  });

  it('accepts the server socket, answers with the client, and starts the 30 s alarm', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const state = fakeState();
    const runtime = fakeRuntime();
    const room = new EchoRoom(state, {}, runtime);
    const response = await room.fetch(upgradeRequest());
    expect(await response.text()).toBe('upgraded 0');
    expect(state.sockets).toHaveLength(1);
    expect(state.alarm).toBe(1_000_000 + ALARM_EVERY_MS);
    expect(ALARM_EVERY_MS).toBe(30_000);
  });

  it('keeps a running alarm when a second socket joins', async () => {
    const state = fakeState();
    state.alarm = 42;
    const room = new EchoRoom(state, {}, fakeRuntime());
    await room.fetch(upgradeRequest());
    expect(state.alarm).toBe(42);
  });

  it('echoes each message with the time it arrived', async () => {
    vi.useFakeTimers({ now: 5_000 });
    const room = new EchoRoom(fakeState(), {}, fakeRuntime());
    const socket = new FakeSocket();
    await room.webSocketMessage(socket, 'hello');
    expect(socket.sent.map((m) => JSON.parse(m) as unknown)).toEqual([{ echo: 'hello', at: 5_000 }]);
  });

  it('echoes a binary message by its size', async () => {
    const room = new EchoRoom(fakeState(), {}, fakeRuntime());
    const socket = new FakeSocket();
    await room.webSocketMessage(socket, new ArrayBuffer(3));
    expect(JSON.parse(socket.sent[0] as string)).toMatchObject({ echo: '<3 bytes>' });
  });

  it('on each alarm, tells every socket its count and time, and sets the next alarm', async () => {
    vi.useFakeTimers({ now: 60_000 });
    const state = fakeState();
    const room = new EchoRoom(state, {}, fakeRuntime());
    state.sockets.push(new FakeSocket(), new FakeSocket());
    await room.alarm();
    await room.alarm();
    for (const socket of state.sockets) {
      expect(socket.sent.map((m) => JSON.parse(m) as unknown)).toEqual([
        { alarm: 1, at: 60_000 },
        { alarm: 2, at: 60_000 },
      ]);
    }
    expect(state.alarm).toBe(60_000 + ALARM_EVERY_MS);
  });

  it('stops the alarm when no socket is left', async () => {
    const state = fakeState();
    const room = new EchoRoom(state, {}, fakeRuntime());
    await room.alarm();
    expect(state.alarm).toBeNull();
    expect(state.store.get('alarms')).toBe(1);
  });

  it('closes its side when the client closes', async () => {
    const room = new EchoRoom(fakeState(), {}, fakeRuntime());
    const socket = new FakeSocket();
    await room.webSocketClose(socket, 1000, 'bye');
    expect(socket.closed).toEqual([1000, 'bye']);
  });

  it("uses the Workers runtime's WebSocketPair and a 101 response by default", async () => {
    const client = new FakeSocket();
    const server = new FakeSocket();
    vi.stubGlobal(
      'WebSocketPair',
      class {
        0 = client;
        1 = server;
      },
    );
    type Body = ConstructorParameters<typeof Response>[0];
    const made: [Body, ResponseInit | undefined][] = [];
    vi.stubGlobal(
      'Response',
      class extends Response {
        constructor(body?: Body, init?: ResponseInit) {
          made.push([body, init]);
          super(body, init && init.status === 101 ? { status: 200 } : init);
        }
      },
    );
    const state = fakeState();
    await new EchoRoom(state, {}).fetch(upgradeRequest());
    expect(state.sockets).toEqual([server]);
    expect(made).toContainEqual([null, { status: 101, webSocket: client }]);
  });
});
