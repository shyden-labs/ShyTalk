/**
 * The door's mail route (shyden-labs/ShyTalk#88): dev and test Workers live in
 * the Non-Prod account, but a sending domain must sit in the sender's own
 * account, so their mail leaves through this PROD-account door. Only a request
 * carrying the environment's mail secret sends, always as
 * no-reply@dev.shytalk.app, which is all the binding allows. Nothing here logs
 * the message.
 */
import { checkMessage, failureFor, MAIL_MAX_BYTES, MAIL_SECRET_HEADER, type EmailSender } from '../../../packages/mail/index.ts';
import { secretsMatch } from '../../../packages/environment/index.ts';

export const DOOR_MAIL_FROM = 'no-reply@dev.shytalk.app';

export interface DoorMailEnv {
  /** The `send_email` binding, locked to DOOR_MAIL_FROM (wrangler.json). */
  EMAIL?: EmailSender | undefined;
  /** The environment's mail secret (a Wrangler secret, separate from DOOR_SECRET). */
  MAIL_SECRET?: string | undefined;
}

const answer = (status: number, body: unknown): Response => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Sends the posted message, or answers why it was not sent. */
export async function handleMail(request: Request, env: DoorMailEnv): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
  if (!env.EMAIL || !env.MAIL_SECRET) return answer(503, { ok: false, reason: 'unavailable' });
  if (!(await secretsMatch(request.headers.get(MAIL_SECRET_HEADER) ?? '', env.MAIL_SECRET)))
    return new Response('Forbidden', { status: 403 });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAIL_MAX_BYTES) return answer(413, { ok: false, reason: 'invalid' });
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAIL_MAX_BYTES) return answer(413, { ok: false, reason: 'invalid' });

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return answer(400, { ok: false, reason: 'invalid' });
  }
  const message = checkMessage(parsed);
  if (message === null) return answer(400, { ok: false, reason: 'invalid' });

  try {
    const { messageId } = await env.EMAIL.send({ ...message, from: DOOR_MAIL_FROM });
    return answer(200, { ok: true, messageId });
  } catch (error) {
    return answer(502, failureFor(error));
  }
}
