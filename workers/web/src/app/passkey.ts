/**
 * The passkey routes (plan 7 Task 5, shyden-labs/ShyTalk#134 AC1):
 * `POST /api/app/passkey/register/options {token?}`,
 * `/register/verify {response, token?, name?}`, `/sign-in/options {}` and
 * `/sign-in/verify {response}`. They wrap Better Auth's passkey plugin, which
 * `/api/auth/*` does not expose, passing its challenge cookie and session
 * cookie through. A registration from #133's token gives the plugin the
 * token's hash, never the token; its database part runs in the plugin's hook
 * (./passkey-hooks.ts), and the route then starts the session. A sign-in's
 * audit rows follow its session, which is deleted if they fail.
 */
import { APIError } from 'better-auth/api';
import { audit } from '../audit.ts';
import type { ShyTalkAuth } from '../auth/better-auth.ts';
import { json } from '../http.ts';
import { tokenHash } from './email-code.ts';
import { objectBody } from './email-routes.ts';
import { preparedKey, type PreparedPasskeys } from './passkey-hooks.ts';
import type { AppSession } from './session.ts';
import type { SetupIdentity } from './setup-identity.ts';
import type { SignInEnv } from './sign-in.ts';

export type PasskeyOperation = 'register/options' | 'register/verify' | 'sign-in/options' | 'sign-in/verify';

export interface PasskeyRouteDeps {
  auth: ShyTalkAuth;
  /** Where the registration hook leaves its prepared setup for this request. */
  prepared: PreparedPasskeys;
  limit(): Promise<boolean>;
  session(): Promise<AppSession | null>;
  identity(session: AppSession | null, token: string | null): Promise<SetupIdentity | Response>;
  startSession(userId: string, detail: Record<string, unknown>): Promise<{ token: string } | Response>;
  /** Audits a passkey sign-in; deletes the session and answers the failure if that cannot be written. */
  signedIn(userId: string, sessionToken: string): Promise<Response | null>;
  /** The website's session cookie for a session a registration started. */
  sessionCookie(token: string): Promise<string>;
  /** Removes a sign-up's member whose passkey could not be written after they were made. */
  undoSignUp(userId: string): Promise<void>;
}

const refused = (): Response => json(401, { error: 'sign_in_refused' });

/** `body` as JSON, carrying every cookie the plugin set. */
function withCookies(body: unknown, headers: Headers): Response {
  const answer = json(200, body);
  for (const cookie of headers.getSetCookie()) answer.headers.append('set-cookie', cookie);
  return answer;
}

/** The plugin's refusal as ours: 401 for anything about who or what was sent, 500 for the rest. */
function fromPlugin(error: unknown): Response {
  if (error instanceof APIError) return error.statusCode < 500 ? refused() : json(500, { error: 'setup_failed' });
  throw error;
}

export async function handlePasskey(request: Request, operation: PasskeyOperation, deps: PasskeyRouteDeps): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (!(await deps.limit())) return json(429, { error: 'slow_down' });
  const body = await objectBody(request);
  if (body === null) return json(400, { error: 'bad_request' });
  const token = typeof body['token'] === 'string' && body['token'] !== '' ? body['token'] : null;
  const { api } = deps.auth;
  const headers = request.headers;

  try {
    if (operation === 'register/options') {
      const identity = await deps.identity(await deps.session(), token);
      if (identity instanceof Response) return identity;
      const query = identity.kind === 'session' ? {} : { context: identity.tokenHash };
      const options = await api.generatePasskeyRegistrationOptions({ headers, query, returnHeaders: true });
      return withCookies(options.response, options.headers);
    }

    if (operation === 'sign-in/options') {
      const options = await api.generatePasskeyAuthenticationOptions({ headers, returnHeaders: true });
      return withCookies(options.response, options.headers);
    }

    if (operation === 'sign-in/verify') {
      const verified = await api.verifyPasskeyAuthentication({
        headers,
        body: { response: body['response'] as never },
        returnHeaders: true,
      });
      const { session } = verified.response as { session: { token: string; userId: string } };
      const failed = await deps.signedIn(session.userId, session.token);
      if (failed !== null) return failed;
      return withCookies({ token: session.token, userId: session.userId }, verified.headers);
    }

    return await registerVerify(request, body, token, deps);
  } catch (error) {
    return fromPlugin(error);
  }
}

async function registerVerify(
  request: Request,
  body: Record<string, unknown>,
  token: string | null,
  deps: PasskeyRouteDeps,
): Promise<Response> {
  // The hook files its setup under the token's hash, or under a signed-in member's id; with neither, the plugin refuses.
  const session = await deps.session();
  const key = session === null ? (token === null ? null : preparedKey(await tokenHash(token), '')) : preparedKey(null, session.userId);
  let failed = false;
  let failure: unknown;
  try {
    await deps.auth.api.verifyPasskeyRegistration({ headers: request.headers, body: { response: body['response'] as never } });
  } catch (error) {
    failed = true;
    failure = error;
  }
  const entry = key === null ? undefined : deps.prepared.get(key);
  if (key !== null) deps.prepared.delete(key);

  if (entry === undefined) return failed ? fromPlugin(failure) : json(500, { error: 'setup_failed' });
  if (failed) {
    // The hook wrote the setup's database part, but the passkey was not written: a sign-up's new member goes again.
    if (entry.identity.kind === 'sign-up') await deps.undoSignUp(entry.identity.userId);
    return json(500, { error: 'setup_failed' });
  }
  if (entry.identity.kind === 'session') return json(200, entry.prepared);
  const started = await deps.startSession(entry.prepared.userId, { method: 'passkey', via: entry.identity.kind });
  if (started instanceof Response) return started;
  const answer = json(200, { ...entry.prepared, token: started.token });
  answer.headers.append('set-cookie', await deps.sessionCookie(started.token));
  return answer;
}

/** A passkey sign-in's audit rows, after its session; deletes the session and answers 500 if they cannot be written. */
export async function auditPasskeySignIn(
  env: SignInEnv,
  auth: ShyTalkAuth,
  userId: string,
  sessionToken: string,
): Promise<Response | null> {
  const actor = `user:${userId}`;
  try {
    await env.DB.batch([
      audit(env, { actor, action: 'method.use', subject: actor, detail: { kind: 'passkey' } }),
      audit(env, { actor, action: 'session.start', subject: actor, detail: { method: 'passkey' } }),
    ]);
    return null;
  } catch {
    await (await auth.$context).internalAdapter.deleteSession(sessionToken);
    return json(500, { error: 'sign_in_failed' });
  }
}

/** Removes a sign-up's member whose passkey could not be written after they were made, so no member is left without a method. */
export async function undoSignUp(env: SignInEnv, userId: string): Promise<void> {
  const actor = `user:${userId}`;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(userId),
    audit(env, { actor, action: 'user.create.undone', subject: actor, detail: { reason: 'passkey not written' } }),
  ]);
}
