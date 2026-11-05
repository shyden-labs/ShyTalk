/**
 * ShyTalk's one ID-token check (plan 4 Task 3, shyden-labs/ShyTalk#76), used
 * by Better Auth for Google and Apple in place of its own, so the Worker and
 * the tests run the same code: the Worker against the providers' published
 * keys, the tests against a local key set.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface IdTokenCheck {
  /** The provider's signing keys. */
  keys: JWTVerifyGetKey;
  /** The issuers the provider signs as. */
  issuer: string[];
  /** Our client IDs: a token for anyone else's app is refused. */
  audience: string[];
  /**
   * `required`: the token must carry the SHA-256 (hex) of the raw nonce the
   * app sends beside it (Apple's native sign-in). Otherwise a nonce, when the
   * app sends one, must match exactly.
   */
  nonce?: 'required';
}

/** The clock skew allowed on `exp`, `nbf` and `iat`, as Better Auth allows. */
const CLOCK_TOLERANCE_SECONDS = 30;

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
export const APPLE_ISSUERS = ['https://appleid.apple.com'];

/** Fetched on first use and cached by jose; nothing is fetched at start-up. */
export const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export const APPLE_KEYS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

const sha256Hex = async (value: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

/** Whether `token` is a live ID token the provider signed for one of our apps. */
export async function verifyIdToken(token: string, check: IdTokenCheck, nonce?: string): Promise<boolean> {
  if (check.audience.length === 0) return false;
  if (check.nonce === 'required' && nonce === undefined) return false;
  try {
    const { payload } = await jwtVerify(token, check.keys, {
      issuer: check.issuer,
      audience: check.audience,
      algorithms: ['RS256'],
      requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    if (nonce === undefined) return true;
    const expected = check.nonce === 'required' ? await sha256Hex(nonce) : nonce;
    return payload['nonce'] === expected;
  } catch {
    return false;
  }
}
