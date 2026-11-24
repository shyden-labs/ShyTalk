/**
 * The origin side of the front doors (design 4.17, shyden-labs/ShyTalk#28).
 * Written against the standard Request/Response/crypto.subtle and small
 * structural store types, so it runs in Workers and type-checks in Node.
 * See README.md.
 */

export const DOOR_SECRET_HEADER = 'x-shytalk-door-secret';

/** The part of a D1 database the marker check uses. */
export interface D1Like {
  prepare(sql: string): { first<T>(): Promise<T | null> };
}

/** The part of an R2 bucket the marker check uses. */
export interface R2Like {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export interface MarkerStores {
  databases: Record<string, D1Like>;
  buckets: Record<string, R2Like>;
}

const plain = (status: number, text: string): Response =>
  new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

const sha256 = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

/**
 * Whether `given` equals `configured`: both are hashed and the 32-byte digests
 * compared without an early exit, so timing reveals neither length nor
 * content. An unset or empty `configured` matches nothing.
 */
async function matches(given: string, configured: string | undefined): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(configured ?? '')]);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= (a[i] as number) ^ (b[i] as number);
  return difference === 0 && Boolean(configured);
}

/**
 * `null` when the request carries `configured` as its door secret; otherwise a
 * 403. An unset or empty configured secret refuses every request.
 */
export async function requireDoorSecret(request: Request, configured: string | undefined): Promise<Response | null> {
  return (await matches(request.headers.get(DOOR_SECRET_HEADER) ?? '', configured)) ? null : plain(403, 'Forbidden');
}

/** The header a caller already using `Authorization: Bearer` gives the site password in (shyden-labs/ShyTalk#262). */
export const SITE_PASSWORD_HEADER = 'x-shytalk-site-password';

/** The user name tests and the deploy type in the browser's box; any name, a blank one included, is accepted (shyden-labs/ShyTalk#290). */
export const SITE_USER = 'shytalk';

/** The cookie a valid dev pass sets (shyden-labs/ShyTalk#263): it stands in for the password box. */
export const SITE_PASS_COOKIE = 'shytalk_site_pass';

/** How long the site pass cookie stands in for the box: 12 hours. */
export const SITE_PASS_SECONDS = 12 * 60 * 60;

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

/**
 * The site pass cookie's value, good until `exp` (unix seconds):
 * `<exp>.<HMAC-SHA256(key, exp and the password's SHA-256)>`. Keyed by a
 * server secret, so a leaked cookie cannot be guessed back to the password;
 * a new password or key ends every cookie made before it.
 */
export async function sitePassCookie(password: string, key: string, exp: number): Promise<string> {
  const hmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = `shytalk-site-pass-v1:${exp}:${base64url(await sha256(password))}`;
  return `${exp}.${base64url(new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(message))))}`;
}

/** Whether `value` is a site pass cookie for `password` under `key`, unexpired at `now`. */
async function sitePassHolds(value: string, password: string, key: string, now: number): Promise<boolean> {
  const [exp = ''] = value.split('.');
  if (Number(exp) < now) return false;
  return matches(value, await sitePassCookie(password, key, Number(exp)));
}

/** The value of the cookie `name` on `request`, or '' when it has none. */
function cookieValue(request: Request, name: string): string {
  for (const pair of (request.headers.get('cookie') ?? '').split(';')) {
    const [key = '', ...value] = pair.trim().split('=');
    if (key === name) return value.join('=');
  }
  return '';
}

/**
 * The password from an `Authorization: Basic` value, decoded as UTF-8, or ''
 * when it is not one. The user name, everything before the first colon (RFC
 * 7617 forbids one inside it), is not checked (shyden-labs/ShyTalk#290).
 */
function basicPassword(authorization: string | null): string {
  const [scheme = '', encoded = ''] = (authorization ?? '').split(' ');
  if (scheme.toLowerCase() !== 'basic' || encoded === '') return '';
  let credentials: string;
  try {
    credentials = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => Number(c.codePointAt(0))));
  } catch {
    return '';
  }
  const colon = credentials.indexOf(':');
  return colon === -1 ? '' : credentials.slice(colon + 1);
}

/**
 * The dev and test sites' password (shyden-labs/ShyTalk#262): `null` when the
 * request gives `configured`, either in the browser's box (`Authorization:
 * Basic`, with any user name, a blank one included) or, for a caller whose `Authorization` carries a
 * bearer token, in `x-shytalk-site-password`, which wins when present.
 * Given `pass` (dev only), a site pass cookie made with its key and unexpired
 * at its `now` stands in for the password (shyden-labs/ShyTalk#263).
 * Otherwise one 401 asking for the box, whatever part was wrong. An unset or
 * empty configured password refuses every request.
 */
export async function requireSitePassword(
  request: Request,
  configured: string | undefined,
  realm: string,
  pass?: { key: string | undefined; now: number },
): Promise<Response | null> {
  const cookie = cookieValue(request, SITE_PASS_COOKIE);
  if (cookie !== '' && configured && pass?.key && (await sitePassHolds(cookie, configured, pass.key, pass.now))) return null;
  const header = request.headers.get(SITE_PASSWORD_HEADER);
  const given = header ?? basicPassword(request.headers.get('authorization'));
  if (await matches(given, configured)) return null;
  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'www-authenticate': `Basic realm="${realm}", charset="UTF-8"`,
      'cache-control': 'no-store',
    },
  });
}

const MARKER_SQL = 'SELECT name FROM environment_marker LIMIT 1';
const MARKER_KEY = '.environment';

/** Why one store fails the check, or null when it names `expected`. */
async function storeProblem(read: () => Promise<string | null>, expected: string): Promise<string | null> {
  let found: string | null;
  try {
    found = await read();
  } catch {
    return 'unreadable';
  }
  const name = found?.trim() ?? '';
  if (name === '') return 'no marker';
  return name === expected ? null : `marks ${name}`;
}

/**
 * Makes the marker check for one isolate: `assertEnvironmentMarkers()` is
 * `null` when every database and bucket names `expected`, otherwise a 503 with
 * one logged line naming the first wrong store. A pass is kept for the guard's
 * life; a failure is checked again on the next call.
 */
export function createMarkerGuard(
  expected: string,
  stores: MarkerStores,
  log: (line: string) => void = (line) => {
    console.error(line);
  },
): { assertEnvironmentMarkers(): Promise<Response | null> } {
  let passed = false;

  const checks: [string, () => Promise<string | null>][] = [
    ...Object.entries(stores.databases).map(([name, db]): [string, () => Promise<string | null>] => [
      `d1 ${name}`,
      async () => (await db.prepare(MARKER_SQL).first<{ name: string }>())?.name ?? null,
    ]),
    ...Object.entries(stores.buckets).map(([name, bucket]): [string, () => Promise<string | null>] => [
      `r2 ${name}`,
      async () => (await (await bucket.get(MARKER_KEY))?.text()) ?? null,
    ]),
  ];

  const firstProblem = async (): Promise<string | null> => {
    if (checks.length === 0) return 'no store to check';
    for (const [label, read] of checks) {
      const problem = await storeProblem(read, expected);
      if (problem) return `${label}: ${problem}`;
    }
    return null;
  };

  return {
    async assertEnvironmentMarkers() {
      if (passed) return null;
      const problem = await firstProblem();
      if (problem === null) {
        passed = true;
        return null;
      }
      log(`environment marker check failed (expected ${expected}): ${problem}`);
      return plain(503, 'Service Unavailable');
    },
  };
}
