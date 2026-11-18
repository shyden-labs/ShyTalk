import { describe, it, expect } from 'vitest';
import { devPassGate, type DevPassEnv } from '../../workers/web/src/dev-pass-gate.ts';
import { SITE_PASS_COOKIE, SITE_PASS_SECONDS, requireSitePassword } from '../../packages/environment/index.ts';

/**
 * The partner site's link into dev (shyden-labs/ShyTalk#263): a request
 * carrying `?dev_pass=` on dev. A valid pass, used for the first time, sets the
 * site pass cookie and sends the browser to the same address without the pass;
 * any other pass gets the password box, and once the box is answered the pass
 * is dropped from the address the same way. Test and production read no pass.
 */

const SECRET = 'test-secret-not-real';
const PASSWORD = 'the-site-password';
const NOW = 1763520000;
const TOKEN =
  'eyJ2IjoxLCJob3N0IjoiZGV2LnNoeXRhbGsuYXBwIiwiZXhwIjoxNzYzNTIwMDYwLCJub25jZSI6IkFBRUNBd1FGQmdjSUNRb0xEQTBPRHcifQ.IpAei1Y9PFgTJDbfWLP6m6AH_6KxCOc1P6L9w0CFS5c';
const NONCE = 'AAECAwQFBgcICQoLDA0ODw';
const EXP = 1763520060;
/** The host the vector was minted for, read from its own payload. */
const HOST = (JSON.parse(atob((TOKEN.split('.')[0] ?? '').replaceAll('-', '+').replaceAll('_', '/'))) as { host: string }).host;

interface Recorded {
  sql: string;
  values: unknown[];
}

/** A D1 stand-in remembering used nonces, recording each statement; `fail` makes every batch throw. */
function database(fail = false): { db: NonNullable<DevPassEnv['DB']>; statements: Recorded[]; used: Set<string> } {
  const statements: Recorded[] = [];
  const used = new Set<string>();
  return {
    statements,
    used,
    db: {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({ sql, values }),
      }),
      batch: (batch: unknown[]) => {
        if (fail) return Promise.reject(new Error('D1 is down'));
        return Promise.resolve(
          (batch as Recorded[]).map((statement) => {
            statements.push(statement);
            if (!statement.sql.startsWith('INSERT')) return { meta: { changes: 0 } };
            const [nonce] = statement.values as [string];
            if (used.has(nonce)) return { meta: { changes: 0 } };
            used.add(nonce);
            return { meta: { changes: 1 } };
          }),
        );
      },
    },
  };
}

function env(changes: Partial<DevPassEnv> = {}): { env: DevPassEnv; statements: Recorded[]; used: Set<string> } {
  const { db, statements, used } = database();
  return {
    statements,
    used,
    env: {
      ENVIRONMENT_NAME: 'dev',
      SITE_ORIGIN: `https://${HOST}`,
      SITE_PASSWORD: PASSWORD,
      DEV_PASS_SECRET: SECRET,
      DB: db,
      ...changes,
    },
  };
}

const request = (path = `/?dev_pass=${TOKEN}`, headers: Record<string, string> = {}): Request =>
  new Request(`https://origin.example.test${path}`, { headers });

const box = (password: string): string => `Basic ${btoa(`:${password}`)}`;

function expectBox(answer: Response | null): void {
  expect(answer?.status).toBe(401);
  expect(answer?.headers.get('www-authenticate')).toBe('Basic realm="ShyTalk dev", charset="UTF-8"');
  expect(answer?.headers.get('set-cookie')).toBeNull();
}

/** The cookie the answer sets, as `name=value`, with its attributes. */
function setCookie(answer: Response | null): { pair: string; attributes: string[] } {
  const [pair = '', ...attributes] = (answer?.headers.get('set-cookie') ?? '').split(';').map((part) => part.trim());
  return { pair, attributes };
}

