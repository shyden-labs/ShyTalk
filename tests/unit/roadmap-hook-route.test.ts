import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { handle, type WebEnv } from '../../workers/web/src/web.ts';
import { DOOR_SECRET_HEADER, type D1Like } from '../../packages/environment/index.ts';

/**
 * The roadmap's webhook address (shyden-labs/ShyTalk#321 AC1): GitHub cannot answer DEV's password box or carry a
 * DEV pass, so `POST /hooks/github` is reached after the door but before the password, and the signature alone
 * guards it. A believed event about ShyTalk's own repository or board tells the roadmap's Durable Object the board
 * changed; nothing else reaches it.
 */

const DOOR = 'the-door-secret';
const HOOK_SECRET = 'the-webhook-secret';
const REPO = 'shyden-labs/ShyTalk';
const BOARD = 'PVT_kwDOEOcG584BpkXr';
const HOOK = 'https://site.example.test/hooks/github';

const signed = (body: string, secret = HOOK_SECRET): string => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const issueEvent = (repo = REPO): string => JSON.stringify({ action: 'edited', repository: { full_name: repo } });

/** A DB whose marker names `environment`. */
const db = (environment: string): D1Like => ({
  prepare: () => ({ first: <T>() => Promise.resolve({ name: environment } as T) }),
});

/**
 * An env for `environment` whose roadmap Durable Object records every request it is sent; each override replaces
 * a binding, and an override of `undefined` leaves that binding out.
 */
function setup(
  environment: WebEnv['ENVIRONMENT_NAME'],
  overrides: { [K in keyof WebEnv]?: WebEnv[K] | undefined } = {},
): { env: WebEnv; told: string[]; assets: string[] } {
  const told: string[] = [];
  const assets: string[] = [];
  const env: WebEnv = {
    ENVIRONMENT_NAME: environment,
    DOOR_SECRET: DOOR,
    SITE_PASSWORD: 'the-site-password',
    ROADMAP_WEBHOOK_SECRET: HOOK_SECRET,
    DB: db(environment),
    ASSETS: {
      fetch: (request: Request) => {
        assets.push(new URL(request.url).pathname);
        return Promise.resolve(new Response('page'));
      },
    },
    ROADMAP: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (request: Request) => {
          told.push(`${request.method} ${new URL(request.url).pathname}`);
          return Promise.resolve(new Response(null, { status: 202 }));
        },
      }),
    },
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) Reflect.deleteProperty(env, key);
    else Reflect.set(env, key, value);
  }
  return { env, told, assets };
}

/** A delivery through the door, signed with `secret` unless `signature` is given. */
function delivery(body: string, event: string, options: { signature?: string | null; door?: boolean; method?: string } = {}): Request {
  const headers = new Headers({ 'x-github-event': event, 'content-type': 'application/json' });
  if (options.door !== false) headers.set(DOOR_SECRET_HEADER, DOOR);
  const signature = options.signature === undefined ? signed(body) : options.signature;
  if (signature !== null) headers.set('x-hub-signature-256', signature);
  const method = options.method ?? 'POST';
  return method === 'POST' ? new Request(HOOK, { method, headers, body }) : new Request(HOOK, { method, headers });
}

