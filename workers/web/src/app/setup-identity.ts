/**
 * Who is setting up a sign-in method (plan 7 Task 2, shyden-labs/ShyTalk#134,
 * docs/superpowers/specs/2026-11-09-passkeys-totp-recovery-design.md): a
 * signed-in member; a sign-up holding #133's token, whose user row does not
 * exist yet; or a recovery whose 24 hours have passed. A sign-up token's member
 * id is made once and kept on the token, so a passkey and an authenticator
 * started from one token name one member.
 */
import type { AuditDatabase } from '../audit.ts';
import { json } from '../http.ts';
import { tokenHash } from './email-code.ts';
import type { AppSession } from './session.ts';

interface D1Answer {
  meta: { changes: number };
  results?: unknown[];
}

export interface SetupEnv {
  ENVIRONMENT_NAME: 'prod' | 'test' | 'dev';
  DB: AuditDatabase<unknown> & { batch(statements: unknown[]): Promise<D1Answer[]> };
}

export type SetupIdentity =
  | { kind: 'session'; userId: string }
  | { kind: 'sign-up'; userId: string; email: string; tokenHash: string }
  | { kind: 'recovery'; userId: string; recoveryId: number; tokenHash: string };

export interface SetupDeps {
  now: () => number;
  /** A new member id; Better Auth's own ids are random strings too. */
  newId: () => string;
}

/** A sign-up token holds its confirmed address (and its member id once claimed); a recovery token, its member (#133). */
type TokenRow = { expires_at: number; used_at: number | null } & (
  { purpose: 'sign-up'; email: string; user_id: string | null } | { purpose: 'recovery'; email: null; user_id: string }
);

const TOKEN_SQL = 'SELECT purpose, user_id, email, expires_at, used_at FROM one_time_token WHERE token_hash = ?';
/** Sets the member id only while none is set, so two setups at one moment name one member. */
const CLAIM_SQL = 'UPDATE one_time_token SET user_id = ? WHERE token_hash = ? AND user_id IS NULL';
const CLAIMED_SQL = 'SELECT user_id FROM one_time_token WHERE token_hash = ?';
const USER_SQL = 'SELECT id FROM "user" WHERE email = ?';
const RECOVERY_SQL = "SELECT id, completes_at FROM account_recovery WHERE user_id = ? AND state = 'pending'";

const refused = (): Response => json(401, { error: 'sign_in_refused' });

const firstRow = (answer: D1Answer | undefined): unknown => answer?.results?.[0];

/** The identity setting up a method, or the refusal to answer. */
export async function setupIdentity(
  env: SetupEnv,
  session: AppSession | null,
  token: string | null,
  deps: SetupDeps,
): Promise<SetupIdentity | Response> {
  if (session !== null) return { kind: 'session', userId: session.userId };
  if (token === null || token === '') return refused();
  return setupIdentityByHash(env, await tokenHash(token), deps);
}

/** As `setupIdentity` for the token whose SHA-256 is `hash`, without a session: the passkey plugin keeps the hash, never the token. */
export async function setupIdentityByHash(env: SetupEnv, hash: string, deps: SetupDeps): Promise<SetupIdentity | Response> {
  const now = deps.now();
  const { DB } = env;
  const [found] = await DB.batch([DB.prepare(TOKEN_SQL).bind(hash)]);
  const row = firstRow(found) as TokenRow | undefined;
  if (row === undefined || row.used_at !== null || row.expires_at < now) return refused();

  if (row.purpose === 'sign-up') {
    const [existing] = await DB.batch([DB.prepare(USER_SQL).bind(row.email)]);
    if (firstRow(existing) !== undefined) return json(409, { error: 'account_exists' });
    if (row.user_id !== null) return { kind: 'sign-up', userId: row.user_id, email: row.email, tokenHash: hash };
    const [, claimed] = await DB.batch([DB.prepare(CLAIM_SQL).bind(deps.newId(), hash), DB.prepare(CLAIMED_SQL).bind(hash)]);
    // The read-back names whichever setup claimed first: this one, or another at the same moment.
    const { user_id: userId } = firstRow(claimed) as { user_id: string };
    return { kind: 'sign-up', userId, email: row.email, tokenHash: hash };
  }

  const [pending] = await DB.batch([DB.prepare(RECOVERY_SQL).bind(row.user_id)]);
  const recovery = firstRow(pending) as { id: number; completes_at: number } | undefined;
  if (recovery === undefined) return refused();
  if (now < recovery.completes_at)
    return json(403, { error: 'recovery_waiting', completesAt: new Date(recovery.completes_at).toISOString() });
  return { kind: 'recovery', userId: row.user_id, recoveryId: recovery.id, tokenHash: hash };
}
