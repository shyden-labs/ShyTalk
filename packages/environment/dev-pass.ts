/**
 * The partner site's one-use dev pass (shyden-labs/ShyTalk#263). The partner
 * links to `https://<dev host>/?dev_pass=<token>`, where the token is
 * base64url(payload JSON) "." base64url(HMAC-SHA256(secret, the first part)),
 * unpadded, and the payload is `{v: 1, host, exp, nonce}` with `exp` in unix
 * seconds, 60 seconds after minting. This file checks the signature and the
 * fields; one use per nonce is the caller's job.
 */

/** A pass whose signature and fields hold: its nonce, to be used once, and its expiry in unix seconds. */
export interface DevPass {
  nonce: string;
  exp: number;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

const toBase64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

/** The bytes `text` encodes, or null unless it is their one canonical unpadded base64url form. */
function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL.test(text)) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
  } catch {
    // A length no bytes encode (one character over a multiple of four).
    return null;
  }
  // Unused bits in the last character would let one value be written several ways.
  return toBase64url(bytes) === text ? bytes : null;
}

async function signatureHolds(body: string, signature: Uint8Array<ArrayBuffer>, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  // `verify` compares in constant time.
  return crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(body));
}

function parse(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The pass `token` carries when it is signed with `secret`, made for `host`,
 * of version 1 and not expired at `nowSeconds`; otherwise null. An unset or
 * empty secret accepts nothing.
 */
export async function readDevPass(token: string, secret: string | undefined, host: string, nowSeconds: number): Promise<DevPass | null> {
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body = '', signed = ''] = parts;
  const bodyBytes = fromBase64url(body);
  const signature = fromBase64url(signed);
  if (bodyBytes === null || signature === null) return null;
  if (!(await signatureHolds(body, signature, secret))) return null;
  const payload = parse(bodyBytes);
  if (payload === null) return null;
  const { v, host: madeFor, exp, nonce } = payload;
  if (v !== 1 || madeFor !== host) return null;
  if (typeof nonce !== 'string' || nonce === '') return null;
  if (typeof exp !== 'number' || !Number.isInteger(exp) || exp < nowSeconds) return null;
  return { nonce, exp };
}
