import { beforeAll, describe, expect, it, vi, afterEach } from 'vitest';
import type { webcrypto } from 'node:crypto';
import door from '../../workers/door/src/index.ts';
import { DOOR_SECRET_HEADER, handle, type DoorEnv } from '../../workers/door/src/door.ts';
import { PASS_COOKIE, PASS_HEADER, SIGNIN_ORIGIN } from '../../workers/door/src/dev-pass/door.ts';
import { mintPass, toBase64url, type PassKind, type SigningKey } from '../../workers/door/src/dev-pass/pass.ts';

/**
 * DEV's door with the DEV pass (shyden-labs/ShyTalk#314, after
 * shyden-labs/repo-template#207): only a valid pass for this door reaches the
 * origin, and the origin never sees the pass. TEST's door keeps forwarding with
 * no check. Passes are minted here with a key pair made for the test.
 */

/** A neutral host standing in for the door's own (tests never name a door host). */
const HOST = 'door.example.test';
const NOW = 1_764_200_000;
const KID = 'test-kid';
let key: SigningKey;
let keys: string;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
  key = { kid: KID, privateKey: pair.privateKey };
  keys = JSON.stringify({ [KID]: toBase64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const devEnv = (): DoorEnv => ({ ORIGIN: 'https://origin.example.test', DOOR_SECRET: 'the-door-secret', HOST, DEV_PASS_KEYS: keys });
const testEnv: DoorEnv = { ORIGIN: 'https://origin.example.test', DOOR_SECRET: 'the-door-secret' };

const pass = (kind: PassKind = 'browser', aud = HOST, now = NOW): Promise<string> =>
  mintPass({ aud, sub: 'someone@example.test', kind }, key, now);

/** A stand-in for the network, recording every request it is sent. */
function network(): { send: (request: Request) => Promise<Response>; calls: Request[] } {
  const calls: Request[] = [];
  return {
    calls,
    send: (request) => {
      calls.push(request);
      return Promise.resolve(new Response('from origin'));
    },
  };
}

const page = (headers: Record<string, string> = {}): Request =>
  new Request(`https://${HOST}/support/?a=1`, { headers: { accept: 'text/html', ...headers } });

describe('door with the DEV pass', () => {
  it('sends a visitor with no pass to the sign-in, calling no origin', async () => {
    const net = network();
    const answer = await handle(page(), devEnv(), net.send, NOW);
    expect(answer.status).toBe(302);
    const location = new URL(answer.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe(`${SIGNIN_ORIGIN}/pass`);
    expect(location.searchParams.get('for')).toBe(HOST);
    expect(location.searchParams.get('back')).toBe('/support/?a=1');
    expect(net.calls).toHaveLength(0);
  });

  it('forwards a valid cookie pass to the origin with the door secret', async () => {
    const net = network();
    const answer = await handle(page({ cookie: `${PASS_COOKIE}=${await pass()}` }), devEnv(), net.send, NOW + 10);
    expect(answer.status).toBe(200);
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0]?.url).toBe('https://origin.example.test/support/?a=1');
    expect(net.calls[0]?.headers.get(DOOR_SECRET_HEADER)).toBe('the-door-secret');
  });

  it('forwards a valid X-Dev-Pass machine pass', async () => {
    const net = network();
    const answer = await handle(
      new Request(`https://${HOST}/api/health`, { headers: { [PASS_HEADER]: await pass('machine') } }),
      devEnv(),
      net.send,
      NOW,
    );
    expect(answer.status).toBe(200);
    expect(net.calls).toHaveLength(1);
  });

  it('refuses a pass for another door', async () => {
    const net = network();
    const answer = await handle(
      new Request(`https://${HOST}/api/health`, { headers: { [PASS_HEADER]: await pass('machine', 'other-door.example.test') } }),
      devEnv(),
      net.send,
      NOW,
    );
    expect(answer.status).toBe(401);
    expect(net.calls).toHaveLength(0);
  });

  it('refuses an expired pass', async () => {
    const net = network();
    const answer = await handle(
      new Request(`https://${HOST}/x`, { headers: { [PASS_HEADER]: await pass('machine', HOST, NOW - 7_200) } }),
      devEnv(),
      net.send,
      NOW,
    );
    expect(answer.status).toBe(401);
    expect(net.calls).toHaveLength(0);
  });

  it('refuses a pass signed with a key the door does not hold', async () => {
    const other = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
    const forged = await mintPass({ aud: HOST, sub: 'x', kind: 'machine' }, { kid: KID, privateKey: other.privateKey }, NOW);
    const net = network();
    expect((await handle(new Request(`https://${HOST}/x`, { headers: { [PASS_HEADER]: forged } }), devEnv(), net.send, NOW)).status).toBe(
      401,
    );
    expect(net.calls).toHaveLength(0);
  });

  it('strips the pass before forwarding', async () => {
    const net = network();
    const valid = await pass();
    await handle(page({ cookie: `theme=dark; ${PASS_COOKIE}=${valid}`, [PASS_HEADER]: valid }), devEnv(), net.send, NOW);
    const sent = net.calls[0];
    expect(sent?.headers.get(PASS_HEADER)).toBeNull();
    expect(sent?.headers.get('cookie')).toBe('theme=dark');
  });

  it('keeps a WebSocket upgrade behind a valid pass', async () => {
    const net = network();
    const upgrade = new Request(`https://${HOST}/api/app/live`, {
      headers: { upgrade: 'websocket', connection: 'Upgrade', cookie: `${PASS_COOKIE}=${await pass()}` },
    });
    await handle(upgrade, devEnv(), net.send, NOW);
    expect(net.calls[0]?.headers.get('upgrade')).toBe('websocket');
  });

  it('asks the sign-in for an embed pass through the same network', async () => {
    const net = network();
    const embed = new Request(`https://${HOST}/__devpass/embed?for=dev.support.example.test`, {
      method: 'POST',
      headers: { origin: `https://${HOST}`, cookie: `${PASS_COOKIE}=${await pass()}` },
    });
    await handle(embed, devEnv(), net.send, NOW);
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0]?.url).toBe(`${SIGNIN_ORIGIN}/embed`);
  });

  it('answers 500 and calls nothing when its keys are not valid JSON', async () => {
    const net = network();
    const answer = await handle(page(), { ...devEnv(), DEV_PASS_KEYS: '{not json' }, net.send, NOW);
    expect(answer.status).toBe(500);
    expect(await answer.text()).toBe('Door not configured');
    expect(net.calls).toHaveLength(0);
  });

  it('answers 500 when it holds keys but no host', async () => {
    const net = network();
    const { HOST: _host, ...hostless } = devEnv();
    expect((await handle(page(), hostless, net.send, NOW)).status).toBe(500);
    expect(net.calls).toHaveLength(0);
  });
});

describe('door without the DEV pass (TEST)', () => {
  it('forwards with no pass', async () => {
    const net = network();
    const answer = await handle(page(), testEnv, net.send, NOW);
    expect(answer.status).toBe(200);
    expect(net.calls[0]?.headers.get(DOOR_SECRET_HEADER)).toBe('the-door-secret');
  });
});

describe('door entry with the DEV pass', () => {
  it("checks the pass against the runtime's clock", async () => {
    const runtimeFetch = vi.fn<(request: Request) => Promise<Response>>(() => Promise.resolve(new Response('from origin')));
    vi.stubGlobal('fetch', runtimeFetch);
    const fresh = await mintPass({ aud: HOST, sub: 'x', kind: 'machine' }, key, Math.floor(Date.now() / 1000));
    const answer = await door.fetch(new Request(`https://${HOST}/x`, { headers: { [PASS_HEADER]: fresh } }), devEnv());
    expect(answer.status).toBe(200);
    expect(runtimeFetch).toHaveBeenCalledTimes(1);
  });
});
