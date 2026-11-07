/**
 * The live announcement (plan 4 Task 8, shyden-labs/ShyTalk#81). One Durable
 * Object, `Announcer` (named `ui`), holds every open app's WebSocket through
 * the hibernation API, so it sleeps, and costs nothing, while no version
 * changes. A publish or undo calls `announce`, and each socket gets one
 * `{"type":"ui","version":N}`; the app then reads `GET /api/app/ui`, which
 * decides what that person sees. A socket that connects is sent the current
 * version at once, so an app that was offline catches up on reconnect.
 *
 * The class is plain over structural state and runtime, so the unit tests run
 * in Node; the Workers runtime constructs it with its own `ctx` and the
 * default runtime below.
 */
import { json } from '../http.ts';

/** The header the Worker names the current version in when it hands a socket to the Announcer. */
export const UI_VERSION_HEADER = 'x-shytalk-ui-version';

/** The one Announcer every app connects to. */
const ANNOUNCER_NAME = 'ui';

/** The part of a WebSocket the Announcer uses. */
export interface LiveSocket {
  send(message: string): void;
  close(code?: number, reason?: string): void;
}

/** The part of a Durable Object's state the Announcer uses: the hibernation API. */
export interface AnnouncerState {
  acceptWebSocket(socket: LiveSocket): void;
  getWebSockets(): LiveSocket[];
}

/** The runtime's socket pair and its 101 answer. */
export interface AnnouncerRuntime {
  /** A connected pair: the client end goes back to the app, the server end stays here. */
  pair(): [LiveSocket, LiveSocket];
  upgrade(client: LiveSocket): Response;
}

/** The Workers runtime's own pair and upgrade answer. */
const workersRuntime: AnnouncerRuntime = {
  pair() {
    const pair = new (globalThis as unknown as { WebSocketPair: new () => Record<0 | 1, LiveSocket> }).WebSocketPair();
    return [pair[0], pair[1]];
  },
  upgrade: (client) => new Response(null, { status: 101, webSocket: client } as ResponseInit),
};

const message = (version: number): string => JSON.stringify({ type: 'ui', version });

/** A version number: a whole number of 1 or more. */
const isVersion = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;

export class Announcer {
  private readonly state: AnnouncerState;
  private readonly runtime: AnnouncerRuntime;

  constructor(state: AnnouncerState, _env: unknown, runtime: AnnouncerRuntime = workersRuntime) {
    this.state = state;
    this.runtime = runtime;
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/connect') return this.connect(request);
    if (pathname === '/announce') return this.announce(request);
    return json(404, { error: 'not_found' });
  }

  private connect(request: Request): Response {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json(400, { error: 'websocket_required' });
    const named = request.headers.get(UI_VERSION_HEADER);
    const version = named === null ? null : Number(named);
    if (named !== null && (named === '' || !isVersion(version))) return json(400, { error: 'bad_version' });
    const [client, server] = this.runtime.pair();
    this.state.acceptWebSocket(server);
    if (version !== null) server.send(message(version));
    return this.runtime.upgrade(client);
  }

  private async announce(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'bad_announcement' });
    }
    const version = (body as { version?: unknown } | null)?.version;
    if (!isVersion(version)) return json(400, { error: 'bad_announcement' });
    const text = message(version);
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(text);
      } catch {
        // A socket that cannot take a message has gone; closing it drops it from the next broadcast.
        socket.close(1011, 'send failed');
      }
    }
    return new Response(null, { status: 204 });
  }

  /** The hibernation API's close event: completes the close the app started. */
  webSocketClose(socket: LiveSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }

  /** The hibernation API's message event: apps only listen, so a message changes nothing. */
  webSocketMessage(): void {}
}

/** The part of a Durable Object namespace the Worker uses. */
export interface AnnouncerNamespace {
  idFromName(name: string): unknown;
  get(id: never): { fetch(request: Request): Promise<Response> };
}

/** The ui Announcer's stub. */
export const announcerStub = (namespace: AnnouncerNamespace) => namespace.get(namespace.idFromName(ANNOUNCER_NAME) as never);

/** Tells every connected app that `version` is published; fails naming the status if the Announcer refuses. */
export async function announce(env: { ANNOUNCER: AnnouncerNamespace }, version: number): Promise<void> {
  const response = await announcerStub(env.ANNOUNCER).fetch(
    new Request('https://announcer/announce', { method: 'POST', body: JSON.stringify({ version }) }),
  );
  if (response.status !== 204) throw new Error(`the Announcer answered ${String(response.status)}`);
}

/**
 * `GET /api/app/live`: hands a WebSocket upgrade to the ui Announcer, naming the
 * newest `everyone` version (or none), never one the caller named.
 */
export function handleLive(request: Request, namespace: AnnouncerNamespace, version: number | null): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return Promise.resolve(json(400, { error: 'websocket_required' }));
  // The app's own handshake headers go with it; only the version is the Worker's.
  const headers = new Headers(request.headers);
  headers.delete(UI_VERSION_HEADER);
  if (version !== null) headers.set(UI_VERSION_HEADER, String(version));
  return announcerStub(namespace).fetch(new Request('https://announcer/connect', { headers }));
}

/** Whether `header` is `Bearer <secret>`, compared by digest so the time taken says nothing about the secret. */
async function bearerMatches(header: string | null, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [given, wanted] = await Promise.all(
    [header ?? '', `Bearer ${secret}`].map(async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))),
  );
  let difference = 0;
  // Both are 32-byte digests, so every index is in both.
  (wanted ?? new Uint8Array()).forEach((byte, index) => {
    difference |= byte ^ (given?.[index] ?? 0);
  });
  return difference === 0;
}

/**
 * `POST /api/app/live/announce`: the deploy's call after it publishes, with the
 * announce secret it put in the Worker. It announces the newest `everyone`
 * version, the server's own, never one the caller names.
 */
export async function handleAnnounce(
  request: Request,
  namespace: AnnouncerNamespace,
  secret: string,
  version: number | null,
): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (!(await bearerMatches(request.headers.get('authorization'), secret))) return json(401, { error: 'unauthorized' });
  if (version === null) return json(404, { error: 'no_ui_document' });
  try {
    await announce({ ANNOUNCER: namespace }, version);
  } catch {
    return json(502, { error: 'announce_failed' });
  }
  return json(200, { announced: version });
}
