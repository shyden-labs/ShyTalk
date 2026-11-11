/**
 * Signing in with the authenticator app or a recovery code (plan 7 Task 4,
 * shyden-labs/ShyTalk#134 AC2, AC3, AC7): `POST /api/app/sign-in/totp` and
 * `POST /api/app/sign-in/recovery-code`, each `{email, code}`, answering
 * `{token, userId}` (and `left`, the recovery codes left) as Google and Apple
 * sign-in do. Every refusal is the same 401. As in `handleSignIn`, the audit
 * row is written after the session, and the session is deleted if it fails.
 */
import { serializeSignedCookie } from 'better-call';
import { audit } from '../audit.ts';
import type { ShyTalkAuth } from '../auth/better-auth.ts';
import { json } from '../http.ts';
import { normaliseAddress } from './email-code.ts';
import { objectBody } from './email-routes.ts';
import type { SignInEnv } from './sign-in.ts';

/** Checks a code for an address: the member and, for a recovery code, the codes left; null for any refusal. */
export type CodeVerifier = (email: string, code: string, now: number) => Promise<{ userId: string; left?: number } | null>;

export type CodeKind = 'totp' | 'recovery-code';

/**
 * Starts a session for `userId` and writes its audit rows after it; deletes the
 * session and answers 500 if they cannot be written. Answers the session token.
 */
export async function startSession(
  env: SignInEnv,
  auth: ShyTalkAuth,
  userId: string,
  detail: Record<string, unknown>,
  extraAudit: { action: string; detail: Record<string, unknown> }[] = [],
): Promise<{ token: string } | Response> {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId);
  const actor = `user:${userId}`;
  try {
    await env.DB.batch([
      ...extraAudit.map((row) => audit(env, { actor, action: row.action, subject: actor, detail: row.detail })),
      audit(env, { actor, action: 'session.start', subject: actor, detail }),
    ]);
  } catch {
    await context.internalAdapter.deleteSession(session.token);
    return json(500, { error: 'sign_in_failed' });
  }
  return { token: session.token };
}

/**
 * Better Auth's own signed session cookie for `token` (its name, attributes and
 * 400-day life), so the website keeps a cookie session when ShyTalk, not Better
 * Auth, started the session; the app keeps the token instead.
 */
export async function sessionCookie(auth: ShyTalkAuth, token: string): Promise<string> {
  const context = await auth.$context;
  const { name, attributes } = context.authCookies.sessionToken;
  return serializeSignedCookie(name, token, context.secret, { ...attributes, maxAge: context.sessionConfig.expiresIn });
}

/** `body` as JSON with the session cookie for `token` set beside it. */
export async function withSession(auth: ShyTalkAuth, token: string, body: unknown): Promise<Response> {
  const answer = json(200, body);
  answer.headers.append('set-cookie', await sessionCookie(auth, token));
  return answer;
}

export async function handleCodeSignIn(
  request: Request,
  env: SignInEnv,
  auth: ShyTalkAuth,
  kind: CodeKind,
  verify: CodeVerifier,
  now: () => number = Date.now,
): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const { success } = await env.SIGN_IN_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
  if (!success) return json(429, { error: 'slow_down' });
  const body = await objectBody(request);
  const email = normaliseAddress(body?.['email']);
  const code = body?.['code'];
  if (email === null || typeof code !== 'string' || code === '') return json(400, { error: 'bad_request' });

  const verified = await verify(email, code, now());
  if (verified === null) return json(401, { error: 'sign_in_refused' });

  // Every method used is audited (AC7): an authenticator as a method, a recovery code as a code with those left.
  const used =
    kind === 'recovery-code'
      ? [{ action: 'recovery_code.use', detail: { left: verified.left } }]
      : [{ action: 'method.use', detail: { kind: 'totp' } }];
  const started = await startSession(env, auth, verified.userId, { method: kind }, used);
  if (started instanceof Response) return started;
  return withSession(auth, started.token, {
    token: started.token,
    userId: verified.userId,
    ...(kind === 'recovery-code' ? { left: verified.left } : {}),
  });
}