describe('devPassGate: a valid pass used once', () => {
  it('sends the browser to the same address without the pass, setting the site pass cookie', async () => {
    const { env: e } = env();
    const answer = await devPassGate(request(), e, NOW);
    expect(answer?.status).toBe(302);
    expect(answer?.headers.get('location')).toBe('/');
    const { pair, attributes } = setCookie(answer);
    expect(pair.startsWith(`${SITE_PASS_COOKIE}=${NOW + SITE_PASS_SECONDS}.`)).toBe(true);
    expect(attributes).toEqual(['Path=/', `Max-Age=${SITE_PASS_SECONDS}`, 'Secure', 'HttpOnly', 'SameSite=Lax']);
  });

  it('sets a cookie the password check then accepts as the password, on dev', async () => {
    const { env: e } = env();
    const { pair } = setCookie(await devPassGate(request(), e, NOW));
    const next = new Request('https://origin.example.test/', { headers: { cookie: pair } });
    expect(await requireSitePassword(next, PASSWORD, 'ShyTalk dev', { key: SECRET, now: NOW + 60 })).toBeNull();
  });

  it('keeps the path and every other query part', async () => {
    const { env: e } = env();
    const answer = await devPassGate(request(`/closed-testing/?a=1&dev_pass=${TOKEN}&b=2`), e, NOW);
    expect(answer?.headers.get('location')).toBe('/closed-testing/?a=1&b=2');
  });

  it.each([
    ['two leading slashes', `//elsewhere.example.test/x?dev_pass=${TOKEN}`, '/elsewhere.example.test/x'],
    ['a leading backslash', `/\\elsewhere.example.test/x?dev_pass=${TOKEN}`, '/elsewhere.example.test/x'],
    ['three leading slashes', `///elsewhere.example.test/?dev_pass=${TOKEN}`, '/elsewhere.example.test/'],
  ])('never sends the browser to another site for a path with %s', async (_case, path, location) => {
    const { env: e } = env();
    const valid = await devPassGate(new Request(`https://origin.example.test${path}`), e, NOW);
    expect(valid?.headers.get('location')).toBe(location);
    const refused = await devPassGate(
      new Request(`https://origin.example.test${path}`, { headers: { authorization: box(PASSWORD) } }),
      e,
      NOW,
    );
    expect(refused?.headers.get('location')).toBe(location);
  });

  it('answers with no caching and no referrer, so the pass is neither stored nor passed on', async () => {
    const { env: e } = env();
    const answer = await devPassGate(request(), e, NOW);
    expect(answer?.headers.get('cache-control')).toBe('no-store');
    expect(answer?.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('records the nonce until its expiry, forgetting nonces already expired in the same batch', async () => {
    const { env: e, statements } = env();
    await devPassGate(request(), e, NOW);
    expect(statements).toEqual([
      { sql: 'DELETE FROM dev_pass_nonce WHERE exp < ?', values: [NOW] },
      { sql: 'INSERT INTO dev_pass_nonce (nonce, exp) VALUES (?, ?) ON CONFLICT (nonce) DO NOTHING', values: [NONCE, EXP] },
    ]);
  });
});

describe('devPassGate: any other pass gets the password box', () => {
  it('asks with the box the second time the same pass is used', async () => {
    const { env: e } = env();
    expect((await devPassGate(request(), e, NOW))?.status).toBe(302);
    expectBox(await devPassGate(request(), e, NOW + 1));
  });

  it('asks with the box for an expired pass, without recording it', async () => {
    const { env: e, statements } = env();
    expectBox(await devPassGate(request(), e, EXP + 1));
    expect(statements).toEqual([]);
  });

  it('asks with the box for a pass signed with another secret', async () => {
    const { env: e } = env({ DEV_PASS_SECRET: 'another-secret' });
    expectBox(await devPassGate(request(), e, NOW));
  });

  it('asks with the box for a pass made for another host', async () => {
    const { env: e } = env({ SITE_ORIGIN: 'https://site.example.test' });
    expectBox(await devPassGate(request(), e, NOW));
  });

  it.each([
    ['DEV_PASS_SECRET is unset', { DEV_PASS_SECRET: undefined }],
    ['SITE_PASSWORD is unset, so no cookie could stand in for it', { SITE_PASSWORD: undefined }],
    ['SITE_ORIGIN is unset', { SITE_ORIGIN: undefined }],
    ['there is no database', { DB: undefined }],
  ])('asks with the box while %s', async (_case, changes) => {
    const { env: e } = env(changes);
    expectBox(await devPassGate(request(), e, NOW));
  });

  it('asks with the box when the nonce cannot be recorded, never letting the pass through', async () => {
    const { env: e } = env({ DB: database(true).db });
    expectBox(await devPassGate(request(), e, NOW));
  });

  it('asks with the box for an empty pass', async () => {
    const { env: e } = env();
    expectBox(await devPassGate(request('/?dev_pass='), e, NOW));
  });

  it('drops a refused pass from the address once the box is answered, setting no cookie', async () => {
    const { env: e } = env();
    await devPassGate(request(), e, NOW);
    const answer = await devPassGate(request(`/?dev_pass=${TOKEN}`, { authorization: box(PASSWORD) }), e, NOW + 1);
    expect(answer?.status).toBe(302);
    expect(answer?.headers.get('location')).toBe('/');
    expect(answer?.headers.get('set-cookie')).toBeNull();
  });

  it('asks with the box for a refused pass when the box is answered wrongly', async () => {
    const { env: e } = env();
    await devPassGate(request(), e, NOW);
    expectBox(await devPassGate(request(`/?dev_pass=${TOKEN}`, { authorization: box('wrong') }), e, NOW + 1));
  });
});

describe('devPassGate: where it does nothing', () => {
  it('leaves a request with no pass to the password check', async () => {
    const { env: e, statements } = env();
    expect(await devPassGate(request('/?other=1'), e, NOW)).toBeNull();
    expect(statements).toEqual([]);
  });

  it.each(['test', 'prod'] as const)('reads no pass on %s, leaving the request to the password check', async (environment) => {
    const { env: e, statements } = env({ ENVIRONMENT_NAME: environment });
    expect(await devPassGate(request(), e, NOW)).toBeNull();
    expect(statements).toEqual([]);
  });
});
