import { describe, it, expect } from 'vitest';
import { Roadmap, REFRESH_AFTER_MS, type RoadmapDeps, type LiveSnapshot } from '../../workers/web/src/roadmap/object.ts';
import type { LiveSocket } from '../../workers/web/src/app/announcer.ts';
import type { RoadmapItem } from '../../workers/web/src/roadmap/snapshot.ts';

/**
 * The roadmap's Durable Object (shyden-labs/ShyTalk#321 AC2 and AC3; after Yawelo Idle's apps/site/worker/roadmap.ts
 * and yawelo-idle#1074): it holds the last whole board read and pushes each new one over hibernating WebSockets. A
 * visit is answered at once from what it holds; one over 10 minutes old also starts one background read (no cron, no
 * timer). A burst of changes causes at most two reads, and a failed read keeps the last snapshot, marked failing.
 */

const START = Date.parse('2026-11-23T07:00:00Z');

function epic(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN'): RoadmapItem {
  return {
    number,
    title: 'Epic: internal',
    state,
    createdAt: '2026-11-01T00:00:00Z',
    closedAt: state === 'CLOSED' ? '2026-11-20T00:00:00Z' : null,
    stateReason: state === 'CLOSED' ? 'COMPLETED' : null,
    estimate: null,
    labels: [],
    priority: 'P0',
    parent: null,
    publicTitle: `Milestone ${String(number)}`,
    publicSummary: null,
  };
}

class FakeSocket implements LiveSocket {
  sent: string[] = [];
  closed: [number | undefined, string | undefined] | null = null;
  failing = false;
  send(message: string): void {
    if (this.failing) throw new Error('gone');
    this.sent.push(message);
  }
  close(code?: number, reason?: string): void {
    this.closed = [code, reason];
  }
}

/** A Roadmap over in-memory storage, a stood-in board and clock, and a socket runtime that records upgrades. */
function harness(reads: (() => Promise<RoadmapItem[]>)[]) {
  const storage = new Map<string, unknown>();
  const sockets: FakeSocket[] = [];
  const background: Promise<unknown>[] = [];
  let clock = START;
  let calls = 0;
  const deps: RoadmapDeps = {
    readBoard: () => {
      const read = reads[Math.min(calls, reads.length - 1)];
      calls += 1;
      if (read === undefined) throw new Error('no read stood in');
      return read();
    },
    now: () => clock,
    runtime: {
      pair: () => {
        const server = new FakeSocket();
        return [new FakeSocket(), server];
      },
      upgrade: () => new Response(null, { status: 200, headers: { 'x-upgraded': 'yes' } }),
    },
  };
  const state = {
    storage: {
      get: <T>(key: string) => Promise.resolve(storage.get(key) as T | undefined),
      put: (key: string, value: unknown) => {
        storage.set(key, structuredClone(value));
        return Promise.resolve();
      },
    },
    acceptWebSocket: (socket: LiveSocket) => sockets.push(socket as FakeSocket),
    getWebSockets: () => sockets,
    waitUntil: (promise: Promise<unknown>) => background.push(promise),
  };
  const roadmap = new Roadmap(state, {}, deps);
  return {
    roadmap,
    sockets,
    reads: () => calls,
    advance: (ms: number) => {
      clock += ms;
    },
    settle: async () => {
      while (background.length > 0) await background.shift();
    },
    snapshot: async (): Promise<LiveSnapshot> => {
      const answer = await roadmap.fetch(new Request('https://roadmap/snapshot'));
      expect(answer.status).toBe(200);
      return (await answer.json()) as LiveSnapshot;
    },
    changed: () => roadmap.fetch(new Request('https://roadmap/changed', { method: 'POST' })),
    connect: () => roadmap.fetch(new Request('https://roadmap/connect', { headers: { upgrade: 'websocket' } })),
  };
}

const ok =
  (...items: RoadmapItem[]) =>
  () =>
    Promise.resolve(items);
const fails = () => Promise.reject(new Error('GitHub answered 502'));

