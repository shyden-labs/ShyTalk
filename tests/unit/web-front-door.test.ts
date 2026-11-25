import { describe, it, expect, vi, afterEach } from 'vitest';
import web from '../../workers/web/src/index.ts';
import { CONTENT_SECURITY_POLICY, handle, type WebEnv } from '../../workers/web/src/web.ts';
import { DOOR_SECRET_HEADER, SITE_PASSWORD_HEADER, SITE_USER, type D1Like } from '../../packages/environment/index.ts';

/**
 * The site's Worker (plan 3 Task 1, shyden-labs/ShyTalk#51): `/api/*` goes to
 * the API, everything else to the built pages; every answer carries the
 * security headers; TEST and DEV answer only through their door.
 */

const SECRET = 'the-door-secret';
const PASSWORD = 'the-site-password';
/** The browser box's answer for `password`. */
const BOX = (password: string): string => `Basic ${btoa(`${SITE_USER}:${password}`)}`;

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
      SITE_PASSWORD: PASSWORD,
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

/** A request through the door (`secret`) with the site password in the box (`password`); null leaves either out. */
const request = (path: string, secret: string | null = SECRET, password: string | null = PASSWORD): Request =>
  new Request(`https://site.example.test${path}`, {
    headers: {
      ...(secret === null ? {} : { [DOOR_SECRET_HEADER]: secret }),
      ...(password === null ? {} : { authorization: BOX(password) }),
    },
  });

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
      new Request(`https://site.example.test${path}`, {
        method: 'POST',
        headers: { [DOOR_SECRET_HEADER]: SECRET, authorization: BOX(PASSWORD) },
      }),
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

