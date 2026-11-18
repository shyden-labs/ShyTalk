import { describe, it, expect } from 'vitest';
import { readDevPass } from '../../packages/environment/dev-pass.ts';

/**
 * The partner site's one-use dev pass (shyden-labs/ShyTalk#263 AC2). The token
 * is base64url(payload JSON) "." base64url(HMAC-SHA256(secret, that first
 * part)); the payload is {v: 1, host, exp (unix seconds), nonce}. The vector
 * below was minted by the partner site's own minter (2026-11-19).
 */

const SECRET = 'test-secret-not-real';
const HOST = 'dev.shytalk.app';
const MINTED_AT = 1763520000;
const EXP = 1763520060;
const NONCE = 'AAECAwQFBgcICQoLDA0ODw';
const TOKEN =
  'eyJ2IjoxLCJob3N0IjoiZGV2LnNoeXRhbGsuYXBwIiwiZXhwIjoxNzYzNTIwMDYwLCJub25jZSI6IkFBRUNBd1FGQmdjSUNRb0xEQTBPRHcifQ.IpAei1Y9PFgTJDbfWLP6m6AH_6KxCOc1P6L9w0CFS5c';

const [BODY = '', SIGNATURE = ''] = TOKEN.split('.');
const LAST = TOKEN.slice(-1);

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

/** A token for `payload` signed with `secret`, made the way the partner's minter makes one. */
async function mint(payload: unknown, secret = SECRET): Promise<string> {
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return `${body}.${base64url(signature)}`;
}

const payload = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  host: HOST,
  exp: EXP,
  nonce: NONCE,
  ...changes,
});

describe('readDevPass', () => {
  it("accepts the partner's own test vector at its mint time, answering its nonce and expiry", async () => {
    expect(await readDevPass(TOKEN, SECRET, HOST, MINTED_AT)).toEqual({ nonce: NONCE, exp: EXP });
  });

  it('accepts a pass in its last second', async () => {
    expect(await readDevPass(TOKEN, SECRET, HOST, EXP)).toEqual({ nonce: NONCE, exp: EXP });
  });

  it('refuses a pass older than 60 seconds', async () => {
    expect(await readDevPass(TOKEN, SECRET, HOST, EXP + 1)).toBeNull();
  });

  it('refuses a pass signed with another secret', async () => {
    expect(await readDevPass(await mint(payload(), 'another-secret'), SECRET, HOST, MINTED_AT)).toBeNull();
  });

  it('refuses every pass while the secret is unset or empty', async () => {
    expect(await readDevPass(TOKEN, undefined, HOST, MINTED_AT)).toBeNull();
    expect(await readDevPass(TOKEN, '', HOST, MINTED_AT)).toBeNull();
  });

  it('refuses a payload altered after signing', async () => {
    const altered = base64url(new TextEncoder().encode(JSON.stringify(payload({ exp: EXP + 3600 }))));
    expect(await readDevPass(`${altered}.${SIGNATURE}`, SECRET, HOST, MINTED_AT)).toBeNull();
  });

  it('refuses a signature altered by one character', async () => {
    expect(await readDevPass(`${TOKEN.slice(0, -2)}X${LAST}`, SECRET, HOST, MINTED_AT)).toBeNull();
  });

  it('refuses a signature altered only in the unused bits of its last character', async () => {
    // 'c' and 'd' differ only in the lowest bit, which a 32-byte value's last character does not carry.
    expect(LAST).toBe('c');
    expect(await readDevPass(`${TOKEN.slice(0, -1)}d`, SECRET, HOST, MINTED_AT)).toBeNull();
  });

  it('refuses a payload altered only in the unused bits of its last character', async () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const flipped = alphabet[alphabet.indexOf(BODY.slice(-1)) ^ 1] ?? '';
    expect(await readDevPass(`${BODY.slice(0, -1)}${flipped}.${SIGNATURE}`, SECRET, HOST, MINTED_AT)).toBeNull();
  });

  it('refuses a pass made for another host', async () => {
    expect(await readDevPass(await mint(payload({ host: 'dev.example.test' })), SECRET, HOST, MINTED_AT)).toBeNull();
  });

  it('refuses a pass of another version', async () => {
    expect(await readDevPass(await mint(payload({ v: 2 })), SECRET, HOST, MINTED_AT)).toBeNull();
  });

  it.each([
    ['no nonce', { nonce: undefined }],
    ['an empty nonce', { nonce: '' }],
    ['a nonce that is not text', { nonce: 7 }],
    ['an expiry that is not a number', { exp: String(EXP) }],
    ['an expiry that is not whole', { exp: EXP + 0.5 }],
  ])('refuses a signed pass with %s', async (_name, changes) => {
    expect(await readDevPass(await mint(payload(changes)), SECRET, HOST, MINTED_AT)).toBeNull();
  });

  it.each([
    ['an empty token', ''],
    ['no dot', TOKEN.replace('.', '')],
    ['three parts', `${TOKEN}.x`],
    ['an empty signature', `${BODY}.`],
    ['characters outside base64url', TOKEN.replace('.', '.+/')],
    ['padding', `${TOKEN}=`],
    ['a signature of a length no bytes encode', `${BODY}.A`],
    ['a payload of a length no bytes encode', `A.${SIGNATURE}`],
  ])('refuses %s', async (_name, token) => {
    expect(await readDevPass(token, SECRET, HOST, MINTED_AT)).toBeNull();
  });

  it('refuses a signed payload that is not JSON', async () => {
    const body = base64url(new TextEncoder().encode('not json'));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))));
    expect(await readDevPass(`${body}.${signature}`, SECRET, HOST, MINTED_AT)).toBeNull();
  });

  it('refuses a signed payload that is JSON but not an object', async () => {
    expect(await readDevPass(await mint(null), SECRET, HOST, MINTED_AT)).toBeNull();
    expect(await readDevPass(await mint([1]), SECRET, HOST, MINTED_AT)).toBeNull();
  });
});
