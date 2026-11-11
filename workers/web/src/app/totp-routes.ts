/**
 * Setting up the authenticator app (plan 7 Task 4, shyden-labs/ShyTalk#134
 * AC2). `POST /api/app/totp/setup {token?}` answers the `otpauth://` URI, once;
 * `POST /api/app/totp/confirm {code, token?}` makes the authenticator live and
 * finishes the setup (./finish-setup.ts). Without a session, `token` is #133's
 * sign-up or recovery token (./setup-identity.ts).
 */
import { json } from '../http.ts';
import { objectBody } from './email-routes.ts';
import type { Finished } from './finish-setup.ts';
import type { SetupIdentity } from './setup-identity.ts';
import type { ConfirmedTotp } from './totp.ts';

/** What the two routes join; each piece is tested on its own, and the router hands in the real ones. */
export interface TotpRouteDeps {
  limit: () => Promise<boolean>;
  identity: (token: string | null) => Promise<SetupIdentity | Response>;
  emailOf: (userId: string) => Promise<string>;
  setup: (userId: string, email: string) => Promise<{ uri: string } | null>;
  confirm: (userId: string, code: unknown) => Promise<ConfirmedTotp | null>;
  /** Finishes the setup, making `confirmed` live in its batch only after the setup's token is spent. */
  finish: (identity: SetupIdentity, confirmed: ConfirmedTotp) => Promise<Finished | Response>;
  /** The website's session cookie for a session the finish started. */
  sessionCookie: (token: string) => Promise<string>;
}

interface Opened {
  body: Record<string, unknown>;
  identity: SetupIdentity;
}

/** The request's body and who is setting up, or the answer that refuses it. */
async function open(request: Request, deps: TotpRouteDeps): Promise<Opened | Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (!(await deps.limit())) return json(429, { error: 'slow_down' });
  const body = await objectBody(request);
  if (body === null) return json(400, { error: 'bad_request' });
  const token = body['token'];
  const identity = await deps.identity(typeof token === 'string' ? token : null);
  if (identity instanceof Response) return identity;
  return { body, identity };
}

export async function handleTotpSetup(request: Request, deps: TotpRouteDeps): Promise<Response> {
  const opened = await open(request, deps);
  if (opened instanceof Response) return opened;
  const { identity } = opened;
  const address = identity.kind === 'sign-up' ? identity.email : await deps.emailOf(identity.userId);
  const pending = await deps.setup(identity.userId, address);
  if (pending === null) return json(409, { error: 'totp_exists' });
  return json(200, pending);
}

export async function handleTotpConfirm(request: Request, deps: TotpRouteDeps): Promise<Response> {
  const opened = await open(request, deps);
  if (opened instanceof Response) return opened;
  const confirmed = await deps.confirm(opened.identity.userId, opened.body['code']);
  if (confirmed === null) return json(401, { error: 'code_refused' });
  const finished = await deps.finish(opened.identity, confirmed);
  if (finished instanceof Response) return finished;
  const answer = json(200, finished);
  if (finished.token !== undefined) answer.headers.append('set-cookie', await deps.sessionCookie(finished.token));
  return answer;
}
