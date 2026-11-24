/**
 * `POST /api/shydesk/callback`, where ShyDesk tells ShyTalk a punishment was applied or lifted (shyden-labs/ShyTalk#310
 * AC1 and AC2). ShyDesk is a server with no site password or DEV pass to give, so the site's router sends this address
 * here after the door and before the password; the delivery's signature is its guard (shydesk-callback.ts), and the
 * store (punishments.ts) writes each punishment once. Without a signing secret nothing is believed: 503.
 */
import { json } from '../http.ts';
import { applyPunishment, liftPunishment, type PunishmentEnv } from './punishments.ts';
import { checkCallback } from './shydesk-callback.ts';

export const SHYDESK_CALLBACK_PATH = '/api/shydesk/callback';

export interface ShyDeskCallbackEnv extends PunishmentEnv<unknown> {
  /** The secret ShyDesk signs deliveries with (a Wrangler secret); absent or empty, every delivery answers 503. */
  SHYDESK_CALLBACK_SECRET?: string;
}

export async function handleShyDeskCallback(request: Request, env: ShyDeskCallbackEnv): Promise<Response> {
  if (request.method !== 'POST') {
    const answer = json(405, { error: 'method_not_allowed' });
    answer.headers.set('allow', 'POST');
    return answer;
  }
  const secret = env.SHYDESK_CALLBACK_SECRET ?? '';
  if (secret === '') return json(503, { error: 'callback_unavailable' });
  const now = Date.now();
  const check = await checkCallback(
    secret,
    request.headers.get('shydesk-timestamp'),
    request.headers.get('shydesk-signature'),
    await request.text(),
    Math.floor(now / 1000),
  );
  if (!check.ok) return json(check.status, { error: check.error });
  const answer =
    check.event.type === 'punishment.apply' ? await applyPunishment(env, check.event, now) : await liftPunishment(env, check.event, now);
  return json(answer.status, answer.body);
}
