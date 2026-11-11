/**
 * A member's sign-in methods and devices (plan 7 Task 6, shyden-labs/ShyTalk#134
 * AC4, AC6, AC7). `GET /api/app/sign-in-methods` lists them; `DELETE
 * /api/app/sign-in-methods/passkey/:id` and `/totp` remove one, but never the
 * last way in: the check is inside the DELETE (Google and Apple links count,
 * recovery codes do not), so two removals at one moment cannot both pass it.
 * `POST /api/app/recovery-codes` makes a new set, ending the old one.
 * `GET /api/app/sessions` lists the member's sessions; `DELETE
 * /api/app/sessions/:id` ends one with sign-out's chain of audit rows.
 */
import { audit, auditIfChanged, type AuditDatabase } from '../audit.ts';
import { json } from '../http.ts';
import { objectBody } from './email-routes.ts';
import { replaceRecoveryCodes, type CodeSignInEnv } from './recovery-codes.ts';
import { signedOut, type AppSession } from './session.ts';

/** D1 answers every statement of a batch with its rows (empty for a write) and what it changed. */
interface D1Answer {
  meta: { changes: number };
  results: unknown[];
}

export interface MethodsEnv {
  ENVIRONMENT_NAME: 'prod' | 'test' | 'dev';
  DB: AuditDatabase<unknown> & { batch(statements: unknown[]): Promise<D1Answer[]> };
}

const LINKED = `(SELECT COUNT(*) FROM account WHERE "userId" = ? AND "providerId" IN ('google', 'apple'))`;
const REMOVE_PASSKEY_SQL = `DELETE FROM passkey WHERE id = ? AND "userId" = ? AND ((SELECT COUNT(*) FROM passkey WHERE "userId" = ? AND id <> ?) + (SELECT COUNT(*) FROM sign_in_method WHERE user_id = ?) + ${LINKED}) > 0`;
const REMOVE_TOTP_SQL = `DELETE FROM sign_in_method WHERE user_id = ? AND kind = 'totp' AND ((SELECT COUNT(*) FROM passkey WHERE "userId" = ?) + ${LINKED}) > 0`;

const rows = <T>(answer: D1Answer | undefined): T[] => (answer as D1Answer).results as T[];
const notFound = (): Response => json(404, { error: 'not_found' });
const ok = (): Response => json(200, { ok: true });

async function listMethods(env: MethodsEnv, userId: string): Promise<Response> {
  const { DB } = env;
  const [passkeys, totp, linked, codes] = await DB.batch([
    DB.prepare('SELECT id, name, "createdAt" FROM passkey WHERE "userId" = ? ORDER BY "createdAt"').bind(userId),
    DB.prepare("SELECT COUNT(*) AS n FROM sign_in_method WHERE user_id = ? AND kind = 'totp'").bind(userId),
    DB.prepare(`SELECT "providerId" FROM account WHERE "userId" = ? AND "providerId" IN ('google', 'apple')`).bind(userId),
    DB.prepare('SELECT COUNT(*) AS n FROM recovery_code WHERE user_id = ? AND used_at IS NULL').bind(userId),
  ]);
  return json(200, {
    passkeys: rows<{ id: string; name: string | null; createdAt: string }>(passkeys),
    authenticator: rows<{ n: number }>(totp).some(({ n }) => n > 0),
    linked: rows<{ providerId: string }>(linked).map(({ providerId }) => providerId),
    recoveryCodesLeft: rows<{ n: number }>(codes).reduce((sum, { n }) => sum + n, 0),
  });
}

async function removeMethod(env: MethodsEnv, userId: string, kind: 'passkey' | 'totp', id: string | null): Promise<Response> {
  const { DB } = env;
  const exists =
    kind === 'passkey'
      ? DB.prepare('SELECT 1 FROM passkey WHERE id = ? AND "userId" = ?').bind(id, userId)
      : DB.prepare("SELECT 1 FROM sign_in_method WHERE user_id = ? AND kind = 'totp'").bind(userId);
  const [found] = await DB.batch([exists]);
  if (rows(found).length === 0) return notFound();
  const actor = `user:${userId}`;
  const removal =
    kind === 'passkey'
      ? DB.prepare(REMOVE_PASSKEY_SQL).bind(id, userId, userId, id, userId, userId)
      : DB.prepare(REMOVE_TOTP_SQL).bind(userId, userId, userId);
  const [removed] = await DB.batch([
    removal,
    auditIfChanged(env, { actor, action: 'method.remove', subject: actor, detail: kind === 'passkey' ? { kind, id } : { kind } }),
  ]);
  return removed?.meta.changes === 1 ? ok() : json(409, { error: 'last_method' });
}

