/**
 * A front door (design 4.17, shyden-labs/ShyTalk#28): a Worker in PROD's zone
 * answering test.shytalk.app or dev.shytalk.app. It passes every request,
 * WebSocket upgrades included, to its environment's workers.dev origin and
 * adds that environment's door secret, which the origin requires
 * (packages/environment). It holds no binding. DEV's door also lets in only a
 * valid DEV pass (shyden-labs/ShyTalk#314, after shyden-labs/repo-template#207);
 * TEST's door forwards everything.
 */
import { handleDevDoor } from './dev-pass/door.ts';
import type { PublicKeys } from './dev-pass/pass.ts';

export const DOOR_SECRET_HEADER = 'x-shytalk-door-secret';

export interface DoorEnv {
  /** The environment's origin, e.g. https://shytalk-dev.<subdomain>.workers.dev (a var). */
  ORIGIN: string;
  /** The environment's door secret (a Wrangler secret, never a var). */
  DOOR_SECRET: string;
  /** DEV only: this door's own host, which every pass must name (a var). */
  HOST?: string;
  /** DEV only: the sign-in's public keys as JSON, `{"<kid>": "<x>"}` (a var; never a private key). */
  DEV_PASS_KEYS?: string;
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

/** The DEV pass keys from their var, or null when they are not a JSON object of strings. */
function passKeys(json: string): PublicKeys | null {
  try {
    const keys: unknown = JSON.parse(json);
    if (keys === null || typeof keys !== 'object' || Array.isArray(keys)) return null;
    return Object.values(keys).every((x) => typeof x === 'string') ? (keys as PublicKeys) : null;
  } catch {
    return null;
  }
}

/**
 * The door: with DEV_PASS_KEYS set, only a valid DEV pass for HOST reaches the origin, and the sign-in is called
 * through `send` for embed passes; without them (TEST), every request is forwarded. `now` is in seconds.
 */
export async function handle(request: Request, env: DoorEnv, send: Send, now: number): Promise<Response> {
  if (env.DEV_PASS_KEYS === undefined) return forward(request, env, send);
  const keys = passKeys(env.DEV_PASS_KEYS);
  if (keys === null || !env.HOST || !env.DOOR_SECRET) return plain(500, 'Door not configured');
  return handleDevDoor(
    request,
    { host: env.HOST, keys, secretHeader: DOOR_SECRET_HEADER, secret: env.DOOR_SECRET, now, signin: send },
    (outgoing) => forward(outgoing, env, send),
  );
}
