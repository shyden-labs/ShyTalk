import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, createPrivateKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { importKey, signingString, signRequest, SIGNED_HEADERS, type OracleKey } from '../../packages/mail/sign.ts';

/**
 * Oracle request signatures, version 1 (shyden-labs/ShyTalk#88): six headers
 * signed with RSA-SHA256 through WebCrypto, so the same code runs in workerd.
 * Checked against Node's own `crypto.sign` over the string Oracle expects.
 */

const URL_LONDON = new URL('https://cell0.submit.email.uk-london-1.oci.oraclecloud.com/20220926/actions/submitEmail');
const BODY = '{"subject":"Olá"}';
const NOW = new Date('2026-11-08T09:30:00Z');

let pkcs8: string;
let pkcs1: string;
let publicPem: string;
let key: OracleKey;

beforeAll(async () => {
  const pair = generateKeyPairSync('rsa', {
    // 1024 bits: the signature path is the same, and making a key takes
    // 10-40 ms where 2048 bits took up to 1,032 ms (measured 2026-11-08),
    // past the 1 s hook limit.
    modulusLength: 1024,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  pkcs8 = pair.privateKey;
  publicPem = pair.publicKey;
  pkcs1 = createPrivateKey(pkcs8).export({ type: 'pkcs1', format: 'pem' });
  const privateKey = await importKey(pkcs8);
  if (privateKey === null) throw new Error('the test key did not import');
  key = { tenancy: 'ocid1.tenancy.oc1..t', user: 'ocid1.user.oc1..u', fingerprint: 'aa:bb', privateKey };
});

function parse(authorization: string): [string, string][] {
  expect(authorization.startsWith('Signature ')).toBe(true);
  return [...authorization.slice('Signature '.length).matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1] as string, m[2] as string]);
}

describe('signingString', () => {
  it('is the six signed lines in order, with no trailing newline', () => {
    const headers = { date: 'D', 'x-content-sha256': 'S', 'content-type': 'application/json', 'content-length': '18' };
    expect(signingString(URL_LONDON, headers)).toBe(
      [
        '(request-target): post /20220926/actions/submitEmail',
        'host: cell0.submit.email.uk-london-1.oci.oraclecloud.com',
        'date: D',
        'x-content-sha256: S',
        'content-type: application/json',
        'content-length: 18',
      ].join('\n'),
    );
  });

  it('names the six headers Oracle requires of a POST', () => {
    expect(SIGNED_HEADERS).toEqual(['(request-target)', 'host', 'date', 'x-content-sha256', 'content-type', 'content-length']);
  });
});

describe('signRequest', () => {
  it('dates the request in HTTP form', async () => {
    expect((await signRequest(URL_LONDON, BODY, key, NOW))['date']).toBe('Sun, 08 Nov 2026 09:30:00 GMT');
  });

  it('counts the body in bytes, not characters', async () => {
    expect((await signRequest(URL_LONDON, BODY, key, NOW))['content-length']).toBe('18');
  });

  it('hashes the body as Oracle does', async () => {
    const headers = await signRequest(URL_LONDON, BODY, key, NOW);
    expect(headers['x-content-sha256']).toBe(createHash('sha256').update(BODY).digest('base64'));
    expect(headers['content-type']).toBe('application/json');
  });

  it('names the key and the signed headers', async () => {
    const parts = parse((await signRequest(URL_LONDON, BODY, key, NOW)).authorization);
    expect(parts.map(([name]) => name)).toEqual(['version', 'keyId', 'algorithm', 'headers', 'signature']);
    expect(parts.slice(0, 4)).toEqual([
      ['version', '1'],
      ['keyId', 'ocid1.tenancy.oc1..t/ocid1.user.oc1..u/aa:bb'],
      ['algorithm', 'rsa-sha256'],
      ['headers', SIGNED_HEADERS.join(' ')],
    ]);
  });

  it('signs exactly what Node signs over the expected string', async () => {
    const headers = await signRequest(URL_LONDON, BODY, key, NOW);
    const expected = signingString(URL_LONDON, headers);
    const signature = (parse(headers.authorization).at(-1) as [string, string])[1];
    expect(signature).toBe(sign('sha256', Buffer.from(expected), pkcs8).toString('base64'));
    expect(verify('sha256', Buffer.from(expected), publicPem, Buffer.from(signature, 'base64'))).toBe(true);
  });
});

describe('importKey', () => {
  it('refuses a PKCS#1 key', async () => {
    expect(await importKey(pkcs1)).toBeNull();
  });

  it('refuses an empty key', async () => {
    expect(await importKey('')).toBeNull();
  });

  it('refuses a PKCS#8 frame around junk', async () => {
    expect(await importKey('-----BEGIN PRIVATE KEY-----\nnot base64\n-----END PRIVATE KEY-----')).toBeNull();
  });

  it('refuses a PKCS#8 frame around valid base64 that is no key', async () => {
    expect(await importKey('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----')).toBeNull();
  });

  it('imports a key with Windows line ends', async () => {
    expect(await importKey(pkcs8.replace(/\n/g, '\r\n'))).not.toBeNull();
  });
});
