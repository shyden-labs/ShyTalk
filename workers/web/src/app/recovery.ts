/**
 * A pending recovery (plan 6 Task 4, shyden-labs/ShyTalk#133,
 * docs/superpowers/specs/2026-11-11-email-code-sign-up-recovery-design.md):
 * `GET /api/app/recovery` shows a signed-in device the member's pending
 * recovery; `POST /api/app/recovery/cancel` ends it, from a signed-in device
 * or from the notice's link (`{cancelToken}`). A cancel answers the same
 * whether or not anything was pending.
 */
import { auditIfChanged, type AuditDatabase } from '../audit.ts';
import { json } from '../http.ts';
import { RECOVERY_LAPSE_MS, tokenHash } from './email-code.ts';
import { objectBody } from './email-routes.ts';
import { signedOut, type AppSession } from './session.ts';

interface D1Answer {
  meta: { changes: number };
  results?: unknown[];
}

export interface RecoveryEnv {
  ENVIRONMENT_NAME: 'prod' | 'test' | 'dev';
  DB: AuditDatabase<unknown> & { batch(statements: unknown[]): Promise<D1Answer[]> };
}

/** The request's live session, or null: the router passes Better Auth's. */
export type SessionOf = (request: Request) => Promise<AppSession | null>;

interface Pending {
  id: number;
  started_at: number;
  completes_at: number;
}

const PENDING_SQL = "SELECT id, started_at, completes_at FROM account_recovery WHERE user_id = ? AND state = 'pending'";
const BY_CANCEL_TOKEN_SQL = "SELECT id, user_id FROM account_recovery WHERE cancel_token_hash = ? AND state = 'pending'";
const CANCEL_SQL = "UPDATE account_recovery SET state = 'cancelled', ended_at = ? WHERE id = ? AND state = 'pending'";
const SPEND_TOKENS_SQL = "UPDATE one_time_token SET used_at = ? WHERE user_id = ? AND purpose = 'recovery' AND used_at IS NULL";

const OK = (): Response => json(200, { ok: true });
const notAllowed = (allow: string): Response => new Response(null, { status: 405, headers: { allow } });

async function pendingFor(env: RecoveryEnv, userId: string): Promise<Pending | undefined> {
  const [found] = await env.DB.batch([env.DB.prepare(PENDING_SQL).bind(userId)]);
  return found?.results?.[0] as Pending | undefined;
}

export async function handleRecoveryPending(
  request: Request,
  env: RecoveryEnv,
  sessionOf: SessionOf,
  now: () => number = Date.now,
): Promise<Response> {
  if (request.method !== 'GET') return notAllowed('GET');
  const session = await sessionOf(request);
  if (session === null) return signedOut();
  const pending = await pendingFor(env, session.userId);
  if (pending === undefined || now() > pending.completes_at + RECOVERY_LAPSE_MS) return json(200, { pending: null });
  return json(200, {
    pending: { startedAt: new Date(pending.started_at).toISOString(), completesAt: new Date(pending.completes_at).toISOString() },
  });
}

export async function handleRecoveryCancel(
  request: Request,
  env: RecoveryEnv,
  sessionOf: SessionOf,
  now: () => number = Date.now,
): Promise<Response> {
  if (request.method !== 'POST') return notAllowed('POST');
  const body = await objectBody(request);
  if (body === null) return json(400, { error: 'bad_request' });

  const { DB } = env;
  const cancelToken = body['cancelToken'];
  let found: { id: number; userId: string; actor: string; by: 'session' | 'email-link' } | null = null;
  // The notice's link names its recovery: it wins over whatever account the browser is signed into.
  if (typeof cancelToken === 'string' && cancelToken !== '') {
    const [answer] = await DB.batch([DB.prepare(BY_CANCEL_TOKEN_SQL).bind(await tokenHash(cancelToken))]);
    const row = answer?.results?.[0] as { id: number; user_id: string } | undefined;
    if (row !== undefined) found = { id: row.id, userId: row.user_id, actor: 'public', by: 'email-link' };
  } else {
    const session = await sessionOf(request);
    const pending = session === null ? undefined : await pendingFor(env, session.userId);
    if (session !== null && pending !== undefined)
      found = { id: pending.id, userId: session.userId, actor: `user:${session.userId}`, by: 'session' };
  }
  if (found === null) return OK();

  const at = now();
  const subject = `user:${found.userId}`;
  // The audit row follows the cancel and is written only if the cancel changed the row.
  await DB.batch([
    DB.prepare(SPEND_TOKENS_SQL).bind(at, found.userId),
    // An authenticator the recovery had started setting up goes too (shyden-labs/ShyTalk#134).
    DB.prepare('DELETE FROM totp_pending WHERE user_id = ?').bind(found.userId),
    DB.prepare(CANCEL_SQL).bind(at, found.id),
    auditIfChanged(env, { actor: found.actor, action: 'recovery.cancel', subject, detail: { by: found.by } }),
  ]);
  return OK();
}
