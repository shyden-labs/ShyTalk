/**
 * The front door's main module. The runtime treats every named export here as
 * an entrypoint, so it exports the handler only; the logic is in `door.ts`.
 */
import { forward, type DoorEnv } from './door.ts';

export default {
  fetch: (request: Request, env: DoorEnv): Promise<Response> => forward(request, env, (outgoing) => fetch(outgoing)),
};
