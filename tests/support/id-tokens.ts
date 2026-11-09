import { createLocalJWKSet, importJWK, SignJWT, type JWK, type JWTVerifyGetKey } from 'jose';
import type { IdTokenKeys } from '../setup/id-token-keys.ts';

/**
 * Google and Apple ID tokens for the sign-in tests (plan 4 Task 3,
 * shyden-labs/ShyTalk#76), signed by a local key whose set stands in for the
 * provider's published keys.
 */

export const GOOGLE_ISSUER = 'https://accounts.google.com';
export const APPLE_ISSUER = 'https://appleid.apple.com';
const ANDROID_ID = 'android.apps.googleusercontent.com';
export const GOOGLE_IDS = ['web.apps.googleusercontent.com', ANDROID_ID, 'ios.apps.googleusercontent.com'];
export const APPLE_ID = 'com.shyden.shytalk';

export interface Claims {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  nonce?: string;
  /** Seconds from now the token expires; negative is already expired. */
  expiresIn?: number;
  /** Signs with a key that is not in the provider's set. */
  foreign?: boolean;
}

export interface Issuer {
  /** The provider's key set, holding only the signing key. */
  keys: JWTVerifyGetKey;
  /** A Google ID token (Apple's when `iss` and `aud` say so) with `claims` over good defaults. */
  idToken(claims?: Claims): Promise<string>;
  /** An Apple ID token carrying the SHA-256 of `rawNonce`, as Apple's native sign-in signs it. */
  appleToken(rawNonce: string, claims?: Claims): Promise<string>;
}

export const sha256Hex = async (value: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

/** The public half of a private RSA JWK. */
const publicOf = ({ d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...rest }: JWK): JWK => rest;

/**
 * Token makers signing with `keys`, the run's keys from the unit setup
 * (`inject('idTokenKeys')`, tests/setup/id-token-keys.ts), and the provider
 * key set holding only the signing key's public half.
 */
export async function issuer(keys: IdTokenKeys): Promise<Issuer> {
  const signing = await importJWK(keys.signing, 'RS256');
  const foreign = await importJWK(keys.foreign, 'RS256');
  const publicJwk: JWK = { ...publicOf(keys.signing), kid: 'k1', alg: 'RS256', use: 'sig' };
  const idToken = async (claims: Claims = {}): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    const body: Record<string, unknown> = {
      email: claims.email ?? 'ana@example.test',
      email_verified: claims.email_verified ?? true,
      name: 'Ana',
    };
    if (claims.nonce !== undefined) body['nonce'] = claims.nonce;
    return new SignJWT(body)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(claims.iss ?? GOOGLE_ISSUER)
      .setAudience(claims.aud ?? ANDROID_ID)
      .setSubject(claims.sub ?? 'google-sub-1')
      .setIssuedAt(now - 60)
      .setExpirationTime(now + (claims.expiresIn ?? 600))
      .sign(claims.foreign === true ? foreign : signing);
  };
  return {
    keys: createLocalJWKSet({ keys: [publicJwk] }),
    idToken,
    appleToken: async (rawNonce, claims = {}) =>
      idToken({ iss: APPLE_ISSUER, aud: APPLE_ID, sub: 'apple-sub-1', nonce: await sha256Hex(rawNonce), ...claims }),
  };
}
