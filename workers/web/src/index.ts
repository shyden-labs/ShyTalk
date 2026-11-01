/**
 * The site Worker's main module. The runtime treats every named export here as
 * an entrypoint, so it exports the handler only; the logic is in `web.ts`.
 */
import { handle, type WebEnv } from './web.ts';

export default {
  fetch: (request: Request, env: WebEnv): Promise<Response> => handle(request, env),
};