describe('the roadmap object', () => {
  it('reads the board on the first visit, when it holds nothing yet, and answers that read', async () => {
    const h = harness([ok(epic(7))]);
    const shown = await h.snapshot();
    expect(h.reads()).toBe(1);
    expect(shown.version).toBe(1);
    expect(shown.readAt).toBe('2026-11-23T07:00:00.000Z');
    expect(shown.milestones.map(({ name }) => name)).toEqual(['Milestone 7']);
    expect([shown.stale, shown.readFailed]).toEqual([false, false]);
  });

  it('answers a visit within 10 minutes of the last read from what it holds, reading nothing', async () => {
    const h = harness([ok(epic(7))]);
    await h.snapshot();
    h.advance(REFRESH_AFTER_MS);
    const shown = await h.snapshot();
    await h.settle();
    expect(h.reads()).toBe(1);
    expect(shown.stale).toBe(false);
  });

  it('answers an older visit at once, marked stale, and starts one background read that every socket then gets', async () => {
    const h = harness([ok(epic(7)), ok(epic(7), epic(8))]);
    await h.snapshot();
    await h.connect();
    h.advance(REFRESH_AFTER_MS + 1);
    const shown = await h.snapshot();
    expect(shown.version).toBe(1);
    expect(shown.stale).toBe(true);
    await h.snapshot();
    await h.settle();
    expect(h.reads()).toBe(2);
    const pushed = JSON.parse(h.sockets[0]?.sent.at(-1) ?? '{}') as LiveSnapshot & { type: string };
    expect(pushed.type).toBe('roadmap');
    expect(pushed.version).toBe(2);
    expect(pushed.milestones).toHaveLength(2);
    expect((await h.snapshot()).stale).toBe(false);
  });

  it('reads at most twice for a burst of changes: the one running and one more after it', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness([ok(epic(7)), () => held.then(() => [epic(7)]), ok(epic(7), epic(8))]);
    await h.snapshot();
    for (let i = 0; i < 5; i += 1) expect((await h.changed()).status).toBe(202);
    release();
    await h.settle();
    expect(h.reads()).toBe(3);
    expect((await h.snapshot()).version).toBe(3);
  });

  it('keeps the last snapshot when a read fails, marks it failing, and clears the mark on the next good read', async () => {
    const h = harness([ok(epic(7)), fails, ok(epic(7), epic(8))]);
    await h.snapshot();
    await h.connect();
    await h.changed();
    await h.settle();
    const failing = await h.snapshot();
    expect([failing.version, failing.readFailed]).toEqual([1, true]);
    expect(failing.milestones).toHaveLength(1);
    expect(h.sockets[0]?.sent).toHaveLength(1);
    await h.changed();
    await h.settle();
    const mended = await h.snapshot();
    expect([mended.version, mended.readFailed]).toEqual([2, false]);
  });

  it('answers 503 naming no cause when the first read of all fails, and holds nothing', async () => {
    const h = harness([fails, ok(epic(7))]);
    const answer = await h.roadmap.fetch(new Request('https://roadmap/snapshot'));
    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ error: 'roadmap_unavailable' });
    expect((await h.snapshot()).version).toBe(1);
  });

  it('sends a socket the snapshot it holds as it connects, and nothing when it holds none', async () => {
    const h = harness([ok(epic(7))]);
    expect((await h.connect()).headers.get('x-upgraded')).toBe('yes');
    expect(h.sockets[0]?.sent).toEqual([]);
    await h.snapshot();
    await h.connect();
    expect((JSON.parse(h.sockets[1]?.sent[0] ?? '{}') as LiveSnapshot).version).toBe(1);
  });

  it('refuses a connect that is not a WebSocket upgrade', async () => {
    const h = harness([ok(epic(7))]);
    const answer = await h.roadmap.fetch(new Request('https://roadmap/connect'));
    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({ error: 'websocket_required' });
  });

  it('closes a socket that cannot take a new snapshot, and still tells the others', async () => {
    const h = harness([ok(epic(7)), ok(epic(8))]);
    await h.snapshot();
    await h.connect();
    await h.connect();
    if (h.sockets[0]) h.sockets[0].failing = true;
    await h.changed();
    await h.settle();
    expect(h.sockets[0]?.closed).toEqual([1011, 'send failed']);
    expect(h.sockets[1]?.sent).toHaveLength(2);
  });

  it('takes changes by POST only, and answers 404 for any other address', async () => {
    const h = harness([ok(epic(7))]);
    const get = await h.roadmap.fetch(new Request('https://roadmap/changed'));
    expect([get.status, get.headers.get('allow')]).toEqual([405, 'POST']);
    expect((await h.roadmap.fetch(new Request('https://roadmap/elsewhere'))).status).toBe(404);
  });

  it('completes a close a page starts, and ignores what a page sends', () => {
    const h = harness([ok(epic(7))]);
    const socket = new FakeSocket();
    h.roadmap.webSocketClose(socket, 1000, 'bye');
    expect(socket.closed).toEqual([1000, 'bye']);
    h.roadmap.webSocketMessage();
    expect([socket.sent, h.reads()]).toEqual([[], 0]);
  });
});
