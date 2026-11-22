/**
 * The version floor (plan 6.1 Task 3, shyden-labs/ShyTalk#77 AC 1-2; live-app
 * design 4.5). Every Android and iPhone call names its platform and version
 * (`X-ShyTalk-Platform`, `X-ShyTalk-Version`); an app under its platform's
 * floor, or one that names neither, is answered 426 and shows only "update to
 * continue". The website names platform `web` and has no floor: it deploys
 * with the server, so it is never older than it.
 */
import { json } from '../http.ts';

export const PLATFORMS = ['android', 'ios', 'web'] as const;
export type AppPlatform = 'android' | 'ios';

/** Calls the floor never holds: the health check, and the deploy's announce, which carries its own secret. */
const EXEMPT = new Set(['/api/app/health', '/api/app/live/announce']);

/** The floor sent to a call too old even to name its platform or version. */
const NO_FLOOR_KNOWN = '0.0.0';

export interface FloorStore {
  floor(platform: AppPlatform): Promise<string | null>;
}

/** The part of D1 the floor reads. */
export interface FloorStatement {
  bind(...values: unknown[]): FloorStatement;
  all(): Promise<{ results: unknown[] }>;
}
export interface FloorDatabase {
  prepare(sql: string): FloorStatement;
}

/** The floor table's row for `platform`, or null when none is set (migrations/0012_app_floor.sql). */
export function d1FloorStore(db: FloorDatabase): FloorStore {
  return {
    async floor(platform) {
      const { results } = await db.prepare('SELECT min_version FROM app_floor WHERE platform = ?').bind(platform).all();
      const version = (results[0] as { min_version?: unknown } | undefined)?.min_version;
      return typeof version === 'string' ? version : null;
    },
  };
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** MAJOR.MINOR.PATCH as three numbers, or null for anything else (a leading zero, a `v`, a fourth part). */
export function parseVersion(text: string): [number, number, number] | null {
  const match = VERSION.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** MAJOR.MINOR.PATCH, as numbers. */
export type Version = readonly [number, number, number];

/** Orders two versions part by part, by number. */
export function compareVersions(a: Version, b: Version): -1 | 0 | 1 {
  for (const at of [0, 1, 2] as const) {
    if (a[at] !== b[at]) return a[at] < b[at] ? -1 : 1;
  }
  return 0;
}

const updateRequired = (floor: string): Response => json(426, { error: 'update_required', floor });

/** Null when the call may go on; otherwise the 426 the app shows as "update to continue". */
export async function checkFloor(request: Request, store: FloorStore): Promise<Response | null> {
  if (EXEMPT.has(new URL(request.url).pathname)) return null;
  const platform = request.headers.get('x-shytalk-platform');
  if (platform === 'web') return null;
  if (platform !== 'android' && platform !== 'ios') return updateRequired(NO_FLOOR_KNOWN);
  const version = parseVersion(request.headers.get('x-shytalk-version') ?? '');
  if (version === null) return updateRequired(NO_FLOOR_KNOWN);
  const floor = await store.floor(platform);
  const parsedFloor = floor === null ? null : parseVersion(floor);
  if (floor === null || parsedFloor === null) return null;
  return compareVersions(version, parsedFloor) < 0 ? updateRequired(floor) : null;
}
