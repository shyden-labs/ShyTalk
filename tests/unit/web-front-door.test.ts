import { describe, it, expect } from 'vitest';
import web from '../../workers/web/src/index.ts';
import { CONTENT_SECURITY_POLICY, handle, type WebEnv } from '../../workers/web/src/web.ts';
import { DOOR_SECRET_HEADER, type D1Like } from '../../packages/environment/index.ts';

/**
 * The site's Worker (plan 3 Task 1, shyden-labs/ShyTalk#51): `/api/*` goes to
 * the API, everything else to the built pages; every answer carries the
 * security headers; TEST and DEV answer only through their door.
 */

const SECRET = 'the-door-secret';

/**
 * A `DB` whose environment marker reads `marker` (null: no row), counting each
 * read, so a test can see the marker is read once per guard.
 */
function database(marker: string | null): { db: D1Like; reads: () => number } {
  let reads = 0;
  return {
    reads: () => reads,
    db: {
      prepare: () => ({
        first: <T>() => {
          reads += 1;
          return Promise.resolve((marker === null ? null : { name: marker }) as T | null);
        },
      }),
    },
  };
}

/** An env whose ASSETS answers with `status` and records each path asked for; its `DB` marks `marker`. */
function env(
  environment: WebEnv['ENVIRONMENT_NAME'],
  status = 200,
  marker: string | null = environment,
): { env: WebEnv; asked: string[]; reads: () => number } {
  const asked: string[] = [];
  const { db, reads } = database(marker);
  return {
    asked,
    reads,
    env: {
      ENVIRONMENT_NAME: environment,
      DOOR_SECRET: SECRET,
      DB: db,
      ASSETS: {
        fetch: (request: Request) => {
          asked.push(new URL(request.url).pathname);
          return Promise.resolve(new Response('<html></html>', { status, headers: { 'content-type': 'text/html' } }));
        },
      },
    },
  };
}

const request = (path: string, secret: string | null = SECRET): Request =>
  new Request(`https://site.example.test${path}`, { headers: secret === null ? {} : { [DOOR_SECRET_HEADER]: secret } });

describe('routing', () => {
  it('hands the closed-testing form a full D1, whose own route rules then answer', async () => {
    const { env: e } = env('dev');
    const response = await handle(request('/api/closed-testing'), {
      ...e,
      DB: { ...(e.DB as D1Like), batch: () => Promise.resolve([]) } as D1Like,
    });
    expect(response.status).toBe(405);
  });

  // A marker-only DB is not a full D1, so the form answers 503: reaching it at all is what this shows.
  it.each(['/api/closed-testing', '/api/closed-testing/confirm'])('sends %s to the closed-testing form', async (path) => {
    const { env: e, asked } = env('dev');
    const response = await handle(
      new Request(`https://site.example.test${path}`, { method: 'POST', headers: { [DOOR_SECRET_HEADER]: SECRET } }),
      e,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ state: 'send_failed' });
    expect(asked).toEqual([]);
  });

  it('sends /api/* to the API, which answers 404 JSON for now', async () => {
    const { env: e, asked } = env('dev');
    const response = await handle(request('/api/x'), e);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(asked).toEqual([]);
  });

  it.each(['/', '/id/', '/roadmap', '/apis'])('sends %s to the built pages', async (path) => {
    const { env: e, asked } = env('dev');
    expect((await handle(request(path), e)).status).toBe(200);
    expect(asked).toEqual([path]);
  });

  it("passes the pages' own 404 through", async () => {
    const { env: e } = env('dev', 404);
    expect((await handle(request('/nothing'), e)).status).toBe(404);
  });
});

describe('headers', () => {
  it('allow nothing but the site itself', () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
    );
  });

  it.each(['/', '/api/x', '/nothing'])('are on every answer: %s', async (path) => {
    const { env: e } = env('dev', path === '/nothing' ? 404 : 200);
    const response = await handle(request(path), e);
    expect(response.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});

describe('the door', () => {
  it.each(['dev', 'test'] as const)('%s refuses a request without the door secret (403), before any page', async (environment) => {
    const { env: e, asked } = env(environment);
    const response = await handle(request('/', null), e);
    expect(response.status).toBe(403);
    expect(response.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(asked).toEqual([]);
  });

  it('dev refuses a wrong secret', async () => {
    const { env: e } = env('dev');
    expect((await handle(request('/', 'wrong'), e)).status).toBe(403);
  });

  it('prod has no door and answers without a secret', async () => {
    const { env: e } = env('prod');
    expect((await handle(request('/', null), e)).status).toBe(200);
  });

  it('refuses everything when the environment is not named, failing closed', async () => {
    const { env: e, asked } = env('dev');
    const unnamed = { ...e, ENVIRONMENT_NAME: undefined } as unknown as WebEnv;
    expect((await handle(request('/'), unnamed)).status).toBe(503);
    expect(asked).toEqual([]);
  });
});

// Plan 4 Task 2 (shyden-labs/ShyTalk#75): after the door, every request checks
// that `DB` names this environment, PROD included, so no Worker serves from
// another environment's database.
describe('the environment marker', () => {
  it.each([
    ['dev', 'prod'],
    ['test', 'dev'],
    ['prod', 'dev'],
  ] as const)('%s whose DB marks %s answers 503 and serves nothing', async (environment, marker) => {
    const { env: e, asked } = env(environment, 200, marker);
    const response = await handle(request('/'), e);
    expect(response.status).toBe(503);
    expect(response.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(asked).toEqual([]);
  });

  it('answers 503 when DB has no marker row', async () => {
    const { env: e, asked } = env('dev', 200, null);
    expect((await handle(request('/'), e)).status).toBe(503);
    expect(asked).toEqual([]);
  });

  it('answers 503 when the DB binding is missing, failing closed', async () => {
    const { env: e, asked } = env('dev');
    const unbound = { ...e, DB: undefined } as unknown as WebEnv;
    expect((await handle(request('/'), unbound)).status).toBe(503);
    expect(asked).toEqual([]);
  });

  it('answers 503 to the API too, when the marker is wrong', async () => {
    const { env: e } = env('dev', 200, 'prod');
    expect((await handle(request('/api/x'), e)).status).toBe(503);
  });

  it('serves when the marker matches, reading it once for the guard', async () => {
    const { env: e, asked, reads } = env('dev');
    expect((await handle(request('/'), e)).status).toBe(200);
    expect((await handle(request('/id/'), e)).status).toBe(200);
    expect(asked).toEqual(['/', '/id/']);
    expect(reads()).toBe(1);
  });

  it('keeps one guard per DB, so a pass for one database never stands for another', async () => {
    const good = env('dev');
    expect((await handle(request('/'), good.env)).status).toBe(200);
    const bad = env('dev', 200, 'prod');
    expect((await handle(request('/'), bad.env)).status).toBe(503);
    expect(bad.reads()).toBe(1);
  });

  it('checks the door before the marker: a request without the secret reads nothing', async () => {
    const { env: e, reads } = env('dev');
    expect((await handle(request('/', null), e)).status).toBe(403);
    expect(reads()).toBe(0);
  });
});

describe('the entry', () => {
  it('is the default export fetch', async () => {
    const { env: e } = env('dev');
    expect((await web.fetch(request('/', null), e)).status).toBe(403);
  });
});
