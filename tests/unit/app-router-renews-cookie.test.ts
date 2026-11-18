import { describe, expect, it, vi } from 'vitest';
import { handle, type WebEnv } from '../../workers/web/src/web.ts';
import { DOOR_SECRET_HEADER, SITE_PASSWORD_HEADER } from '../../packages/environment/index.ts';
import { renewSessionCookie } from '../../workers/web/src/app/renew-session-cookie.ts';

vi.mock('../../workers/web/src/app/renew-session-cookie.ts', () => ({
  renewSessionCookie: vi.fn((_request: Request, answer: Response) => {
    const renewed = new Response(answer.body, answer);
    renewed.headers.set('x-renewed', 'yes');
    return Promise.resolve(renewed);
  }),
}));

/**
 * Every `/api/app/*` answer passes through the session cookie's renewal (shyden-labs/ShyTalk#184) once sign-in is
 * configured; the renewal itself is tests/unit/renew-session-cookie.test.ts, stood in here.
 */

const SECRET = 'the-door-secret';
const PASSWORD = 'the-site-password';

/** A D1 stand-in marked `dev`: the marker check passes and nothing else is asked of it on these routes. */
const db = {
  prepare: () => ({ first: <T>() => Promise.resolve({ name: 'dev' } as T) }),
  batch: () => Promise.resolve([]),
  exec: () => Promise.resolve({ count: 0, duration: 0 }),
};

const base: WebEnv = {
  ENVIRONMENT_NAME: 'dev',
  DOOR_SECRET: SECRET,
  SITE_PASSWORD: PASSWORD,
  DB: db,
  ASSETS: { fetch: () => Promise.resolve(new Response('page')) },
};

const signInReady: WebEnv = {
  ...base,
  SITE_ORIGIN: 'https://site.example.test',
  BETTER_AUTH_SECRET: 'a-test-secret-that-is-long-enough-for-better-auth',
  GOOGLE_CLIENT_IDS: 'g',
  APPLE_AUDIENCES: 'a',
  SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: true }) },
};

const get = (path: string): Request =>
  new Request(`https://site.example.test${path}`, { headers: { [DOOR_SECRET_HEADER]: SECRET, [SITE_PASSWORD_HEADER]: PASSWORD } });

describe('the app API renews the session cookie', () => {
  it.each(['/api/app/health', '/api/app/unknown'])('passes %s through the renewal, with the request and the answer', async (path) => {
    vi.mocked(renewSessionCookie).mockClear();
    const request = get(path);
    const response = await handle(request, signInReady);
    expect(response.headers.get('x-renewed')).toBe('yes');
    expect(vi.mocked(renewSessionCookie)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renewSessionCookie).mock.calls[0]?.[0]).toBe(request);
  });

  it('renews nothing where sign-in is not configured', async () => {
    vi.mocked(renewSessionCookie).mockClear();
    const response = await handle(get('/api/app/health'), base);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-renewed')).toBeNull();
    expect(vi.mocked(renewSessionCookie)).not.toHaveBeenCalled();
  });

  it('leaves the site API and pages alone', async () => {
    vi.mocked(renewSessionCookie).mockClear();
    await handle(get('/'), signInReady);
    await handle(get('/api/closed-testing/unknown'), signInReady);
    expect(vi.mocked(renewSessionCookie)).not.toHaveBeenCalled();
  });
});
