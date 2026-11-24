/**
 * The roadmap's Durable Object, `Roadmap` (named `roadmap`; shyden-labs/ShyTalk#321 AC2 and AC3), after Yawelo
 * Idle's apps/site/worker/roadmap.ts and yawelo-idle#1074. It holds the last whole board read and pushes each new
 * one over hibernating WebSockets, so it sleeps, and costs nothing, while the board is still. GitHub's webhook says
 * the board changed (`POST /changed`); a visit (`GET /snapshot`) is answered at once from what it holds, and one
 * finding the last read over 10 minutes old also starts one background read. No cron, no timer.
 *
 * A burst of changes causes at most two reads: the one running and one more after it. A failed read keeps the last
 * snapshot and marks it failing, which the page never shows; the next good read clears it. The class is plain over
 * structural state, so the unit tests run in Node; the Workers runtime constructs it with its own `ctx`.
 */
import { json } from '../http.ts';
import type { AnnouncerRuntime, AnnouncerState, LiveSocket } from '../app/announcer.ts';
import { publicSnapshot, type PublicSnapshot, type RoadmapItem } from './snapshot.ts';

/** How old the last read may be before a visit starts a fresh one in the background. */
export const REFRESH_AFTER_MS = 10 * 60 * 1000;

/** What a visit and a socket get: the public snapshot, its version and read time, and two flags. */
export type LiveSnapshot = PublicSnapshot & {
  version: number;
  /** When the board was read, as an ISO time; the page words it in the visitor's own time zone. */
  readAt: string;
  /** The last read is over 10 minutes old, and a fresh one is under way. */
  stale: boolean;
  /** The last read failed; the snapshot is the last good one. */
  readFailed: boolean;
};

/** What the object keeps in storage between wakes. */
interface Held {
  snapshot: PublicSnapshot;
  version: number;
  readAt: number;
  readFailed: boolean;
}

/** The part of a Durable Object's state the Roadmap uses: storage, the hibernation API and waitUntil. */
export interface RoadmapState extends AnnouncerState {
  storage: { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> };
  waitUntil(promise: Promise<unknown>): void;
}

export interface RoadmapDeps {
  /** One whole read of the board, as the roadmap reads it. */
  readBoard(): Promise<RoadmapItem[]>;
  now(): number;
  runtime: AnnouncerRuntime;
}

const HELD = 'held';

export class Roadmap {
  private readonly state: RoadmapState;
  private readonly deps: RoadmapDeps;
  /** The read under way, if any, and whether a change arrived while it ran. */
  private reading: Promise<void> | null = null;
  private again = false;

  constructor(state: RoadmapState, _env: unknown, deps: RoadmapDeps) {
    this.state = state;
    this.deps = deps;
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/snapshot') return this.visit();
    if (pathname === '/connect') return this.connect(request);
    if (pathname === '/changed') return this.changed(request);
    return json(404, { error: 'not_found' });
  }

  private live(held: Held, stale: boolean): LiveSnapshot {
    return {
      ...held.snapshot,
      version: held.version,
      readAt: new Date(held.readAt).toISOString(),
      stale,
      readFailed: held.readFailed,
    };
  }

  private async visit(): Promise<Response> {
    let held = await this.state.storage.get<Held>(HELD);
    if (held === undefined) {
      // Nothing to show yet: this one visit waits for the first read of all.
      await this.read();
      held = await this.state.storage.get<Held>(HELD);
      if (held === undefined) return json(503, { error: 'roadmap_unavailable' });
      return json(200, this.live(held, false));
    }
    const stale = this.deps.now() - held.readAt > REFRESH_AFTER_MS;
    if (stale) this.state.waitUntil(this.read());
    return json(200, this.live(held, stale || this.reading !== null));
  }

  private changed(request: Request): Response {
    if (request.method !== 'POST') {
      const answer = json(405, { error: 'method_not_allowed' });
      answer.headers.set('allow', 'POST');
      return answer;
    }
    this.state.waitUntil(this.read());
    return json(202, { state: 'reading' });
  }

  /** Starts a read, or, while one runs, asks for exactly one more after it. */
  private read(): Promise<void> {
    if (this.reading !== null) {
      this.again = true;
      return this.reading;
    }
    this.reading = this.readUntilQuiet().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  /** One read, then one more if a change arrived while it ran, and so on until a read ends with none waiting. */
  private async readUntilQuiet(): Promise<void> {
    this.again = false;
    await this.readOnce();
    if (this.askedAgain()) await this.readUntilQuiet();
  }

  /** Whether a change arrived during the read just done (set by `read`, so the compiler cannot see it change). */
  private askedAgain(): boolean {
    return this.again;
  }

  private async readOnce(): Promise<void> {
    const held = await this.state.storage.get<Held>(HELD);
    let items: RoadmapItem[];
    try {
      items = await this.deps.readBoard();
    } catch {
      // The page never shows a failure: the last good snapshot stays, marked failing.
      if (held !== undefined) await this.state.storage.put(HELD, { ...held, readFailed: true });
      return;
    }
    const now = this.deps.now();
    const next: Held = {
      snapshot: publicSnapshot(items, new Date(now).toISOString().slice(0, 10)),
      version: (held?.version ?? 0) + 1,
      readAt: now,
      readFailed: false,
    };
    await this.state.storage.put(HELD, next);
    this.broadcast(JSON.stringify({ type: 'roadmap', ...this.live(next, false) }));
  }

  private broadcast(text: string): void {
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(text);
      } catch {
        // A socket that cannot take a message has gone; closing it drops it from the next broadcast.
        socket.close(1011, 'send failed');
      }
    }
  }

  private async connect(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json(400, { error: 'websocket_required' });
    const [client, server] = this.deps.runtime.pair();
    this.state.acceptWebSocket(server);
    const held = await this.state.storage.get<Held>(HELD);
    if (held !== undefined) server.send(JSON.stringify({ type: 'roadmap', ...this.live(held, false) }));
    return this.deps.runtime.upgrade(client);
  }

  /** The hibernation API's close event: completes the close the page started. */
  webSocketClose(socket: LiveSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }

  /** The hibernation API's message event: pages only listen, so a message changes nothing. */
  webSocketMessage(): void {
    // Nothing to do: pages only listen.
  }
}
