/**
 * The echo spike's main module. The runtime treats every named export here as
 * an entrypoint, so it exports the handler and the Durable Object class only;
 * the logic is in `echo.ts`.
 */
import { handle, type EchoEnv } from './echo.ts';

// EchoRoom is no longer exported: its class is deleted (wrangler.json migration v2,
// plan 2 Task E6 Step 6, shyden-labs/ShyTalk#31) just before the Worker goes.

export default {
  fetch: (request: Request, env: EchoEnv): Promise<Response> => handle(request, env),
};
