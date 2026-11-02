/**
 * The echo spike's main module. The runtime treats every named export here as
 * an entrypoint, so it exports the handler and the Durable Object class only;
 * the logic is in `echo.ts`.
 */
import { handle, type EchoEnv } from './echo.ts';

export { EchoRoom } from './echo.ts';

export default {
  fetch: (request: Request, env: EchoEnv): Promise<Response> => handle(request, env),
};
