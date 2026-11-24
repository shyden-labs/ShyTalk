import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { handle, type WebEnv } from '../../workers/web/src/web.ts';
import { SHYDESK_CALLBACK_PATH, handleShyDeskCallback } from '../../workers/web/src/moderation/callback-route.ts';
import { APPLY_SQL, END_SESSIONS_SQL, FIND_SQL, LIFT_SQL } from '../../workers/web/src/moderation/punishments.ts';
import { DOOR_SECRET_HEADER } from '../../packages/environment/index.ts';

/**
 * `POST /api/shydesk/callback` (shyden-labs/ShyTalk#310 AC1 and AC2): ShyDesk is a server, so like GitHub's webhook it
 * has no site password or DEV pass to give; the address is reached after the door and before the password, its
 * signature alone guards it, and the database must still name this environment. The checks and the store have their
 * own tests (shydesk-callback.test.ts, punishments.test.ts); these prove the route joins them.
 */

const SECRET = 'the-shydesk-secret';
const DOOR = 'the-door-secret';
const URL_OF = `https://site.example.test${SHYDESK_CALLBACK_PATH}`;

interface Bound {
  sql: string;
  values: unknown[];
}

/** A D1 stand-in whose marker names `marker`; a FIND_SQL answers a row when `stored`. */
function database(marker: string, stored = true) {
  const batches: Bound[][] = [];
  const DB = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]): Bound => ({ sql, values }),
      first: <T>() => Promise.resolve({ name: marker } as T),
    }),
    batch: (statements: Bound[]) => {
      batches.push(statements);
      return Promise.resolve(
        statements.map((statement) => ({ meta: { changes: 1 }, results: statement.sql === FIND_SQL && stored ? [{ id: 'p' }] : [] })),
      );
    },
  };
  return { DB, batches };
}

const body = (type = 'punishment.apply', key = 'ban'): string =>
  JSON.stringify({
    type,
    punishment_id: 'p-1',
    product: 'shytalk',
    subject_user_id: 'u-1',
    punishment: { key, label: 'Banned', duration_seconds: null },
    report_ticket_id: 'tkt-1',
    ...(type === 'punishment.apply' ? { appeal_url: 'https://site.example.test/appeal' } : {}),
    issued_at: '2026-11-23T15:00:00Z',
  });

function delivery(text: string, options: { secret?: string; door?: boolean; method?: string; path?: string } = {}): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const mac = createHmac('sha256', options.secret ?? SECRET)
    .update(`${timestamp}.${text}`)
    .digest('hex');
  const headers = new Headers({ 'content-type': 'application/json', 'shydesk-timestamp': timestamp, 'shydesk-signature': `v1=${mac}` });
  if (options.door !== false) headers.set(DOOR_SECRET_HEADER, DOOR);
  const url = options.path === undefined ? URL_OF : `https://site.example.test${options.path}`;
  const method = options.method ?? 'POST';
  return method === 'POST' ? new Request(url, { method, headers, body: text }) : new Request(url, { method, headers });
}

const answerOf = async (response: Response) => ({ status: response.status, body: await response.json() });

