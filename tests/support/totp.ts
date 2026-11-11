/**
 * The journeys' authenticator app (shyden-labs/ShyTalk#134): it reads the key
 * the page shows and computes the code a member's app would (RFC 6238, 6
 * digits, 30 s), so the journeys type a real code, not a planted one.
 */
import { createOTP } from '@better-auth/utils/otp';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 as authenticator apps show it, spaces and case ignored. */
export function base32(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/\s/g, '').toUpperCase().replace(/=+$/, '');
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`not base32: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/** The code for the step `offset` steps from `now`. */
export const totpAt = (secret: Uint8Array, offset: number, now: number = Date.now()): Promise<string> =>
  createOTP(secret, { digits: 6, period: 30 }).hotp(Math.floor(now / 30_000) + offset);
