/**
 * App sign-in and sign-out (plan 4 Task 3, shyden-labs/ShyTalk#76):
 * `POST /api/app/sign-in/google {idToken}`, `POST /api/app/sign-in/apple
 * {idToken, nonce}` and `POST /api/app/sign-out`. Sign-in answers
 * `{token, userId}`; the app sends the token back as a bearer token.
 *
 * Better Auth runs D1 without transactions, so the audit row cannot share a
 * batch with the session (decision 222): sign-in writes it after the session
 * and, if that write fails, deletes the session and answers an error, so no
 * session exists without its row. Sign-out is a chain of rows sharing one
 * `chain` id (Shyden, 2026-11-05): `session.end.attempt` before the session
 * is touched, then `session.end.success`, or `session.end.failure` with the
 * error. No attempt row, no sign-out. The session's DELETE and the success
 * row share one D1 batch, so a chain with no outcome always means the person
 * is still signed in.
 */
import { APIError } from 'better-auth/api';
import { audit, type AuditDatabase } from '../audit.ts';
import { json } from '../http.ts';
import { listOf, type AuthEnv, type ShyTalkAuth } from '../auth/better-auth.ts';
import { appSession, signedOut } from './session.ts';

/** The Workers rate-limiting binding (wrangler.json `ratelimits`). */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface SignInEnv extends AuthEnv {
  DB: AuditDatabase<unknown> & { batch(statements: unknown[]): Promise<unknown> };
  /** Sign-in attempts per IP: 10 a minute. */
  SIGN_IN_LIMIT: RateLimit;
}

export type Provider = 'google' | 'apple';

const methodNotAllowed = (): Response => new Response(null, { status: 405, headers: { allow: 'POST' } });

interface Credentials {
  idToken: string;
  nonce?: string;
}

/** The body's credentials, or null when it is not what `provider` needs. */
async function credentials(request: Request, provider: Provider): Promise<Credentials | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { idToken, nonce } = body as Record<string, unknown>;
  if (typeof idToken !== 'string' || idToken === '') return null;
  if (provider === 'google') return { idToken };
  if (typeof nonce !== 'string' || nonce === '') return null;
  return { idToken, nonce };
}

const configured = (env: AuthEnv, provider: Provider): boolean =>
  listOf(provider === 'google' ? env.GOOGLE_CLIENT_IDS : env.APPLE_AUDIENCES).length > 0;

export async function handleSignIn(request: Request, env: SignInEnv, auth: ShyTalkAuth, provider: Provider): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed();
  const { success } = await env.SIGN_IN_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
  if (!success) return json(429, { error: 'slow_down' });
  if (!configured(env, provider)) return json(503, { error: 'sign_in_unavailable' });
  const given = await credentials(request, provider);
  if (given === null) return json(400, { error: 'bad_request' });

  let signedIn: { token: string; user: { id: string } };
  try {
    const answer = await auth.api.signInSocial({
      body: { provider, idToken: { token: given.idToken, ...(given.nonce === undefined ? {} : { nonce: given.nonce }) } },
    });
    if (!('token' in answer)) throw new Error('Better Auth answered an ID-token sign-in without a session');
    signedIn = answer;
  } catch (error) {
    if (error instanceof APIError) return json(401, { error: 'sign_in_refused' });
    throw error;
  }

  const actor = `user:${signedIn.user.id}`;
  try {
    await env.DB.batch([audit(env, { actor, action: 'session.start', subject: actor, detail: { provider } })]);
  } catch {
    await (await auth.$context).internalAdapter.deleteSession(signedIn.token);
    return json(500, { error: 'sign_in_failed' });
  }
  return json(200, { token: signedIn.token, userId: signedIn.user.id });
}

/**
 * Ends one session by its id. Written by ShyTalk rather than through Better
 * Auth's sign-out, so it can share a D1 batch with the success row: the
 * session ends and its row lands together, or neither (Shyden, 2026-11-05).
 * No session cache is configured, so the row is the whole session.
 */
export const END_SESSION_SQL = 'DELETE FROM session WHERE id = ?';

export async function handleSignOut(request: Request, env: SignInEnv, auth: ShyTalkAuth): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed();
  const session = await appSession(request, auth);
  if (session === null) return signedOut();
  const actor = `user:${session.userId}`;
  const chain = crypto.randomUUID();
  const row = (action: string, detail: Record<string, unknown> = {}): unknown =>
    audit(env, { actor, action: `session.end.${action}`, subject: actor, detail: { chain, ...detail } });

  try {
    await env.DB.batch([row('attempt')]);
  } catch {
    return json(500, { error: 'sign_out_failed' });
  }
  try {
    await env.DB.batch([env.DB.prepare(END_SESSION_SQL).bind(session.sessionId), row('success')]);
  } catch (error) {
    await env.DB.batch([row('failure', { error: String(error) })]).catch(() => undefined);
    return json(500, { error: 'sign_out_failed' });
  }
  return json(200, { ok: true });
}
