/**
 * The email code's rules (plan 6 Task 1, shyden-labs/ShyTalk#133,
 * docs/superpowers/specs/2026-11-11-email-code-sign-up-recovery-design.md):
 * one spelling per address, keyed hashes so no address or code is stored
 * plain, uniform 6-digit codes, and one-time tokens kept only as hashes.
 */
import { checkMessage } from '../../../../packages/mail/index.ts';

/** A code lives 10 minutes; 5 wrong tries spend it. */
export const CODE_TTL_MS = 600_000;
export const MAX_WRONG_TRIES = 5;
/** A sign-up token lives 30 minutes. */
export const SIGN_UP_TTL_MS = 1_800_000;
/** A recovery completes 24 hours after it starts, and lapses 24 hours after that. */
export const RECOVERY_WAIT_MS = 86_400_000;
export const RECOVERY_LAPSE_MS = 86_400_000;
/** Starts per address: 3 in 15 minutes, 10 in 24 hours. */
export const LIMIT_15_MIN = 3;
export const LIMIT_24_H = 10;

/** The largest multiple of 1,000,000 a 32-bit draw can reach, so `draw % 1e6` is uniform below it. */
const UNIFORM_BOUND = 4_294_000_000;

const encoder = new TextEncoder();

const hex = (buffer: ArrayBuffer): string => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** `raw` trimmed and lower-cased, or null when it is not an address mail can go to. */
export function normaliseAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const address = raw.trim().toLowerCase();
  return checkMessage({ to: address, subject: '-', text: '-' }) === null ? null : address;
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

/** The address as stored: hex HMAC-SHA256 under `secret`. */
export const addressHash = (secret: string, address: string): Promise<string> => hmac(secret, `address:${address}`);

/** A code as stored, bound to its address's hash. */
export const codeHash = (secret: string, hashOfAddress: string, code: string): Promise<string> =>
  hmac(secret, `code:${hashOfAddress}:${code}`);

const fill = (bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => crypto.getRandomValues(bytes);

/** A uniform 6-digit code; `random` fills a buffer with random bytes. */
export function newCode(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = fill): string {
  for (;;) {
    const bytes = random(new Uint8Array(4));
    const draw = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (draw < UNIFORM_BOUND) return String(draw % 1_000_000).padStart(6, '0');
  }
}

/** 32 random bytes as base64url, without padding. */
export function newToken(): string {
  const bytes = fill(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** A token as stored: hex SHA-256. */
export const tokenHash = async (token: string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
