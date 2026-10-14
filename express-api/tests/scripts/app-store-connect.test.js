'use strict';

/**
 * app-store-connect.test.js — SHY-0361.
 *
 * `scripts/app-store-connect.js` is the one App Store Connect client the deploy
 * scripts share (ensure-testflight-auto-distribution.js and
 * set-testflight-whats-new.js). Loaded in-process; `fetch` is a stand-in, so no
 * request leaves the test.
 */

const crypto = require('node:crypto');
const { makeJwt, makeClient, resolveKeyPath } = require('../../../scripts/app-store-connect.js');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('makeJwt', () => {
  const token = () =>
    makeJwt({ keyId: 'KEY123', issuerId: 'iss-uuid', key: PEM, nowSeconds: 1000 });

  test('the header names ES256 and the key id', () => {
    expect(decode(token().split('.')[0])).toEqual({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
  });

  test('the payload names the issuer, the audience and a 20-minute life', () => {
    expect(decode(token().split('.')[1])).toEqual({
      iss: 'iss-uuid',
      iat: 1000,
      exp: 2200,
      aud: 'appstoreconnect-v1',
    });
  });

  test('the signature verifies against the key pair, in the raw form Apple expects', () => {
    const [h, p, s] = token().split('.');
    expect(
      crypto
        .createVerify('SHA256')
        .update(`${h}.${p}`)
        .verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')),
    ).toBe(true);
  });
});

describe('makeClient', () => {
  const calls = [];
  const fakeFetch = (responses) => async (url, init) => {
    calls.push({ url, init });
    return responses.shift();
  };
  const reply = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  beforeEach(() => {
    calls.length = 0;
  });

  test('sends the method, path, bearer token and JSON body, and returns the parsed reply', async () => {
    const asc = makeClient({
      keyId: 'K',
      issuerId: 'I',
      key: PEM,
      fetch: fakeFetch([reply(200, { data: [1] })]),
    });
    await expect(asc('POST', '/v1/x', { a: 1 })).resolves.toEqual({ data: [1] });
    expect(calls[0].url).toBe('https://api.appstoreconnect.apple.com/v1/x');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe('{"a":1}');
    expect(calls[0].init.headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  test('a 204 reply returns null', async () => {
    const asc = makeClient({ keyId: 'K', issuerId: 'I', key: PEM, fetch: fakeFetch([reply(204)]) });
    await expect(asc('PATCH', '/v1/x', {})).resolves.toBeNull();
  });

  test("a refusal throws, naming method, path, status and Apple's text", async () => {
    const asc = makeClient({
      keyId: 'K',
      issuerId: 'I',
      key: PEM,
      fetch: fakeFetch([reply(409, { errors: [{ detail: 'nope' }] })]),
    });
    await expect(asc('POST', '/v1/y', {})).rejects.toThrow(/POST \/v1\/y → 409: .*nope/);
  });

  test('refuses to start without a key id', () => {
    expect(() => makeClient({ keyId: '', issuerId: 'I', key: PEM, fetch: fakeFetch([]) })).toThrow(
      /APP_STORE_CONNECT_KEY_ID/,
    );
  });

  test('refuses to start without an issuer id', () => {
    expect(() => makeClient({ keyId: 'K', issuerId: '', key: PEM, fetch: fakeFetch([]) })).toThrow(
      /APP_STORE_CONNECT_ISSUER_ID/,
    );
  });
});

describe('resolveKeyPath', () => {
  const exists = (paths) => (p) => paths.includes(p);

  test('an explicit path wins', () => {
    expect(
      resolveKeyPath(
        { APP_STORE_CONNECT_KEY_PATH: '/k.p8', RUNNER_TEMP: '/t', HOME: '/h' },
        'K',
        exists([]),
      ),
    ).toBe('/k.p8');
  });

  test('the runner temp key, when it exists', () => {
    expect(
      resolveKeyPath(
        { RUNNER_TEMP: '/t', HOME: '/h' },
        'K',
        exists(['/t/private_keys/AuthKey_K.p8']),
      ),
    ).toBe('/t/private_keys/AuthKey_K.p8');
  });

  test('the legacy home key otherwise', () => {
    expect(resolveKeyPath({ RUNNER_TEMP: '/t', HOME: '/h' }, 'K', exists([]))).toBe(
      '/h/private_keys/AuthKey_K.p8',
    );
  });
});
