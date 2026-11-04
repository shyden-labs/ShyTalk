import { describe, it, expect } from 'vitest';
import { CONTENT_SECURITY_POLICY, handle, type WebEnv } from '../../workers/web/src/web.ts';
import { json } from '../../workers/web/src/http.ts';
import { isAppApi } from '../../workers/web/src/app/router.ts';
import { DOOR_SECRET_HEADER, type D1Like } from '../../packages/environment/index.ts';

/**
 * The app's API door (plan 4 Task 1, shyden-labs/ShyTalk#74): `/api/app/*`
 * in the site's Worker, behind the same door and marker check, with the
 * site's security headers; the rest of `/api/*` stays plan 3's.
 */

const SECRET = 'the-door-secret';

/** A DB marked with `environment` (the marker check passes). */
const marked = (environment: string): D1Like => ({
  prepare: () => ({ first: <T>() => Promise.resolve({ name: environment } as T) }),
});

function env(environment: WebEnv['ENVIRONMENT_NAME']): WebEnv {
  return {
    ENVIRONMENT_NAME: environment,
    DOOR_SECRET: SECRET,
    DB: marked(environment),
    ASSETS: { fetch: () => Promise.resolve(new Response('page')) },
  };
}

const get = (path: string): Request => new Request(`https://site.example.test${path}`, { headers: { [DOOR_SECRET_HEADER]: SECRET } });

describe('/api/app/*', () => {
  it.each(['dev', 'test', 'prod'] as const)('health answers 200 naming %s, never cached', async (environment) => {
    const response = await handle(get('/api/app/health'), env(environment));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, environment });
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['/api/app/unknown', '/api/app/', '/api/app', '/api/app/health/extra'])('%s answers 404 not_found', async (path) => {
    const response = await handle(get(path), env('dev'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it.each(['/api/app/health', '/api/app/unknown'])('%s carries the site CSP and nosniff', async (path) => {
    const response = await handle(get(path), env('dev'));
    expect(response.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('answers only GET on health', async () => {
    const response = await handle(
      new Request('https://site.example.test/api/app/health', { method: 'POST', headers: { [DOOR_SECRET_HEADER]: SECRET } }),
      env('dev'),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('sits behind the door: no secret, 403', async () => {
    expect((await handle(new Request('https://site.example.test/api/app/health'), env('dev'))).status).toBe(403);
  });

  it('leaves /api/other to the site API, and /api/apps is not the app door', async () => {
    for (const path of ['/api/other', '/api/apps/health']) {
      const response = await handle(get(path), env('dev'));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});

// Later app routes depend on exactly which paths are the app's: `/api/app`
// and below, never a sibling such as `/api/apps`.
describe('isAppApi', () => {
  it.each(['/api/app', '/api/app/', '/api/app/health', '/api/app/a/b'])('%s is the app API', (path) => {
    expect(isAppApi(path)).toBe(true);
  });

  it.each(['/api/apps', '/api/apple', '/api/application/x', '/api/other', '/app/health', '/api'])('%s is not', (path) => {
    expect(isAppApi(path)).toBe(false);
  });
});

describe('json', () => {
  it('answers JSON, not cached, by default', async () => {
    const response = json(201, { a: 1 });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ a: 1 });
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('etag')).toBeNull();
  });

  it('with an ETag, sets it and leaves caching to the caller', () => {
    const response = json(200, {}, '"v7"');
    expect(response.headers.get('etag')).toBe('"v7"');
    expect(response.headers.get('cache-control')).toBeNull();
  });
});
