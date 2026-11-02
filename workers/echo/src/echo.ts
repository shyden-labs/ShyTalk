/**
 * THROWAWAY: the DEV echo Worker for the door spike (plan 2 Task E6,
 * shyden-labs/ShyTalk#31). Deployed as `shytalk-dev` on the Non-Prod account,
 * the dev door's origin, so a WebSocket through dev.shytalk.app can be held
 * for 30 minutes, see alarms arrive and resume after a drop. Step 6 deletes
 * this Worker, its Durable Object and this folder.
 *
 * Every request needs the door secret (packages/environment). It checks no
 * environment marker: it has no store to mark (decision 215).
 *
 * Written against the standard Request/Response plus small structural types
 * for the Workers runtime, so the root tsconfig checks it as it is.
 */
import { requireDoorSecret } from '../../../packages/environment/index.ts';

/** How often the room's alarm fires while a socket is open. */
export const ALARM_EVERY_MS = 30_000;

/** The part of a WebSocket the room uses. */
export interface SocketLike {
  send(message: string): void;
  close(code: number, reason: string): void;
}

/** The part of a Durable Object's state the room uses (the hibernation API). */
export interface RoomState {
  acceptWebSocket(socket: SocketLike): void;
  getWebSockets(): SocketLike[];
  storage: {
    getAlarm(): Promise<number | null>;
    setAlarm(at: number): Promise<void>;
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
  };
}

/** The part of a Durable Object namespace the entry uses. */
export interface RoomNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export interface EchoEnv {
  /** DEV's door secret (a Wrangler secret, never a var). */
  DOOR_SECRET?: string;
  ECHO: RoomNamespace;
}

/** What the Workers runtime gives that Node does not: a socket pair and a 101 response. */
export interface WorkersRuntime {
  pair(): [client: SocketLike, server: SocketLike];
  upgrade(client: SocketLike): Response;
}

const workersRuntime: WorkersRuntime = {
  pair() {
    const Pair = (globalThis as unknown as { WebSocketPair: new () => Record<0 | 1, SocketLike> }).WebSocketPair;
    const made = new Pair();
    return [made[0], made[1]];
  },
  upgrade: (client) => new Response(null, { status: 101, webSocket: client } as ResponseInit),
};

const plain = (status: number, text: string): Response =>
  new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

const isUpgrade = (request: Request): boolean => request.headers.get('upgrade')?.toLowerCase() === 'websocket';

/** The entry: door secret first, then `/ws` upgrades go to the room named by `?id`. */
export async function handle(request: Request, env: EchoEnv): Promise<Response> {
  const refused = await requireDoorSecret(request, env.DOOR_SECRET);
  if (refused) return refused;

  const url = new URL(request.url);
  if (url.pathname === '/ws' && isUpgrade(request)) {
    const name = url.searchParams.get('id') ?? 'spike';
    return env.ECHO.get(env.ECHO.idFromName(name)).fetch(request);
  }
  return plain(200, 'shytalk echo: ok\n');
}

/** One spike session: echoes messages and, every 30 s while a socket is open, sends a numbered alarm. */
export class EchoRoom {
  private readonly state: RoomState;
  private readonly runtime: WorkersRuntime;

  constructor(state: RoomState, _env: unknown, runtime: WorkersRuntime = workersRuntime) {
    this.state = state;
    this.runtime = runtime;
  }

  async fetch(request: Request): Promise<Response> {
    if (!isUpgrade(request)) return plain(426, 'Upgrade Required');
    const [client, server] = this.runtime.pair();
    this.state.acceptWebSocket(server);
    if ((await this.state.storage.getAlarm()) === null) await this.state.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
    return this.runtime.upgrade(client);
  }

  async webSocketMessage(socket: SocketLike, message: string | ArrayBuffer): Promise<void> {
    const echo = typeof message === 'string' ? message : `<${String(message.byteLength)} bytes>`;
    socket.send(JSON.stringify({ echo, at: Date.now() }));
    return Promise.resolve();
  }

  async webSocketClose(socket: SocketLike, code: number, reason: string): Promise<void> {
    socket.close(code, reason);
    return Promise.resolve();
  }

  async alarm(): Promise<void> {
    const count = ((await this.state.storage.get<number>('alarms')) ?? 0) + 1;
    await this.state.storage.put('alarms', count);
    const sockets = this.state.getWebSockets();
    const line = JSON.stringify({ alarm: count, at: Date.now() });
    for (const socket of sockets) socket.send(line);
    if (sockets.length > 0) await this.state.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
  }
}
