/**
 * Recovery codes (plan 7 Task 3, shyden-labs/ShyTalk#134 AC3,
 * docs/superpowers/specs/2026-11-09-passkeys-totp-recovery-design.md): ten
 * one-time codes per set, 80 random bits each, shown once as four groups of
 * four Crockford base32 characters and kept only as SHA-256 (at 80 bits a slow
 * hash adds nothing). A new set replaces the old in the caller's batch.
 *
 * Signing in by a code (and by the authenticator app, Task 4) first reserves a
 * try on the address's keyed hash, so attempts at one moment cannot pass the
 * limit together, and known and unknown addresses do the same work.
 */
import { audit, type AuditDatabase } from '../audit.ts';
import { addressHash, tokenHash } from './email-code.ts';

/** D1 answers every statement of a batch with its rows (empty for a write) and what it changed. */
interface D1Answer {
  meta: { changes: number };
  results: unknown[];
}

export interface CodeSignInEnv {
  ENVIRONMENT_NAME: 'prod' | 'test' | 'dev';
  BETTER_AUTH_SECRET: string;
  DB: AuditDatabase<unknown> & { batch(statements: unknown[]): Promise<D1Answer[]> };
}

/** Five wrong tries lock signing in by that kind of code for 15 minutes (the same numbers as #61). */
export const MAX_WRONG_SIGN_INS = 5;
export const LOCK_MS = 15 * 60_000;
/** Each spent window doubles the next lock, up to 2^6 = 64 windows (16 hours), so guessing stays slow over months. */
export const MAX_LOCK_DOUBLINGS = 6;
export const RECOVERY_CODES_PER_SET = 10;

/** Crockford's base32: no I, L, O or U. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type LockKind = 'recovery-code' | 'totp';

const fill = (bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => crypto.getRandomValues(bytes);

/** 80 bits as 16 Crockford characters, in four groups of four. */
function encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  return [out.slice(0, 4), out.slice(4, 8), out.slice(8, 12), out.slice(12, 16)].join('-');
}

/** A new set of ten codes; `random` fills a 10-byte buffer. */
export function newRecoveryCodes(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = fill): string[] {
  return Array.from({ length: RECOVERY_CODES_PER_SET }, () => encode(random(new Uint8Array(10))));
}

/** A code as typed, made comparable: no dashes or spaces, upper case, I and L read as 1, O as 0; null if it cannot be one. */
export function normaliseRecoveryCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.replace(/[\s-]/g, '').toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(code) ? code : null;
}

/** A code as stored: SHA-256 of its normalised form (`normaliseRecoveryCode`). */
export const recoveryCodeHash = (normalised: string): Promise<string> => tokenHash(normalised);

/** Statements that replace the member's codes with a new set, and its audit row, for the caller's batch; and the codes to show once. */
export async function replaceRecoveryCodes(
  env: CodeSignInEnv,
  userId: string,
  actor: string,
): Promise<{ statements: unknown[]; codes: string[] }> {
  const { DB } = env;
  const codes = newRecoveryCodes();
  const setId = crypto.randomUUID();
  const hashes = await Promise.all(codes.map((code) => recoveryCodeHash(code.replaceAll('-', ''))));
  return {
    codes,
    statements: [
      DB.prepare('DELETE FROM recovery_code WHERE user_id = ?').bind(userId),
      ...hashes.map((hash) => DB.prepare('INSERT INTO recovery_code (user_id, set_id, hash) VALUES (?, ?, ?)').bind(userId, setId, hash)),
      audit(env, { actor, action: 'recovery_codes.new', subject: `user:${userId}`, detail: { codes: RECOVERY_CODES_PER_SET } }),
    ],
  };
}

/** Reserves one try of `kind` on the address, and finds its member; null when no try is left. */
export async function reserveTry(
  env: CodeSignInEnv,
  email: string,
  kind: LockKind,
  now: number,
): Promise<{ hash: string; userId: string | null } | null> {
  const { DB } = env;
  const address = email.trim().toLowerCase();
  const hash = await addressHash(env.BETTER_AUTH_SECRET, address);
  const answers = await DB.batch([
    DB.prepare(`INSERT OR IGNORE INTO sign_in_lock (address_hash, kind) VALUES (?, '${kind}')`).bind(hash),
    DB.prepare(
      `UPDATE sign_in_lock SET wrong_tries = wrong_tries + 1 WHERE address_hash = ? AND kind = '${kind}' AND locked_until <= ? AND wrong_tries < ?`,
    ).bind(hash, now, MAX_WRONG_SIGN_INS),
    DB.prepare('SELECT id FROM "user" WHERE email = ?').bind(address),
  ]);
  if (answers[1]?.meta.changes !== 1) return null;
  const user = (answers[2] as D1Answer).results[0] as { id: string } | undefined;
  return { hash, userId: user?.id ?? null };
}

/** After a wrong try: locks the address once its tries are used, for 15 minutes doubled by each lock before (up to 16 hours). */
export async function lockIfSpent(env: CodeSignInEnv, hash: string, kind: LockKind, now: number): Promise<void> {
  const { DB } = env;
  await DB.batch([
    DB.prepare(
      `UPDATE sign_in_lock SET locked_until = ? + ? * (1 << MIN(locks, ?)), locks = locks + 1, wrong_tries = 0 WHERE address_hash = ? AND kind = '${kind}' AND wrong_tries >= ?`,
    ).bind(now, LOCK_MS, MAX_LOCK_DOUBLINGS, hash, MAX_WRONG_SIGN_INS),
  ]);
}

/** After a right try: the address's tries and lock doubling start again. */
export async function clearTries(env: CodeSignInEnv, hash: string, kind: LockKind): Promise<void> {
  const { DB } = env;
  await DB.batch([DB.prepare(`UPDATE sign_in_lock SET wrong_tries = 0, locks = 0 WHERE address_hash = ? AND kind = '${kind}'`).bind(hash)]);
}

/** Spends `code` for the address's member: the member and the codes left, or null for any refusal. */
export async function useRecoveryCode(
  env: CodeSignInEnv,
  email: string,
  code: unknown,
  now: number,
): Promise<{ userId: string; left: number } | null> {
  const reserved = await reserveTry(env, email, 'recovery-code', now);
  if (reserved === null) return null;
  const normalised = normaliseRecoveryCode(code);
  if (reserved.userId !== null && normalised !== null) {
    const { DB } = env;
    const [spent, left] = await DB.batch([
      DB.prepare('UPDATE recovery_code SET used_at = ? WHERE user_id = ? AND hash = ? AND used_at IS NULL').bind(
        now,
        reserved.userId,
        await recoveryCodeHash(normalised),
      ),
      DB.prepare('SELECT COUNT(*) AS n FROM recovery_code WHERE user_id = ? AND used_at IS NULL').bind(reserved.userId),
    ]);
    if (spent?.meta.changes === 1) {
      await clearTries(env, reserved.hash, 'recovery-code');
      return { userId: reserved.userId, left: ((left as D1Answer).results as { n: number }[]).reduce((sum, { n }) => sum + n, 0) };
    }
  }
  await lockIfSpent(env, reserved.hash, 'recovery-code', now);
  return null;
}
