import { describe, it, expect } from 'vitest';
import web, { CONTENT_SECURITY_POLICY, handle, type WebEnv } from '../../workers/web/src/index.ts';
import { DOOR_SECRET_HEADER } from '../../packages/environment/index.ts';

/**
 * The site's Worker (plan 3 Task 1, shyden-labs/ShyTalk#51): `/api/*` goes to
 * the API, everything else to the built pages; every answer carries the
 * security headers; TEST and DEV answer only through their door.
 */

const SECRET = 'the-door-secret';

/** An env whose ASSETS answers with `status` and records each path asked for. */
function env(environment: WebEnv['ENVIRONMENT_NAME'], status = 200): { env: WebEnv; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    env: {
      ENVIRONMENT_NAME: environment,
      DOOR_SECRET: SECRET,
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

describe('the entry', () => {
  it('is the default export fetch', async () => {
    const { env: e } = env('dev');
    expect((await web.fetch(request('/', null), e)).status).toBe(403);
  });
});
