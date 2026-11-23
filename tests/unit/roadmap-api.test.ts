import { describe, it, expect } from 'vitest';
import { handle, type WebEnv } from '../../workers/web/src/web.ts';
import { DOOR_SECRET_HEADER, type D1Like } from '../../packages/environment/index.ts';

/**
 * The roadmap's two public addresses (shyden-labs/ShyTalk#321 AC3 and AC4), as Yawelo Idle serves its own:
 * `GET /api/roadmap.json` answers the Durable Object's snapshot at once, never cached, and `/api/roadmap/live` hands
 * a WebSocket to it. Each sits behind the site's own guards: on DEV the password, on PROD nothing while it is open.
 */

const db = (environment: string): D1Like => ({
  prepare: () => ({ first: <T>() => Promise.resolve({ name: environment } as T) }),
});

function setup(environment: WebEnv['ENVIRONMENT_NAME'], answer = () => Response.json({ version: 4, milestones: [] })) {
  const told: string[] = [];
  const env: WebEnv = {
    ENVIRONMENT_NAME: environment,
    DOOR_SECRET: 'the-door-secret',
    SITE_PASSWORD: 'the-site-password',
    DB: db(environment),
    ASSETS: { fetch: () => Promise.resolve(new Response('page')) },
    ROADMAP: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (request: Request) => {
          told.push(`${request.method} ${new URL(request.url).pathname} ${request.headers.get('upgrade') ?? '-'}`);
          return Promise.resolve(answer());
        },
      }),
    },
  };
  return { env, told };
}

const at = (path: string, init: RequestInit = {}) => new Request(`https://shytalk.app${path}`, init);

describe('the roadmap’s public addresses', () => {
  it('answers GET /api/roadmap.json with the object’s snapshot, never cached', async () => {
    const { env, told } = setup('prod');
    const answer = await handle(at('/api/roadmap.json'), env);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(await answer.json()).toEqual({ version: 4, milestones: [] });
    expect(told).toEqual(['GET /snapshot -']);
  });

  it('passes the object’s 503 on when it holds nothing and cannot read', async () => {
    const { env } = setup('prod', () => Response.json({ error: 'roadmap_unavailable' }, { status: 503 }));
    const answer = await handle(at('/api/roadmap.json'), env);
    expect([answer.status, await answer.json()]).toEqual([503, { error: 'roadmap_unavailable' }]);
  });

  it('takes GET only on /api/roadmap.json', async () => {
    const { env, told } = setup('prod');
    const answer = await handle(at('/api/roadmap.json', { method: 'POST' }), env);
    expect([answer.status, answer.headers.get('allow')]).toEqual([405, 'GET']);
    expect(told).toEqual([]);
  });

  it('hands a WebSocket upgrade on /api/roadmap/live to the object, and refuses anything else', async () => {
    const { env, told } = setup('prod', () => new Response(null, { status: 200, headers: { 'x-from': 'roadmap' } }));
    const live = await handle(at('/api/roadmap/live', { headers: { upgrade: 'websocket' } }), env);
    expect(live.headers.get('x-from')).toBe('roadmap');
    expect(told).toEqual(['GET /connect websocket']);
    const plain = await handle(at('/api/roadmap/live'), env);
    expect([plain.status, await plain.json()]).toEqual([400, { error: 'websocket_required' }]);
    expect(told).toHaveLength(1);
  });

  it('answers 503 when the Worker has no roadmap object', async () => {
    const { env } = setup('prod');
    Reflect.deleteProperty(env, 'ROADMAP');
    const answer = await handle(at('/api/roadmap.json'), env);
    expect([answer.status, await answer.json()]).toEqual([503, { error: 'roadmap_unavailable' }]);
  });

  it('asks for DEV’s password before the object is reached', async () => {
    const { env, told } = setup('dev');
    const answer = await handle(at('/api/roadmap.json', { headers: { [DOOR_SECRET_HEADER]: 'the-door-secret' } }), env);
    expect(answer.status).toBe(401);
    expect(told).toEqual([]);
  });
});