describe('the ShyDesk callback route', () => {
  /** An env holding `secret` (left out when undefined) whose lift finds a stored row when `stored`. */
  const env = (options: { secret?: string | undefined } = {}, stored = true) => {
    const { DB, batches } = database('dev', stored);
    const secret = 'secret' in options ? options.secret : SECRET;
    return {
      env: { ENVIRONMENT_NAME: 'dev' as const, DB, ...(secret === undefined ? {} : { SHYDESK_CALLBACK_SECRET: secret }) },
      batches,
    };
  };

  it('is at /api/shydesk/callback', () => {
    expect(SHYDESK_CALLBACK_PATH).toBe('/api/shydesk/callback');
  });

  it('stores a believed apply, ending the member sessions in the same batch', async () => {
    const { env: e, batches } = env();
    expect(await answerOf(await handleShyDeskCallback(delivery(body()), e))).toEqual({ status: 200, body: { applied: true } });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((statement) => statement.sql)).toEqual([APPLY_SQL, expect.stringContaining('audit'), END_SESSIONS_SQL]);
    expect(batches[0]?.[0]?.values.slice(0, 5)).toEqual(['p-1', 'u-1', 'ban', 'Banned', 1]);
  });

  it('lifts a believed lift, and refuses a lift of nothing stored with 404', async () => {
    const { env: e, batches } = env();
    expect(await answerOf(await handleShyDeskCallback(delivery(body('punishment.lift')), e))).toEqual({
      status: 200,
      body: { applied: true },
    });
    expect(batches[0]?.[0]?.sql).toBe(LIFT_SQL);
    const { env: none } = env({}, false);
    expect(await answerOf(await handleShyDeskCallback(delivery(body('punishment.lift')), none))).toEqual({
      status: 404,
      body: { error: 'unknown_punishment' },
    });
  });

  it("passes on the check's refusal and writes nothing", async () => {
    const { env: e, batches } = env();
    expect(await answerOf(await handleShyDeskCallback(delivery(body(), { secret: 'another' }), e))).toEqual({
      status: 401,
      body: { error: 'bad_signature' },
    });
    expect(batches).toEqual([]);
  });

  it('refuses a key ShyTalk does not use with 422 and writes nothing', async () => {
    const { env: e, batches } = env();
    expect(await answerOf(await handleShyDeskCallback(delivery(body('punishment.apply', 'kick')), e))).toEqual({
      status: 422,
      body: { error: 'unknown_punishment' },
    });
    expect(batches).toEqual([]);
  });

  it('answers 503 callback_unavailable with no secret or an empty one, writing nothing', async () => {
    for (const secret of [undefined, '']) {
      const { env: e, batches } = env({ secret });
      expect(await answerOf(await handleShyDeskCallback(delivery(body()), e))).toEqual({
        status: 503,
        body: { error: 'callback_unavailable' },
      });
      expect(batches).toEqual([]);
    }
  });

  it('answers any other method with 405 naming POST', async () => {
    const { env: e, batches } = env();
    const answer = await handleShyDeskCallback(delivery('', { method: 'GET' }), e);
    expect(answer.status).toBe(405);
    expect(answer.headers.get('allow')).toBe('POST');
    expect(batches).toEqual([]);
  });
});

describe('POST /api/shydesk/callback through the site', () => {
  const site = (
    environment: WebEnv['ENVIRONMENT_NAME'],
    marker: string = environment,
    overrides: { [K in keyof WebEnv]?: WebEnv[K] | undefined } = {},
  ) => {
    const { DB, batches } = database(marker);
    const assets: string[] = [];
    const env = {
      ENVIRONMENT_NAME: environment,
      DOOR_SECRET: DOOR,
      SITE_PASSWORD: 'the-site-password',
      SHYDESK_CALLBACK_SECRET: SECRET,
      DB,
      ASSETS: {
        fetch: (request: Request) => {
          assets.push(new URL(request.url).pathname);
          return Promise.resolve(new Response('page'));
        },
      },
      ...overrides,
    } as WebEnv;
    return { env, batches, assets };
  };

  it('reaches the route on DEV without the site password or a DEV pass, with the security headers', async () => {
    const { env, batches } = site('dev');
    const answer = await handle(delivery(body()), env);
    expect(await answerOf(answer.clone())).toEqual({ status: 200, body: { applied: true } });
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
    expect(batches).toHaveLength(1);
  });

  it('still needs the door on DEV, so only the front door reaches it', async () => {
    const { env, batches } = site('dev');
    expect((await handle(delivery(body(), { door: false }), env)).status).not.toBe(200);
    expect(batches).toEqual([]);
  });

  it('refuses when the database names another environment, writing nothing', async () => {
    const { env, batches } = site('dev', 'prod');
    const answer = await handle(delivery(body()), env);
    expect(answer.status).toBe(503);
    expect(batches).toEqual([]);
  });

  it('answers 503 on a Worker deployed without its database', async () => {
    const { env } = site('dev', 'dev', { DB: undefined });
    expect((await handle(delivery(body()), env)).status).toBe(503);
  });

  it('reaches the route on production while it holds', async () => {
    const { env, batches, assets } = site('prod', 'prod', { HOLDING: 'true' });
    expect(await answerOf(await handle(delivery(body()), env))).toEqual({ status: 200, body: { applied: true } });
    expect(batches).toHaveLength(1);
    expect(assets).toEqual([]);
  });

  it('asks for the password at any other address under it on DEV', async () => {
    const { env, batches } = site('dev');
    const answer = await handle(delivery(body(), { path: `${SHYDESK_CALLBACK_PATH}/other` }), env);
    expect(answer.status).toBe(401);
    expect(answer.headers.get('www-authenticate')).toMatch(/^Basic /u);
    expect(batches).toEqual([]);
  });
});
