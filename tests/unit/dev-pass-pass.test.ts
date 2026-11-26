import { beforeAll, describe, expect, it } from 'vitest';
import type { webcrypto } from 'node:crypto';
import {
  CLOCK_SKEW_SECONDS,
  LIFETIME_SECONDS,
  mintPass,
  safeBack,
  verifyPass,
  type PassKind,
  type PublicKeys,
  type SigningKey,
} from '../../workers/door/src/dev-pass/pass.ts';

/**
 * The DEV pass (shyden-labs/repo-template#207, spec §3): `v1.<kid>.<payload>.<sig>`,
 * an Ed25519 signature over `v1.<kid>.<payload>`, bound to one door by `aud`.
 * Every refusal reason the door can give is produced here by a crafted pass.
 */

const HOST = 'dev.yaweloidle.com';
const NOW = 1_800_000_000;
const KID = 'k1';

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const text = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value);

let key: SigningKey;
let other: webcrypto.CryptoKey;
let keys: PublicKeys;

async function keyPair(): Promise<webcrypto.CryptoKeyPair> {
  return (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
}

beforeAll(async () => {
  const pair = await keyPair();
  key = { kid: KID, privateKey: pair.privateKey };
  other = (await keyPair()).privateKey;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  keys = { [KID]: jwk.x ?? '' };
});

/** Builds a pass by hand, independent of mintPass, so the format is checked from outside. */
async function craft(payload: unknown, options: { kid?: string; signer?: webcrypto.CryptoKey; prefix?: string } = {}): Promise<string> {
  const head = `${options.prefix ?? 'v1'}.${options.kid ?? KID}.${b64url(text(JSON.stringify(payload)))}`;
  const sig = await crypto.subtle.sign('Ed25519', options.signer ?? key.privateKey, text(head));
  return `${head}.${b64url(new Uint8Array(sig))}`;
}

const claims = (overrides: Record<string, unknown> = {}) => ({
  aud: HOST,
  sub: 'shyden@example.com',
  kind: 'browser',
  iat: NOW,
  exp: NOW + 100,
  ...overrides,
});
const verify = (pass: string | undefined, now = NOW) => verifyPass(pass, { host: HOST, keys, now });

describe('lifetimes', () => {
  it('gives browser and app passes 12 hours, machine passes 1 hour and embed passes 5 minutes', () => {
    expect(LIFETIME_SECONDS).toEqual({ browser: 43_200, app: 43_200, machine: 3_600, embed: 300 });
  });

  it('allows 60 seconds of clock skew', () => {
    expect(CLOCK_SKEW_SECONDS).toBe(60);
  });
});

describe('mintPass', () => {
  for (const kind of ['browser', 'app', 'machine', 'embed'] as const satisfies readonly PassKind[]) {
    it(`mints the ${kind} pass the door accepts, expiring after its lifetime`, async () => {
      const pass = await mintPass({ aud: HOST, sub: 'someone', kind }, key, NOW);
      expect(await verify(pass)).toEqual({ ok: true, sub: 'someone', kind, exp: NOW + LIFETIME_SECONDS[kind] });
    });
  }

  it('writes v1, the kid, a base64url JSON payload and a signature over the first three parts', async () => {
    const pass = await mintPass({ aud: HOST, sub: 'someone', kind: 'machine' }, key, NOW);
    const parts = pass.split('.');
    expect(parts).toHaveLength(4);
    expect(parts.slice(0, 2)).toEqual(['v1', KID]);
    expect(JSON.parse(Buffer.from(parts[2] ?? '', 'base64url').toString())).toEqual({
      aud: HOST,
      sub: 'someone',
      kind: 'machine',
      iat: NOW,
      exp: NOW + 3_600,
    });
    expect(pass).not.toMatch(/[=+/]/);
    const publicKey = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: keys[KID] ?? '' }, 'Ed25519', false, [
      'verify',
    ]);
    const signed = await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      new Uint8Array(Buffer.from(parts[3] ?? '', 'base64url')),
      text(parts.slice(0, 3).join('.')),
    );
    expect(signed).toBe(true);
  });
});

