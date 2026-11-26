// Copied unchanged from shyden-labs/repo-template scripts/dev-pass/door.ts at 449e1c612e9671a0eaaffee33dd4330fe0f306e3 (shyden-labs/repo-template#207,
// adopted by shyden-labs/ShyTalk#314). Change it there first, then copy it again.
// Each product's `dev.` door (shyden-labs/repo-template#207, spec §4): nothing from
// the DEV origin reaches anyone without a valid DEV pass, and the origin never sees
// a pass. The product's door Worker builds `env` and passes its own `forward`
// (a fetch to the origin); this file holds only the rules, so they are tested here.
import { readForm } from './form.ts';
import { safeBack, verifyPass, type PublicKeys } from './pass.ts';

export const SIGNIN_ORIGIN = 'https://dev-signin.shyden.co.uk';
export const PASS_COOKIE = '__Host-devpass';
/** Apps and machines send the pass here; it wins over the cookie. */
export const PASS_HEADER = 'X-Dev-Pass';
/** Who the pass belongs to, for the origin's logs. */
export const SUB_HEADER = 'X-Dev-Pass-Sub';

const ACCEPT_PATH = '/__devpass/accept';
const SIGNOUT_PATH = '/__devpass/signout';
const EMBED_PATH = '/__devpass/embed';
const COOKIE_ATTRIBUTES = 'Secure; HttpOnly; SameSite=Lax; Path=/';

export interface DoorEnv {
  /** This door's own host name, which every pass it opens must name as `aud`. */
  readonly host: string;
  readonly keys: PublicKeys;
  /** The origin's door secret, added to every forwarded request. */
  readonly secretHeader: string;
  readonly secret: string;
  /** Seconds since the epoch. */
  readonly now: number;
  /**
   * A door whose pages run another product's embed (shyden-labs/repo-template#209): calls the
   * sign-in Worker through its door, to swap a visitor's pass for an embed pass.
   */
  readonly signin?: (request: Request) => Promise<Response>;
  /** An embed's API door: the page origins whose embeds may call it with an embed pass. */
  readonly embedOrigins?: readonly string[];
}

function reply(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

function withoutPassCookie(cookie: string | null): string | undefined {
  if (cookie === null) return undefined;
  const kept = cookie
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && entry.split('=', 1)[0] !== PASS_COOKIE);
  return kept.length === 0 ? undefined : kept.join('; ');
}

function passCookie(cookie: string | null): string | undefined {
  for (const entry of (cookie ?? '').split(';')) {
    const [name, ...value] = entry.trim().split('=');
    if (name === PASS_COOKIE) return value.join('=');
  }
  return undefined;
}

async function acceptPass(request: Request, env: DoorEnv): Promise<Response> {
  if (request.method !== 'POST') return reply(405, { allow: 'POST' });
  // Only the sign-in's own page may post a pass, so another site cannot sign someone in as itself.
  if (request.headers.get('origin') !== SIGNIN_ORIGIN) return reply(403);
  const form = await readForm(request);
  if (typeof form === 'number') return reply(form);
  const pass = form.get('pass');
  if (pass === null) return reply(401);
  const check = await verifyPass(pass, { host: env.host, keys: env.keys, now: env.now });
  if (!check.ok) return reply(401);
  return reply(303, {
    location: safeBack(form.get('back')),
    'set-cookie': `${PASS_COOKIE}=${pass}; ${COOKIE_ATTRIBUTES}; Max-Age=${check.exp - env.now}`,
  });
}

/** For page code on this door's own origin: the visitor's pass, swapped for an embed pass to `?for=`. */
async function embedPass(request: Request, env: DoorEnv, signin: (request: Request) => Promise<Response>): Promise<Response> {
  if (request.method !== 'POST') return reply(405, { allow: 'POST' });
  if (request.headers.get('origin') !== `https://${env.host}`) return reply(403);
  const audience = new URL(request.url).searchParams.get('for');
  if (audience === null || audience === '') return reply(400);
  const pass = passCookie(request.headers.get('cookie'));
  if (pass === undefined) return reply(401);
  if (!(await verifyPass(pass, { host: env.host, keys: env.keys, now: env.now })).ok) return reply(401);
  const answer = await signin(
    new Request(`${SIGNIN_ORIGIN}/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ pass, for: audience }).toString(),
    }),
  );
  if (answer.status !== 200) return reply(answer.status);
  return new Response(await answer.text(), { status: 200, headers: { 'cache-control': 'no-store', 'content-type': 'application/json' } });
}

const cors = (origin: string) => ({ 'access-control-allow-origin': origin, vary: 'Origin' });

function wantsPage(request: Request): boolean {
  return request.method === 'GET' && request.headers.get('upgrade') === null && (request.headers.get('accept') ?? '').includes('text/html');
}

export async function handleDevDoor(request: Request, env: DoorEnv, forward: (request: Request) => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === ACCEPT_PATH) return acceptPass(request, env);
  if (url.pathname === EMBED_PATH) return env.signin === undefined ? reply(404) : embedPass(request, env, env.signin);
  if (url.pathname === SIGNOUT_PATH) {
    return reply(303, { location: `${SIGNIN_ORIGIN}/signout`, 'set-cookie': `${PASS_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0` });
  }

  const origin = request.headers.get('origin');
  const embedOrigin = origin !== null && env.embedOrigins?.includes(origin) === true ? origin : undefined;
  if (request.method === 'OPTIONS' && env.embedOrigins !== undefined && request.headers.has('access-control-request-method')) {
    return preflight(embedOrigin);
  }

  const pass = request.headers.get(PASS_HEADER) ?? passCookie(request.headers.get('cookie'));
  const check = await verifyPass(pass, { host: env.host, keys: env.keys, now: env.now });
  if (!check.ok) return refuse(request, url, env, embedOrigin);
  return forwardWithPass(request, env, check.sub, embedOrigin, forward);
}

/** A cross-site preflight: allowed for a listed embed origin, refused for any other. */
function preflight(embedOrigin: string | undefined): Response {
  if (embedOrigin === undefined) return reply(403);
  return reply(204, {
    ...cors(embedOrigin),
    'access-control-allow-headers': 'X-Dev-Pass, Content-Type',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
    'access-control-max-age': '600',
  });
}

/** No valid pass: 401 for an embed or a non-page request, else a redirect to sign in and come back. */
function refuse(request: Request, url: URL, env: DoorEnv, embedOrigin: string | undefined): Response {
  if (embedOrigin !== undefined) return reply(401, cors(embedOrigin));
  if (!wantsPage(request)) return reply(401);
  const signin = new URL('/pass', SIGNIN_ORIGIN);
  signin.search = new URLSearchParams({ for: env.host, back: url.pathname + url.search }).toString();
  return reply(302, { location: signin.toString() });
}

/** The request forwarded without its pass, carrying the door's secret and the signed-in subject. */
async function forwardWithPass(
  request: Request,
  env: DoorEnv,
  sub: string,
  embedOrigin: string | undefined,
  forward: (request: Request) => Promise<Response>,
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete(PASS_HEADER);
  const cookie = withoutPassCookie(headers.get('cookie'));
  if (cookie === undefined) headers.delete('cookie');
  else headers.set('cookie', cookie);
  headers.set(env.secretHeader, env.secret);
  headers.set(SUB_HEADER, sub);
  const response = await forward(new Request(request, { headers }));
  if (embedOrigin === undefined) return response;
  const answer = new Response(response.body, response);
  answer.headers.set('access-control-allow-origin', embedOrigin);
  answer.headers.append('vary', 'Origin');
  return answer;
}
