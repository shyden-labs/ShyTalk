/**
 * The authenticator app (plan 7 Task 4, shyden-labs/ShyTalk#134 AC2,
 * docs/superpowers/specs/2026-11-09-passkeys-totp-recovery-design.md): RFC 6238
 * codes of 6 digits every 30 s, the previous, current and next step accepted.
 * The secret is kept only as AES-GCM ciphertext under `TOTP_KEY` (a Wrangler
 * secret apart from Better Auth's); a step at or below the last one accepted
 * is refused, and taking a step is one conditional UPDATE, so one code signs
 * in once. Tries are reserved on the address first (./recovery-codes.ts).
 */
import { createOTP } from '@better-auth/utils/otp';
import { clearTries, lockIfSpent, reserveTry, type CodeSignInEnv } from './recovery-codes.ts';

export interface TotpEnv extends CodeSignInEnv {
  /** Seals authenticator secrets (a Wrangler secret). */
  TOTP_KEY: string;
}

const PERIOD_SECONDS = 30;
const DIGITS = 6;
const SECRET_BYTES = 20;
const NONCE_BYTES = 12;

interface MethodRow {
  id: number;
  secret_enc: string;
  last_step: number;
}

/** A pending authenticator, confirmed by a current code: its sealed secret and the step that confirmed it. */
export interface ConfirmedTotp {
  secretEnc: string;
  step: number;
}

const METHOD_SQL = "SELECT id, secret_enc, last_step FROM sign_in_method WHERE user_id = ? AND kind = 'totp'";
const LIVE_SQL = "SELECT id FROM sign_in_method WHERE user_id = ? AND kind = 'totp'";
const PENDING_SQL = 'SELECT secret_enc, flow, created_at FROM totp_pending WHERE user_id = ?';
/** A pending authenticator is confirmed within a day of its setup, or not at all. */
const PENDING_LIFE_MS = 86_400_000;

async function sealingKey(key: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

/** `secret` sealed under `key`: base64 of a fresh 12-byte nonce and the AES-GCM ciphertext. */
export async function encryptSecret(key: string, secret: Uint8Array<ArrayBuffer>): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await sealingKey(key), secret));
  return toBase64(new Uint8Array([...nonce, ...sealed]));
}

/** The secret `sealed` holds, or null when it is not one sealed under `key`. */
export async function decryptSecret(key: string, sealed: string): Promise<Uint8Array | null> {
  try {
    const bytes = Uint8Array.from(atob(sealed), (char) => char.charCodeAt(0));
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, NONCE_BYTES) },
      await sealingKey(key),
      bytes.slice(NONCE_BYTES),
    );
    return new Uint8Array(opened);
  } catch {
    return null;
  }
}

/** The step whose code `code` is, among the previous, current and next, if it is above `lastStep`; else null. */
export async function matchStep(secret: Uint8Array, code: unknown, now: number, lastStep: number): Promise<number | null> {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const otp = createOTP(secret, { digits: DIGITS, period: PERIOD_SECONDS });
  const current = Math.floor(now / (PERIOD_SECONDS * 1000));
  for (const step of [current - 1, current, current + 1]) {
    if (step > lastStep && (await otp.hotp(step)) === code) return step;
  }
  return null;
}

async function methodOf(env: TotpEnv, userId: string): Promise<MethodRow | undefined> {
  const [found] = await env.DB.batch([env.DB.prepare(METHOD_SQL).bind(userId)]);
  return (found as { results: unknown[] }).results[0] as MethodRow | undefined;
}

/**
 * Starts (or restarts) a pending authenticator for the member and answers the
 * `otpauth://` URI to show once; null when a live one exists, unless
 * `replaceLive` (a recovery's). `flow` (a session, or the setup token's
 * hash) ties it to the setup that started it. The pending secret sits apart from the live
 * one, which nothing here touches: it becomes live only in the finish batch
 * (`totpGoesLive`), after the setup's token is spent.
 */