async function listSessions(env: MethodsEnv, session: AppSession): Promise<Response> {
  const [found] = await env.DB.batch([
    env.DB.prepare('SELECT id, "createdAt", "userAgent" FROM session WHERE "userId" = ? ORDER BY "createdAt" DESC').bind(session.userId),
  ]);
  return json(200, {
    sessions: rows<{ id: string; createdAt: string; userAgent: string | null }>(found).map((row) => ({
      id: row.id,
      startedAt: row.createdAt,
      device: row.userAgent,
      current: row.id === session.sessionId,
    })),
  });
}

/** Ends one of the member's sessions as sign-out does (./sign-in.ts): an attempt row first, then the delete and its success row together. */
async function endSession(env: MethodsEnv, userId: string, sessionId: string): Promise<Response> {
  const { DB } = env;
  const [found] = await DB.batch([DB.prepare('SELECT 1 FROM session WHERE id = ? AND "userId" = ?').bind(sessionId, userId)]);
  if (rows(found).length === 0) return notFound();
  const actor = `user:${userId}`;
  const chain = crypto.randomUUID();
  const row = (action: string, detail: Record<string, unknown> = {}): unknown =>
    audit(env, { actor, action: `session.end.${action}`, subject: actor, detail: { chain, revoked: sessionId, ...detail } });
  try {
    await DB.batch([row('attempt')]);
  } catch {
    return json(500, { error: 'revoke_failed' });
  }
  try {
    await DB.batch([DB.prepare('DELETE FROM session WHERE id = ? AND "userId" = ?').bind(sessionId, userId), row('success')]);
  } catch (error) {
    // The session stays; its chain says why. If even that row cannot be written, the attempt row already stands.
    await DB.batch([row('failure', { error: String(error) })]).catch(() => undefined);
    return json(500, { error: 'revoke_failed' });
  }
  return ok();
}

/** `request` under `/api/app/sign-in-methods` or `/api/app/sessions`; `sessionOf` reads its session. */
export async function handleMethods(
  request: Request,
  env: MethodsEnv,
  sessionOf: (request: Request) => Promise<AppSession | null>,
): Promise<Response> {
  const parts = new URL(request.url).pathname.split('/').slice(3);
  const [area, kind, id] = parts;
  const allowed = area === 'recovery-codes' ? 'POST' : parts.length === 1 ? 'GET' : 'DELETE';
  if (request.method !== allowed) return new Response(null, { status: 405, headers: { allow: allowed } });
  const session = await sessionOf(request);
  if (session === null) return signedOut();

  if (area === 'recovery-codes') {
    if (parts.length > 1) return notFound();
    // JSON only: a form on another site can send none, so it cannot make new codes with the member's cookie.
    if ((await objectBody(request)) === null) return json(400, { error: 'bad_request' });
    // A new set ends the old one (AC3); the codes are shown once, here.
    const actor = `user:${session.userId}`;
    const { statements, codes } = await replaceRecoveryCodes(env as unknown as CodeSignInEnv, session.userId, actor);
    await env.DB.batch(statements);
    return json(200, { recoveryCodes: codes });
  }
  if (area === 'sign-in-methods') {
    if (parts.length === 1) return listMethods(env, session.userId);
    if (kind === 'passkey' && parts.length === 3 && id !== undefined && id !== '')
      return removeMethod(env, session.userId, 'passkey', decodeURIComponent(id));
    if (kind === 'totp' && parts.length === 2) return removeMethod(env, session.userId, 'totp', null);
    return notFound();
  }
  if (parts.length === 1) return listSessions(env, session);
  if (parts.length !== 2 || kind === undefined || kind === '') return notFound();
  return endSession(env, session.userId, decodeURIComponent(kind));
}
