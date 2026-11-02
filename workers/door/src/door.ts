/**
 * A front door (design 4.17, shyden-labs/ShyTalk#28): a Worker in PROD's zone
 * answering test.shytalk.app or dev.shytalk.app. It passes every request,
 * WebSocket upgrades included, to its environment's workers.dev origin and
 * adds that environment's door secret, which the origin requires
 * (packages/environment). It holds no binding and does nothing else.
 */

export const DOOR_SECRET_HEADER = 'x-shytalk-door-secret';

export interface DoorEnv {
  /** The environment's origin, e.g. https://shytalk-dev.<subdomain>.workers.dev (a var). */
  ORIGIN: string;
  /** The environment's door secret (a Wrangler secret, never a var). */
  DOOR_SECRET: string;
}

type Send = (request: Request) => Promise<Response>;

const plain = (status: number, text: string): Response =>
  new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** Sends `request` to the origin through `send`, with the door secret set over any caller copy. */
export async function forward(request: Request, env: DoorEnv, send: Send): Promise<Response> {
  if (!env.DOOR_SECRET) return plain(500, 'Door not configured');

  const incoming = new URL(request.url);
  // Only the path and query are copied onto the origin URL, so no request
  // path (`//host`, `/\host`) can change the host the door sends to.
  const target = new URL(env.ORIGIN);
  target.pathname = incoming.pathname;
  target.search = incoming.search;

  const headers = new Headers(request.headers);
  headers.set(DOOR_SECRET_HEADER, env.DOOR_SECRET);

  const outgoing = new Request(target, {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
    duplex: 'half',
  });

  try {
    return await send(outgoing);
  } catch {
    return plain(502, 'Bad Gateway');
  }
}
