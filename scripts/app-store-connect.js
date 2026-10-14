'use strict';

/**
 * app-store-connect.js — the one App Store Connect API client the deploy
 * scripts share (ensure-testflight-auto-distribution.js,
 * set-testflight-whats-new.js). SHY-0361 moved it here from
 * ensure-testflight-auto-distribution.js so the two cannot drift.
 *
 * `makeClient` takes `fetch` and the key as arguments, so tests run it
 * in-process with no network.
 */

/** A signed ES256 token; Apple rejects any that live past 20 minutes. */
function makeJwt({ keyId, issuerId, key, nowSeconds }) {
  const crypto = require('node:crypto');
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = {
    iss: issuerId,
    iat: nowSeconds,
    exp: nowSeconds + 1200,
    aud: 'appstoreconnect-v1',
  };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = crypto
    .createSign('SHA256')
    .update(signingInput)
    .sign({ key, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${signingInput}.${sig}`;
}

/**
 * `asc(method, path, body)`: the parsed JSON reply, null for 204, or a throw
 * naming the method, path, status and Apple's own text.
 */
function makeClient({ keyId, issuerId, key, fetch }) {
  if (!keyId) throw new Error('APP_STORE_CONNECT_KEY_ID is required');
  if (!issuerId) throw new Error('APP_STORE_CONNECT_ISSUER_ID is required');
  return async function asc(method, path, body) {
    const jwt = makeJwt({ keyId, issuerId, key, nowSeconds: Math.floor(Date.now() / 1000) });
    const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`ASC API ${method} ${path} → ${res.status}: ${await res.text()}`);
    }
    if (res.status === 204) return null;
    return res.json();
  };
}

/**
 * The .p8 key: an explicit path, else the one setup-ios-signing writes under
 * $RUNNER_TEMP (Phase-0 #63), else the legacy ~/private_keys/ path.
 */
function resolveKeyPath(env, keyId, existsSync) {
  if (env.APP_STORE_CONNECT_KEY_PATH) return env.APP_STORE_CONNECT_KEY_PATH;
  const runnerTemp = env.RUNNER_TEMP ? `${env.RUNNER_TEMP}/private_keys/AuthKey_${keyId}.p8` : null;
  if (runnerTemp && existsSync(runnerTemp)) return runnerTemp;
  return `${env.HOME}/private_keys/AuthKey_${keyId}.p8`;
}

/** The client CI uses: credentials from the environment, the key from disk. */
function clientFromEnv(env = process.env) {
  const fs = require('node:fs');
  const keyId = env.APP_STORE_CONNECT_KEY_ID;
  const keyPath = resolveKeyPath(env, keyId, fs.existsSync);
  if (!fs.existsSync(keyPath)) throw new Error(`App Store Connect API key not found at ${keyPath}`);
  return makeClient({
    keyId,
    issuerId: env.APP_STORE_CONNECT_ISSUER_ID,
    key: fs.readFileSync(keyPath, 'utf8'),
    fetch: globalThis.fetch,
  });
}

module.exports = { makeJwt, makeClient, resolveKeyPath, clientFromEnv };
