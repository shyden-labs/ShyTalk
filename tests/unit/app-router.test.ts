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

// Sign-in (plan 4 Task 3, shyden-labs/ShyTalk#76) is reached through the
// router only when the Worker has everything it needs; otherwise it fails
// closed. The flows themselves are tested in app-sign-in.test.ts.
describe('/api/app/sign-in and sign-out', () => {
  /** A full Worker env: a D1-shaped DB, Better Auth's settings and the rate limit. */
  const ready = (): WebEnv => ({
    ...env('dev'),
    DB: {
      prepare: () => ({ first: <T>() => Promise.resolve({ name: 'dev' } as T), bind: () => ({}) }),
      batch: () => Promise.resolve([]),
      exec: () => Promise.resolve({}),
    } as D1Like,
    SITE_ORIGIN: 'https://site.example.test',
    BETTER_AUTH_SECRET: 'a-test-secret-that-is-long-enough-for-better-auth',
    GOOGLE_CLIENT_IDS: 'web.apps.googleusercontent.com',
    APPLE_AUDIENCES: 'com.shyden.shytalk',
    SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: true }) },
  });
  const postTo = (path: string, body: string): Request =>
    new Request(`https://site.example.test${path}`, { method: 'POST', body, headers: { [DOOR_SECRET_HEADER]: SECRET } });

  it.each(['/api/app/sign-in/google', '/api/app/sign-in/apple'])(
    '%s reaches the sign-in handler (a bad body answers 400)',
    async (path) => {
      const response = await handle(postTo(path, '{'), ready());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'bad_request' });
      expect(response.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    },
  );

  it('/api/app/sign-out reaches the sign-out handler (GET answers 405)', async () => {
    const response = await handle(get('/api/app/sign-out'), ready());
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it.each([
    ['SITE_ORIGIN', { SITE_ORIGIN: undefined }],
    ['BETTER_AUTH_SECRET', { BETTER_AUTH_SECRET: undefined }],
    ['GOOGLE_CLIENT_IDS', { GOOGLE_CLIENT_IDS: undefined }],
    ['APPLE_AUDIENCES', { APPLE_AUDIENCES: undefined }],
    ['SIGN_IN_LIMIT', { SIGN_IN_LIMIT: undefined }],
    [
      'a DB without batch',
      { DB: { prepare: () => ({ first: <T>() => Promise.resolve({ name: 'dev' } as T) }), exec: () => Promise.resolve({}) } as D1Like },
    ],
    [
      'a DB without exec',
      { DB: { prepare: () => ({ first: <T>() => Promise.resolve({ name: 'dev' } as T) }), batch: () => Promise.resolve([]) } as D1Like },
    ],
  ])('without %s, sign-in and sign-out answer 503 sign_in_unavailable', async (_name, missing) => {
    const partial = { ...ready(), ...missing } as WebEnv;
    for (const path of ['/api/app/sign-in/google', '/api/app/sign-in/apple', '/api/app/sign-out']) {
      const response = await handle(postTo(path, '{}'), partial);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'sign_in_unavailable' });
    }
  });

  it.each(['/api/app/sign-in', '/api/app/sign-in/github', '/api/app/sign-in/google/extra'])('%s is not a route: 404', async (path) => {
    const response = await handle(postTo(path, '{}'), ready());
    expect(response.status).toBe(404);
  });
});

// The UI document (plan 4 Task 6, shyden-labs/ShyTalk#79) is read from D1;
// tests/integration/app-ui runs the real table.
describe('/api/app/ui', () => {
  /** A D1 stand-in: marked dev, answering `row` to the UI query. */
  const withUi = (row: unknown): WebEnv => ({
    ...env('dev'),
    DB: {
      prepare: () => ({
        first: <T>() => Promise.resolve({ name: 'dev' } as T),
        bind: () => ({ all: () => Promise.resolve({ results: [row] }) }),
      }),
      batch: () => Promise.resolve([]),
      exec: () => Promise.resolve({}),
    } as unknown as D1Like,
  });

  it('answers the stored everyone version with its ETag, behind the site headers', async () => {
    const row = {
      version: 7,
      body: '{"schemaVersion":1}',
      audience: 'everyone',
      share: null,
      undoes: null,
      publishedAt: 1,
      publishedBy: 'ci:deploy-dev',
    };
    const response = await handle(get('/api/app/ui'), withUi(row));
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"7"');
    expect(await response.text()).toBe('{"schemaVersion":1}');
    expect(response.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
  });

  it('answers 503 ui_unavailable when the DB is not a D1 database', async () => {
    const response = await handle(get('/api/app/ui'), env('dev'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'ui_unavailable' });
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
