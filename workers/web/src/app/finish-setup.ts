/**
 * The end of setting up a sign-in method (plan 7, shyden-labs/ShyTalk#134;
 * shyden-labs/ShyTalk#133 AC2, AC3), shared by passkeys and the authenticator
 * app. A sign-up becomes a member here, with the method and recovery codes, in
 * one batch with their audit rows, then a session: an abandoned sign-up leaves
 * no account. A recovery completes, ends every session of the member and
 * starts a fresh one. A signed-in member adding a method gets codes only when
 * they hold none.
 */
import { audit, auditIfChanged } from '../audit.ts';
import type { ShyTalkAuth } from '../auth/better-auth.ts';
import { json } from '../http.ts';
import { startSession } from './code-sign-in.ts';
import { replaceRecoveryCodes, type CodeSignInEnv } from './recovery-codes.ts';
import type { SetupIdentity } from './setup-identity.ts';
import type { SignInEnv } from './sign-in.ts';

export type MethodKind = 'passkey' | 'totp';

export interface Finished {
  userId: string;
  /** A new session's token, for a sign-up or a recovery. */
  token?: string;
  /** Codes to show once, when a new set was made. */
  recoveryCodes?: string[];
}

const CREATE_USER_SQL = 'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)';
const SPEND_TOKEN_SQL = 'UPDATE one_time_token SET used_at = ? WHERE token_hash = ? AND used_at IS NULL';
const COMPLETE_RECOVERY_SQL = "UPDATE account_recovery SET state = 'completed', ended_at = ? WHERE id = ? AND state = 'pending'";
const END_SESSIONS_SQL = 'DELETE FROM session WHERE "userId" = ?';
const REMOVE_PASSKEYS_SQL = 'DELETE FROM passkey WHERE "userId" = ?';
const REMOVE_TOTP_SQL = "DELETE FROM sign_in_method WHERE user_id = ? AND kind = 'totp'";
const CODES_HELD_SQL = 'SELECT COUNT(*) AS n FROM recovery_code WHERE user_id = ? AND used_at IS NULL';

async function holdsCodes(env: SignInEnv, userId: string): Promise<boolean> {
  const answers = (await env.DB.batch([env.DB.prepare(CODES_HELD_SQL).bind(userId)])) as { results: { n: number }[] }[];
  return (answers[0] as { results: { n: number }[] }).results.some(({ n }) => n > 0);
}

/**
 * Everything of a setup but the session: the token spent first (401 if it was
 * spent already), then one batch with the member, the method's own statements
 * (`methodStatements`, which make it live), the recovery's end and the codes.
 * The passkey path runs this inside the plugin, before it writes the passkey.
 */
export async function prepareSetup(
  env: SignInEnv,
  identity: SetupIdentity,
  method: MethodKind,
  now: number,
  methodStatements: unknown[] = [],
): Promise<Pick<Finished, 'userId' | 'recoveryCodes'> | Response> {
  const { DB } = env;
  const { userId } = identity;
  const actor = `user:${userId}`;
  const at = new Date(now).toISOString();
  const statements: unknown[] = [];

  // The token is spent first, alone: only the request that spends it goes on. A cancelled recovery's tokens are spent by
  // the cancel (./recovery.ts), so a recovery cancelled after its identity was read stops here.
  if (identity.kind !== 'session') {
    const [spent] = (await DB.batch([DB.prepare(SPEND_TOKEN_SQL).bind(now, identity.tokenHash)])) as { meta: { changes: number } }[];
    if (spent?.meta.changes !== 1) return json(401, { error: 'sign_in_refused' });
  }

  if (identity.kind === 'sign-up') {
    statements.push(
      DB.prepare(CREATE_USER_SQL).bind(userId, identity.email.slice(0, identity.email.indexOf('@')), identity.email, at, at),
      audit(env, { actor, action: 'user.create', subject: actor, detail: { via: 'email' } }),
    );
  } else if (identity.kind === 'recovery') {
    // A recovery is for a member who lost every way in, so the old passkeys and authenticator (on lost or stolen devices)
    // go; the method being set up stays, and so do Google and Apple links.
    const removed = (kind: MethodKind) =>
      auditIfChanged(env, { actor, action: 'method.remove', subject: actor, detail: { kind, reason: 'recovery' } });
    statements.push(
      DB.prepare(COMPLETE_RECOVERY_SQL).bind(now, identity.recoveryId),
      auditIfChanged(env, { actor, action: 'recovery.complete', subject: actor }),
      DB.prepare(END_SESSIONS_SQL).bind(userId),
      DB.prepare(REMOVE_PASSKEYS_SQL).bind(userId),
      removed('passkey'),
      ...(method === 'totp' ? [] : [DB.prepare(REMOVE_TOTP_SQL).bind(userId), removed('totp')]),
    );
  }
  statements.push(...methodStatements, audit(env, { actor, action: 'method.add', subject: actor, detail: { kind: method } }));

  let recoveryCodes: string[] | undefined;
  if (identity.kind !== 'session' || !(await holdsCodes(env, userId))) {
    const fresh = await replaceRecoveryCodes(env as unknown as CodeSignInEnv, userId, actor);
    statements.push(...fresh.statements);
    recoveryCodes = fresh.codes;
  }

  try {
    await DB.batch(statements);
  } catch {
    return json(500, { error: 'setup_failed' });
  }
  return { userId, ...(recoveryCodes === undefined ? {} : { recoveryCodes }) };
}

/** Finishes setting up `method` for `identity`, with a session for a sign-up or a recovery; 401 or 500 when refused. */
export async function finishSetup(
  env: SignInEnv,
  auth: ShyTalkAuth,
  identity: SetupIdentity,
  method: MethodKind,
  now: number,
  methodStatements: unknown[] = [],
): Promise<Finished | Response> {
  const prepared = await prepareSetup(env, identity, method, now, methodStatements);
  if (prepared instanceof Response || identity.kind === 'session') return prepared;
  const started = await startSession(env, auth, prepared.userId, { method, via: identity.kind });
  if (started instanceof Response) return started;
  return { ...prepared, token: started.token };
}