describe('POST /hooks/github on DEV', () => {
  it('reaches the roadmap without the site password or a DEV pass when the signature matches', async () => {
    const { env, told } = setup('dev');
    const answer = await handle(delivery(issueEvent(), 'issues'), env);
    expect(answer.status).toBe(202);
    expect(await answer.json()).toEqual({ state: 'reading' });
    expect(told).toEqual(['POST /changed']);
  });

  it('refuses a delivery signed with another secret, and the roadmap hears nothing', async () => {
    const { env, told } = setup('dev');
    const answer = await handle(delivery(issueEvent(), 'issues', { signature: signed(issueEvent(), 'another-secret') }), env);
    expect(answer.status).toBe(401);
    expect(await answer.json()).toEqual({ error: 'bad_signature' });
    expect(told).toEqual([]);
  });

  it('refuses an unsigned delivery', async () => {
    const { env, told } = setup('dev');
    const answer = await handle(delivery(issueEvent(), 'issues', { signature: null }), env);
    expect(answer.status).toBe(401);
    expect(told).toEqual([]);
  });

  it('refuses every delivery when the Worker has no webhook secret', async () => {
    const { env, told } = setup('dev', { ROADMAP_WEBHOOK_SECRET: undefined });
    // Signed with an empty key and with the secret a fallback might hold: neither is believed.
    for (const secret of ['', HOOK_SECRET]) {
      const answer = await handle(delivery(issueEvent(), 'issues', { signature: signed(issueEvent(), secret) }), env);
      expect(answer.status).toBe(401);
    }
    expect(told).toEqual([]);
  });

  it('still needs the door secret, so only the front door reaches it', async () => {
    const { env, told } = setup('dev');
    const answer = await handle(delivery(issueEvent(), 'issues', { door: false }), env);
    expect(answer.status).not.toBe(202);
    expect(told).toEqual([]);
  });

  it('answers a ping without a board read', async () => {
    const { env, told } = setup('dev');
    const body = JSON.stringify({ zen: 'Keep it logically awesome.' });
    const answer = await handle(delivery(body, 'ping'), env);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ state: 'pong' });
    expect(told).toEqual([]);
  });

  it('ignores a signed delivery that names no event, without a board read', async () => {
    const { env, told } = setup('dev');
    const request = delivery(issueEvent(), 'issues');
    request.headers.delete('x-github-event');
    const answer = await handle(request, env);
    expect(answer.status).toBe(202);
    expect(await answer.json()).toEqual({ state: 'ignored' });
    expect(told).toEqual([]);
  });

  it("ignores another repository's issue event without a board read", async () => {
    const { env, told } = setup('dev');
    const answer = await handle(delivery(issueEvent('shyden-labs/yawelo-idle'), 'issues'), env);
    expect(answer.status).toBe(202);
    expect(await answer.json()).toEqual({ state: 'ignored' });
    expect(told).toEqual([]);
  });

  it("tells the roadmap about a card event on ShyTalk's board", async () => {
    const { env, told } = setup('dev');
    const body = JSON.stringify({ action: 'edited', projects_v2_item: { project_node_id: BOARD } });
    const answer = await handle(delivery(body, 'projects_v2_item'), env);
    expect(answer.status).toBe(202);
    expect(told).toEqual(['POST /changed']);
  });

  it('refuses a signed body that is not JSON', async () => {
    const { env, told } = setup('dev');
    const answer = await handle(delivery('not json', 'issues'), env);
    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({ error: 'bad_payload' });
    expect(told).toEqual([]);
  });

  it('answers any other method with 405 naming POST', async () => {
    const { env, told } = setup('dev');
    const answer = await handle(delivery('', 'issues', { method: 'GET' }), env);
    expect(answer.status).toBe(405);
    expect(answer.headers.get('allow')).toBe('POST');
    expect(told).toEqual([]);
  });

  it('answers 503 for a believed read when the Worker has no roadmap Durable Object', async () => {
    const { env } = setup('dev', { ROADMAP: undefined });
    const answer = await handle(delivery(issueEvent(), 'issues'), env);
    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ error: 'roadmap_unavailable' });
  });

  it('carries the security headers like every answer', async () => {
    const { env } = setup('dev');
    const answer = await handle(delivery(issueEvent(), 'issues'), env);
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('the password still guards every other address on DEV', () => {
  it('asks for the password at /hooks/github/other', async () => {
    const { env, told, assets } = setup('dev');
    const request = new Request('https://site.example.test/hooks/github/other', {
      method: 'POST',
      headers: { [DOOR_SECRET_HEADER]: DOOR, 'x-github-event': 'issues', 'x-hub-signature-256': signed(issueEvent()) },
      body: issueEvent(),
    });
    const answer = await handle(request, env);
    expect(answer.status).toBe(401);
    expect(answer.headers.get('www-authenticate')).toMatch(/^Basic /u);
    expect(told).toEqual([]);
    expect(assets).toEqual([]);
  });
});

describe('POST /hooks/github on production', () => {
  it('reaches the roadmap while production holds', async () => {
    const { env, told } = setup('prod', { HOLDING: 'true', DOOR_SECRET: undefined, SITE_PASSWORD: undefined });
    const request = new Request('https://site.example.test/hooks/github', {
      method: 'POST',
      headers: { 'x-github-event': 'issues', 'x-hub-signature-256': signed(issueEvent()) },
      body: issueEvent(),
    });
    const answer = await handle(request, env);
    expect(answer.status).toBe(202);
    expect(told).toEqual(['POST /changed']);
  });
});
