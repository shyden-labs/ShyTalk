/**
 * The front door's main module. The runtime treats every named export here as
 * an entrypoint, so it exports the handler only; the logic is in `door.ts` and
 * `mail.ts`. Only the exact mail path goes to the mail route; everything else
 * is forwarded.
 */
import { forward, type DoorEnv } from './door.ts';
import { handleMail } from './mail.ts';
import { DOOR_MAIL_PATH } from '../../../packages/mail/index.ts';

export default {
  fetch: (request: Request, env: DoorEnv): Promise<Response> =>
    new URL(request.url).pathname === DOOR_MAIL_PATH ? handleMail(request, env) : forward(request, env, (outgoing) => fetch(outgoing)),
};