describe('verifyPass', () => {
  it('accepts a hand-built pass', async () => {
    expect(await verify(await craft(claims()))).toEqual({ ok: true, sub: 'shyden@example.com', kind: 'browser', exp: NOW + 100 });
  });

  it('refuses no pass as missing', async () => {
    expect(await verify(undefined)).toEqual({ ok: false, reason: 'missing' });
  });

  it('refuses an empty pass as missing', async () => {
    expect(await verify('')).toEqual({ ok: false, reason: 'missing' });
  });

  it('refuses a pass with three parts as malformed', async () => {
    const pass = await craft(claims());
    expect(await verify(pass.split('.').slice(0, 3).join('.'))).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a pass with five parts as malformed', async () => {
    expect(await verify(`${await craft(claims())}.x`)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a pass of another version as malformed', async () => {
    expect(await verify(await craft(claims(), { prefix: 'v2' }))).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a payload that is not JSON as malformed', async () => {
    const [v = '', kid = '', , sig = ''] = (await craft(claims())).split('.');
    expect(await verify(`${v}.${kid}.${b64url(text('not json'))}.${sig}`)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a payload that is not base64url as malformed', async () => {
    const [v = '', kid = '', , sig = ''] = (await craft(claims())).split('.');
    expect(await verify(`${v}.${kid}.@@@.${sig}`)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a signature that is not base64url as malformed', async () => {
    const [v = '', kid = '', payload = ''] = (await craft(claims())).split('.');
    expect(await verify(`${v}.${kid}.${payload}.@@@`)).toEqual({ ok: false, reason: 'malformed' });
  });

  for (const [field, value] of [
    ['aud', 7],
    ['sub', ''],
    ['sub', null],
    ['kind', 1],
    ['iat', '1'],
    ['exp', '1'],
  ] as const) {
    it(`refuses a payload whose ${field} is ${JSON.stringify(value)} as malformed`, async () => {
      expect(await verify(await craft(claims({ [field]: value })))).toEqual({ ok: false, reason: 'malformed' });
    });
  }

  it('refuses a payload that is a JSON array as malformed', async () => {
    expect(await verify(await craft([]))).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a payload that is JSON null as malformed', async () => {
    expect(await verify(await craft(null))).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a kid the door does not hold', async () => {
    expect(await verify(await craft(claims(), { kid: 'k9' }))).toEqual({ ok: false, reason: 'unknown-kid' });
  });

  it('refuses a kid that is only an inherited property name', async () => {
    expect(await verify(await craft(claims(), { kid: 'toString' }))).toEqual({ ok: false, reason: 'unknown-kid' });
  });

  it('refuses a pass signed by another key under a known kid', async () => {
    expect(await verify(await craft(claims(), { signer: other }))).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a pass whose payload was changed after signing', async () => {
    const [v = '', kid = '', , sig = ''] = (await craft(claims())).split('.');
    const forged = b64url(text(JSON.stringify(claims({ sub: 'intruder' }))));
    expect(await verify(`${v}.${kid}.${forged}.${sig}`)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a signature of the wrong length', async () => {
    const [v = '', kid = '', payload = ''] = (await craft(claims())).split('.');
    expect(await verify(`${v}.${kid}.${payload}.${b64url(new Uint8Array(10))}`)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('checks the signature before the claims', async () => {
    expect(await verify(await craft(claims({ aud: 'dev.other.com', kind: 'admin', exp: 0 }), { signer: other }))).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('refuses a pass for another door', async () => {
    expect(await verify(await craft(claims({ aud: 'dev.shytalk.com' })))).toEqual({ ok: false, reason: 'wrong-audience' });
  });

  it('refuses a kind that is not browser, app, machine or embed', async () => {
    expect(await verify(await craft(claims({ kind: 'admin' })))).toEqual({ ok: false, reason: 'bad-kind' });
  });

  it('refuses an inherited property name as a kind', async () => {
    expect(await verify(await craft(claims({ kind: 'constructor' })))).toEqual({ ok: false, reason: 'bad-kind' });
  });

  it('refuses a pass at the second it expires', async () => {
    expect(await verify(await craft(claims()), NOW + 100)).toEqual({ ok: false, reason: 'expired' });
  });

  it('accepts a pass one second before it expires', async () => {
    expect(await verify(await craft(claims()), NOW + 99)).toMatchObject({ ok: true });
  });

  it('accepts a pass issued 60 seconds in the future', async () => {
    expect(await verify(await craft(claims({ iat: NOW + 60 })))).toMatchObject({ ok: true });
  });

  it('refuses a pass issued 61 seconds in the future', async () => {
    expect(await verify(await craft(claims({ iat: NOW + 61 })))).toEqual({ ok: false, reason: 'not-yet-valid' });
  });
});

describe('safeBack', () => {
  it('keeps a path with its query', () => {
    expect(safeBack('/rooms/7?tab=chat')).toBe('/rooms/7?tab=chat');
  });

  it('keeps the root', () => {
    expect(safeBack('/')).toBe('/');
  });

  for (const value of [
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    '/a\\b',
    '/a b',
    '/a\u0000b',
    '/a\u007fb',
    'https://evil.example/',
    'rooms',
    '',
    null,
    undefined,
  ]) {
    it(`sends ${JSON.stringify(value)} to the root`, () => {
      expect(safeBack(value)).toBe('/');
    });
  }
});
