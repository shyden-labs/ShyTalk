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
 * `null` when the request carries `configured` as its door secret; otherwise a
 * 403. Both sides are hashed and the 32-byte digests compared without an early
 * exit, so timing reveals neither length nor content. An unset or empty
 * configured secret refuses every request.
 */
export async function requireDoorSecret(request: Request, configured: string | undefined): Promise<Response | null> {
  const given = request.headers.get(DOOR_SECRET_HEADER) ?? '';
  const [a, b] = await Promise.all([sha256(given), sha256(configured ?? '')]);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= (a[i] as number) ^ (b[i] as number);
  return difference === 0 && configured ? null : plain(403, 'Forbidden');
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
