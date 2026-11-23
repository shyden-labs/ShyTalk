import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Roadmap, roadmapDeps } from '../../workers/web/src/roadmap/worker.ts';
import * as entry from '../../workers/web/src/index.ts';

/**
 * The Worker's own roadmap object (shyden-labs/ShyTalk#321): the runtime builds it with its `ctx` and env, and it
 * reads the board as the read-only App the env names (ROADMAP_APP_ID, ROADMAP_INSTALLATION_ID, the ROADMAP_APP_KEY
 * secret), on ShyTalk's own board.
 */

const KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
const ENV = { ROADMAP_APP_ID: '5880693', ROADMAP_INSTALLATION_ID: '184830629', ROADMAP_APP_KEY: KEY };

/** The env without `name`. */
const without = (name: string) => Object.fromEntries(Object.entries(ENV).filter(([key]) => key !== name));

const emptyBoard = {
  data: { node: { title: 'ShyTalk Stories', items: { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } },
};

describe('the Worker’s roadmap object', () => {
  it('reads ShyTalk’s board as the App the env names', async () => {
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const deps = roadmapDeps(ENV, (url, init) => {
      urls.push(url);
      if (url.endsWith('/access_tokens')) return Promise.resolve(Response.json({ token: 'ghs_t' }, { status: 201 }));
      bodies.push(JSON.parse(init?.body as string));
      return Promise.resolve(Response.json(emptyBoard));
    });
    expect(await deps.readBoard()).toEqual([]);
    expect(urls).toEqual(['https://api.github.com/app/installations/184830629/access_tokens', 'https://api.github.com/graphql']);
    expect((bodies[0] as { variables: { id: string } }).variables.id).toBe('PVT_kwDOEOcG584BpkXr');
    expect(Math.abs(deps.now() - Date.now())).toBeLessThan(1000);
  });

  it.each(['ROADMAP_APP_ID', 'ROADMAP_INSTALLATION_ID', 'ROADMAP_APP_KEY'])('fails a read naming %s when it is not set', async (name) => {
    const deps = roadmapDeps(without(name), () => Promise.reject(new Error('nothing is sent')));
    await expect(deps.readBoard()).rejects.toThrow(`roadmap: ${name} is not set`);
  });

  it('is the object the Worker exports, built from the runtime’s ctx and env', async () => {
    expect(entry.Roadmap).toBe(Roadmap);
    const background: Promise<unknown>[] = [];
    const ctx = {
      storage: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
      acceptWebSocket: () => undefined,
      getWebSockets: () => [],
      waitUntil: (promise: Promise<unknown>) => background.push(promise),
    };
    const urls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      urls.push(url);
      return Promise.resolve(new Response('down', { status: 502 }));
    });
    const roadmap = new Roadmap(ctx, ENV);
    expect((await roadmap.fetch(new Request('https://roadmap/changed', { method: 'POST' }))).status).toBe(202);
    await Promise.all(background);
    expect((await roadmap.fetch(new Request('https://roadmap/snapshot'))).status).toBe(503);
    expect(urls).toEqual(Array(2).fill('https://api.github.com/app/installations/184830629/access_tokens'));
    vi.unstubAllGlobals();
  });
});
