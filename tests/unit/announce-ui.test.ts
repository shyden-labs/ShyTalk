import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { main, announceOrigin } from '../../scripts/announce-ui.ts';
import { DOOR_SECRET_HEADER } from '../../packages/environment/index.ts';

/**
 * The deploy's announcement (plan 4 Task 8, shyden-labs/ShyTalk#81; Shyden's
 * choice 2026-11-07, a secret endpoint): after the Worker deploys with a fresh
 * announce secret, this script calls `POST /api/app/live/announce` on the
 * environment's own origin, so every open app hears the newest version. A
 * machine skips the doors (decision 197): DEV and TEST are called at their
 * workers.dev origins with the door secret, PROD at its site origin.
 */

const files: Record<string, string> = {
  'workers/web/wrangler.json': readFileSync('workers/web/wrangler.json', 'utf8'),
  'workers/door/wrangler.json': readFileSync('workers/door/wrangler.json', 'utf8'),
};
const read = (path: string): string => {
  const text = files[path];
  if (text === undefined) throw new Error(`read an unexpected file: ${path}`);
  return text;
};

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(answer: Response) {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(answer);
    },
  };
}

const settings = { ANNOUNCE_ENVIRONMENT: 'dev', ANNOUNCE_SECRET: 'fresh-secret', DOOR_SECRET: 'the-door-secret' };

describe('announce-ui', () => {
  it.each([
    ['dev', 'https://shytalk-dev.shytalk-non-prod.workers.dev'],
    ['test', 'https://shytalk-test.shytalk-non-prod.workers.dev'],
    ['prod', 'https://shytalk.app'],
  ])('calls %s at %s, never through a door', (environment, origin) => {
    expect(announceOrigin(read, environment)).toBe(origin);
  });

  it('fails naming the environment the door config gives no origin', () => {
    const empty = (path: string): string => (path === 'workers/door/wrangler.json' ? '{"env":{"dev":{"vars":{}}}}' : read(path));
    expect(() => announceOrigin(empty, 'dev')).toThrow('announce-ui: workers/door/wrangler.json gives dev no ORIGIN');
  });

  it('fails naming the environment the site config gives no origin', () => {
    const empty = (path: string): string => (path === 'workers/web/wrangler.json' ? '{"env":{"prod":{"vars":{}}}}' : read(path));
    expect(() => announceOrigin(empty, 'prod')).toThrow('announce-ui: workers/web/wrangler.json gives prod no SITE_ORIGIN');
  });

  it('posts to the environment origin with the secret as a bearer token and prints the version announced', async () => {
    const fake = fakeFetch(new Response(JSON.stringify({ announced: 6 }), { status: 200 }));
    const lines: string[] = [];
    expect(await main([], settings, read, fake.fetch, (line) => lines.push(line))).toBe(0);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe('https://shytalk-dev.shytalk-non-prod.workers.dev/api/app/live/announce');
    expect(fake.calls[0]?.init?.method).toBe('POST');
    const headers = new Headers(fake.calls[0]?.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer fresh-secret');
    expect(headers.get(DOOR_SECRET_HEADER)).toBe('the-door-secret');
    expect(lines).toEqual(['announce-ui: dev announced UI version 6']);
  });

  it('sends PROD no door secret, as PROD has no door', async () => {
    const fake = fakeFetch(new Response(JSON.stringify({ announced: 6 }), { status: 200 }));
    await main([], { ANNOUNCE_ENVIRONMENT: 'prod', ANNOUNCE_SECRET: 'fresh-secret' }, read, fake.fetch, () => undefined);
    expect(fake.calls[0]?.url).toBe('https://shytalk.app/api/app/live/announce');
    expect(new Headers(fake.calls[0]?.init?.headers).has(DOOR_SECRET_HEADER)).toBe(false);
  });

  it.each(['dev', 'test'])('fails naming DOOR_SECRET when %s has none, calling nothing', async (environment) => {
    const fake = fakeFetch(new Response(null, { status: 200 }));
    await expect(
      main([], { ANNOUNCE_ENVIRONMENT: environment, ANNOUNCE_SECRET: 'fresh-secret' }, read, fake.fetch, () => undefined),
    ).rejects.toThrow(`announce-ui: missing DOOR_SECRET, which ${environment} needs`);
    expect(fake.calls).toEqual([]);
  });

  it('fails naming the status and the error when the Worker refuses', async () => {
    const fake = fakeFetch(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
    await expect(main([], settings, read, fake.fetch, () => undefined)).rejects.toThrow('announce-ui: dev answered 401 unauthorized');
  });

  it('fails naming the status when the answer is not JSON', async () => {
    const fake = fakeFetch(new Response('Bad Gateway', { status: 502 }));
    await expect(main([], settings, read, fake.fetch, () => undefined)).rejects.toThrow('announce-ui: dev answered 502');
  });

  it('fails when a 200 names no version', async () => {
    const fake = fakeFetch(new Response(JSON.stringify({}), { status: 200 }));
    await expect(main([], settings, read, fake.fetch, () => undefined)).rejects.toThrow('announce-ui: dev answered 200 without a version');
  });

  it('fails naming every missing setting, calling nothing', async () => {
    const fake = fakeFetch(new Response(null, { status: 200 }));
    await expect(main([], {}, read, fake.fetch, () => undefined)).rejects.toThrow(
      'announce-ui: missing ANNOUNCE_ENVIRONMENT, ANNOUNCE_SECRET',
    );
    expect(fake.calls).toEqual([]);
  });

  it('refuses an environment that is not dev, test or prod', async () => {
    const fake = fakeFetch(new Response(null, { status: 200 }));
    await expect(main([], { ...settings, ANNOUNCE_ENVIRONMENT: 'staging' }, read, fake.fetch, () => undefined)).rejects.toThrow(
      'announce-ui: ANNOUNCE_ENVIRONMENT must be dev, test or prod, not staging',
    );
    expect(fake.calls).toEqual([]);
  });

  it('takes no arguments', async () => {
    const fake = fakeFetch(new Response(null, { status: 200 }));
    await expect(main(['dev'], settings, read, fake.fetch, () => undefined)).rejects.toThrow('usage: node scripts/announce-ui.ts');
  });
});