// shyden-labs/ShyTalk#262: after the door, dev and test ask for the site password with the browser's
// own box; production never does.
describe('the site password', () => {
  it.each(['dev', 'test'] as const)('%s asks with the box (401) before any page or API, reading no database', async (environment) => {
    for (const path of ['/', '/id/', '/api/x', '/api/app/health']) {
      const { env: e, asked, reads } = env(environment);
      const response = await handle(request(path, SECRET, null), e);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe(`Basic realm="ShyTalk ${environment}", charset="UTF-8"`);
      expect(response.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
      expect(asked).toEqual([]);
      expect(reads()).toBe(0);
    }
  });

  it.each(['dev', 'test'] as const)('%s refuses a wrong password', async (environment) => {
    const { env: e, asked } = env(environment);
    expect((await handle(request('/', SECRET, 'wrong'), e)).status).toBe(401);
    expect(asked).toEqual([]);
  });

  it.each(['dev', 'test'] as const)('%s serves with the right password in the box', async (environment) => {
    const { env: e, asked } = env(environment);
    expect((await handle(request('/', SECRET, PASSWORD), e)).status).toBe(200);
    expect(asked).toEqual(['/']);
  });

  it('dev serves a caller giving the password in its header beside a bearer token', async () => {
    const { env: e } = env('dev');
    const response = await handle(
      new Request('https://site.example.test/api/x', {
        headers: { [DOOR_SECRET_HEADER]: SECRET, [SITE_PASSWORD_HEADER]: PASSWORD, authorization: 'Bearer a-session' },
      }),
      e,
    );
    expect(response.status).toBe(404);
  });

  it('refuses everything when dev has no password configured, failing closed', async () => {
    const { env: e, asked } = env('dev');
    const unset: WebEnv = { ...e };
    delete unset.SITE_PASSWORD;
    expect((await handle(request('/'), unset)).status).toBe(401);
    expect(asked).toEqual([]);
  });

  it('checks the door first: without the door secret the answer is 403, never the box', async () => {
    const { env: e } = env('dev');
    expect((await handle(request('/', null, null), e)).status).toBe(403);
  });

  it('prod never asks, even with no password configured', async () => {
    const { env: e } = env('prod');
    const unset: WebEnv = { ...e };
    delete unset.SITE_PASSWORD;
    const response = await handle(request('/', null, null), unset);
    expect(response.status).toBe(200);
    expect(response.headers.get('www-authenticate')).toBeNull();
  });
});

// shyden-labs/ShyTalk#263: the partner site's link opens dev with a one-use pass.
describe('the dev pass', () => {
  const PASS_SECRET = 'test-secret-not-real';
  /** The partner's own test vector, valid at 1763520000 for DEV's host. */
  const TOKEN =
    'eyJ2IjoxLCJob3N0IjoiZGV2LnNoeXRhbGsuYXBwIiwiZXhwIjoxNzYzNTIwMDYwLCJub25jZSI6IkFBRUNBd1FGQmdjSUNRb0xEQTBPRHcifQ.IpAei1Y9PFgTJDbfWLP6m6AH_6KxCOc1P6L9w0CFS5c';

  /** The host the vector was minted for, read from its own payload. */
  const HOST = (JSON.parse(atob((TOKEN.split('.')[0] ?? '').replaceAll('-', '+').replaceAll('_', '/'))) as { host: string }).host;

  afterEach(() => {
    vi.useRealTimers();
  });

  /** `environment`'s env with a database that answers the marker and records nonces, at the vector's mint time. */
  function passEnv(environment: WebEnv['ENVIRONMENT_NAME']): { env: WebEnv; asked: string[]; nonces: string[] } {
    vi.useFakeTimers({ now: 1763520000 * 1000, toFake: ['Date'] });
    const { env: e, asked } = env(environment);
    const nonces: string[] = [];
    const statement = (sql: string, values: unknown[] = []) => ({
      sql,
      values,
      bind: (...bound: unknown[]) => statement(sql, bound),
      first: <T>() => Promise.resolve({ name: environment } as T),
    });
    const db = {
      prepare: (sql: string) => statement(sql),
      batch: (batch: { sql: string; values: unknown[] }[]) =>
        Promise.resolve(
          batch.map(({ sql, values }) => {
            if (!sql.startsWith('INSERT')) return { meta: { changes: 0 }, results: [] };
            const [nonce] = values as [string];
            if (nonces.includes(nonce)) return { meta: { changes: 0 }, results: [] };
            nonces.push(nonce);
            return { meta: { changes: 1 }, results: [] };
          }),
        ),
    };
    return {
      env: {
        ...e,
        DB: db,
        SITE_ORIGIN: environment === 'dev' ? `https://${HOST}` : 'https://site.example.test',
        DEV_PASS_SECRET: PASS_SECRET,
      },
      asked,
      nonces,
    };
  }

  it('dev takes a valid pass in place of the box once, then the cookie it sets serves pages', async () => {
    const { env: e, asked, nonces } = passEnv('dev');
    const first = await handle(request(`/?dev_pass=${TOKEN}`, SECRET, null), e);
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe('/');
    expect(first.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(asked).toEqual([]);
    expect(nonces).toEqual(['AAECAwQFBgcICQoLDA0ODw']);
    const [cookie = ''] = (first.headers.get('set-cookie') ?? '').split(';');
    const page = await handle(new Request('https://site.example.test/', { headers: { [DOOR_SECRET_HEADER]: SECRET, cookie } }), e);
    expect(page.status).toBe(200);
    expect(asked).toEqual(['/']);
  });

  it('dev asks with the box when the same pass comes a second time', async () => {
    const { env: e } = passEnv('dev');
    await handle(request(`/?dev_pass=${TOKEN}`, SECRET, null), e);
    const again = await handle(request(`/?dev_pass=${TOKEN}`, SECRET, null), e);
    expect(again.status).toBe(401);
    expect(again.headers.get('www-authenticate')).toBe('Basic realm="ShyTalk dev", charset="UTF-8"');
  });

  it('checks the door first: a pass without the door secret is refused with 403 and not recorded', async () => {
    const { env: e, nonces } = passEnv('dev');
    expect((await handle(request(`/?dev_pass=${TOKEN}`, null, null), e)).status).toBe(403);
    expect(nonces).toEqual([]);
  });

  it('test reads no pass and takes no pass cookie, asking with the box', async () => {
    const { env: e, nonces } = passEnv('test');
    const answer = await handle(request(`/?dev_pass=${TOKEN}`, SECRET, null), e);
    expect(answer.status).toBe(401);
    expect(answer.headers.get('set-cookie')).toBeNull();
    expect(nonces).toEqual([]);
    const { env: dev } = passEnv('dev');
    const [cookie = ''] = ((await handle(request(`/?dev_pass=${TOKEN}`, SECRET, null), dev)).headers.get('set-cookie') ?? '').split(';');
    const withCookie = await handle(new Request('https://site.example.test/', { headers: { [DOOR_SECRET_HEADER]: SECRET, cookie } }), e);
    expect(withCookie.status).toBe(401);
  });

  // WebKit sends no box answer on a WebSocket upgrade, so the roadmap's live socket needs the cookie (shyden-labs/ShyTalk#321).
  it('dev answering the box sets the site pass cookie, which alone then passes the gate', async () => {
    const { env: e, asked } = passEnv('dev');
    const answered = await handle(request('/'), e);
    expect(answered.status).toBe(200);
    const line = answered.headers.get('set-cookie') ?? '';
    expect(line).toMatch(/^shytalk_site_pass=\d+\.[\w-]+; Path=\/; Max-Age=43200; Secure; HttpOnly; SameSite=Lax$/u);
    const [cookie = ''] = line.split(';');
    const page = await handle(new Request('https://site.example.test/', { headers: { [DOOR_SECRET_HEADER]: SECRET, cookie } }), e);
    expect(page.status).toBe(200);
    expect(page.headers.get('set-cookie')).toBeNull();
    expect(asked).toEqual(['/', '/']);
  });

  it('dev sets no cookie on a refused box, nor without its pass key', async () => {
    const { env: e } = passEnv('dev');
    const refused = await handle(request('/', SECRET, 'a-wrong-password'), e);
    expect(refused.status).toBe(401);
    expect(refused.headers.get('set-cookie')).toBeNull();
    const keyless = await handle(request('/'), (({ DEV_PASS_SECRET: _key, ...rest }) => rest)(e));
    expect(keyless.status).toBe(200);
    expect(keyless.headers.get('set-cookie')).toBeNull();
  });

  it('dev mints no new cookie for a request let through on its cookie, whatever else it carries', async () => {
    const { env: e } = passEnv('dev');
    const [cookie = ''] = ((await handle(request('/'), e)).headers.get('set-cookie') ?? '').split(';');
    for (const extra of [
      { authorization: 'Bearer a-token' },
      { authorization: BOX('a-wrong-password') },
      { [SITE_PASSWORD_HEADER]: 'wrong' },
    ]) {
      const page = await handle(
        new Request('https://site.example.test/', { headers: { [DOOR_SECRET_HEADER]: SECRET, cookie, ...extra } }),
        e,
      );
      expect(page.status).toBe(200);
      expect(page.headers.get('set-cookie')).toBeNull();
    }
  });

  it('test answering the box sets no cookie', async () => {
    const { env: e } = passEnv('test');
    const answered = await handle(request('/'), e);
    expect(answered.status).toBe(200);
    expect(answered.headers.get('set-cookie')).toBeNull();
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