export async function setupTotp(
  env: TotpEnv,
  userId: string,
  email: string,
  now: number,
  options: { flow: string; replaceLive?: boolean },
): Promise<{ uri: string } | null> {
  const { DB } = env;
  if (options.replaceLive !== true) {
    const [live] = await DB.batch([DB.prepare(LIVE_SQL).bind(userId)]);
    if ((live as { results: unknown[] }).results.length > 0) return null;
  }
  const secret = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
  await DB.batch([
    // A setup never confirmed keeps its sealed secret a day at most.
    DB.prepare('DELETE FROM totp_pending WHERE created_at < ?').bind(now - PENDING_LIFE_MS),
    DB.prepare(
      'INSERT INTO totp_pending (user_id, secret_enc, flow, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET secret_enc = excluded.secret_enc, flow = excluded.flow, created_at = excluded.created_at',
    ).bind(userId, await encryptSecret(env.TOTP_KEY, secret), options.flow, now),
  ]);
  return { uri: createOTP(secret, { digits: DIGITS, period: PERIOD_SECONDS }).url('ShyTalk', email) };
}

/**
 * The member's pending authenticator, when `code` is current for it and it was
 * started by this same `flow` (a session, or one token's hash) within a day;
 * null otherwise. Writes nothing.
 */
export async function confirmTotp(env: TotpEnv, userId: string, code: unknown, now: number, flow: string): Promise<ConfirmedTotp | null> {
  const [found] = await env.DB.batch([env.DB.prepare(PENDING_SQL).bind(userId)]);
  const pending = (found as { results: unknown[] }).results[0] as { secret_enc: string; flow: string; created_at: number } | undefined;
  if (pending === undefined || pending.flow !== flow || pending.created_at < now - PENDING_LIFE_MS) return null;
  const secret = await decryptSecret(env.TOTP_KEY, pending.secret_enc);
  // A secret that will not open (sealed under an earlier TOTP_KEY) confirms nothing.
  const step = secret === null ? null : await matchStep(secret, code, now, 0);
  return step === null ? null : { secretEnc: pending.secret_enc, step };
}

/** Statements, for the finish batch, that make a confirmed authenticator the member's live one. */
export function totpGoesLive(env: TotpEnv, userId: string, confirmed: ConfirmedTotp, now: number): unknown[] {
  const { DB } = env;
  return [
    DB.prepare(
      "INSERT INTO sign_in_method (user_id, kind, secret_enc, last_step, created_at) VALUES (?, 'totp', ?, ?, ?) ON CONFLICT (user_id, kind) DO UPDATE SET secret_enc = excluded.secret_enc, last_step = excluded.last_step, created_at = excluded.created_at",
    ).bind(userId, confirmed.secretEnc, confirmed.step, now),
    DB.prepare('DELETE FROM totp_pending WHERE user_id = ?').bind(userId),
  ];
}

/** The member `code` signs in, or null for any refusal. */
export async function signInTotp(env: TotpEnv, email: string, code: unknown, now: number): Promise<string | null> {
  const reserved = await reserveTry(env, email, 'totp', now);
  if (reserved === null) return null;
  const method = reserved.userId === null ? undefined : await methodOf(env, reserved.userId);
  if (reserved.userId !== null && method !== undefined) {
    const secret = await decryptSecret(env.TOTP_KEY, method.secret_enc);
    const step = secret === null ? null : await matchStep(secret, code, now, method.last_step);
    if (step !== null) {
      const { DB } = env;
      const [taken] = await DB.batch([
        DB.prepare('UPDATE sign_in_method SET last_step = ? WHERE id = ? AND last_step < ?').bind(step, method.id, step),
      ]);
      if (taken?.meta.changes === 1) {
        await clearTries(env, reserved.hash, 'totp');
        return reserved.userId;
      }
    }
  }
  await lockIfSpent(env, reserved.hash, 'totp', now);
  return null;
}
