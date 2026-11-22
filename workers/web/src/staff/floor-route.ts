/**
 * The staff floor routes (plan 6.1 Task 4, shyden-labs/ShyTalk#77 AC 3-4):
 * `GET /api/staff/me` lists the signed-in member's staff permissions;
 * `GET /api/staff/floor` shows each platform's oldest allowed app version;
 * `POST /api/staff/floor {platform, version, force?}` moves one. A floor lower
 * than the current one lets older apps back in, so it needs `force: true`.
 * Every move writes its audit row in the same batch as the floor.
 */
import { audit } from '../audit.ts';
import { json } from '../http.ts';
import { compareVersions, parseVersion, type AppPlatform } from '../app/floor.ts';
import { signedOut } from '../app/session.ts';
import type { WebEnv } from '../web.ts';
import { can, permissionsOf, type StaffEnv } from './permissions.ts';

export interface Floors {
  android: string | null;
  ios: string | null;
}

export interface FloorChange {
  platform: AppPlatform;
  from: string | null;
  to: string;
  force: boolean;
  /** `staff:<user id>`. */
  actor: string;
}

export interface StaffFloorStore {
  read(): Promise<Floors>;
  set(change: FloorChange): Promise<void>;
}

export interface StaffDeps {
  session(request: Request): Promise<{ userId: string } | null>;
  staff: StaffEnv;
  store: StaffFloorStore;
}

export const STAFF_API_PREFIX = '/api/staff/';

const notAllowed = (): Response => json(403, { error: 'not_allowed' });
const badRequest = (error: string): Response => json(400, { error });
const methodNotAllowed = (allow: string): Response => new Response(null, { status: 405, headers: { allow } });

interface FloorRequest {
  platform: AppPlatform;
  version: string;
  force: boolean;
}

/** The body as a floor request, or the 400 that answers it. */
async function readFloorRequest(request: Request): Promise<FloorRequest | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('bad_request');
  }
  if (typeof body !== 'object' || body === null) return badRequest('bad_request');
  const { platform, version, force = false } = body as Record<string, unknown>;
  if (platform !== 'android' && platform !== 'ios') return badRequest('bad_platform');
  if (typeof version !== 'string' || parseVersion(version) === null) return badRequest('bad_version');
  if (typeof force !== 'boolean') return badRequest('bad_request');
  return { platform, version, force };
}

async function setFloor(request: Request, userId: string, store: StaffFloorStore): Promise<Response> {
  const asked = await readFloorRequest(request);
  if (asked instanceof Response) return asked;
  const current = (await store.read())[asked.platform];
  const parsedCurrent = parseVersion(current ?? '');
  const parsedAsked = parseVersion(asked.version) as [number, number, number];
  if (parsedCurrent !== null && !asked.force && compareVersions(parsedAsked, parsedCurrent) < 0)
    return json(409, { error: 'floor_lower', current });
  await store.set({ platform: asked.platform, from: current, to: asked.version, force: asked.force, actor: `staff:${userId}` });
  return json(200, { platform: asked.platform, version: asked.version });
}

/** Answers a call under `/api/staff/`. */
export async function handleStaffApi(request: Request, deps: StaffDeps): Promise<Response> {
  const path = new URL(request.url).pathname.slice(STAFF_API_PREFIX.length);
  if (path !== 'me' && path !== 'floor') return json(404, { error: 'not_found' });
  if (path === 'me' && request.method !== 'GET') return methodNotAllowed('GET');
  if (path === 'floor' && request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed('GET, POST');
  const session = await deps.session(request);
  if (session === null) return signedOut();
  if (path === 'me') return json(200, { permissions: permissionsOf(session.userId, deps.staff) });
  if (!can(session.userId, 'floor.manage', deps.staff)) return notAllowed();
  if (request.method === 'GET') return json(200, await deps.store.read());
  return setFloor(request, session.userId, deps.store);
}

/** The part of D1 the store uses. */
export interface StaffFloorDatabase<Statement> {
  prepare(sql: string): { bind(...values: unknown[]): Statement; all(): Promise<{ results: unknown[] }> };
  batch(statements: Statement[]): Promise<unknown>;
}

const UPSERT_SQL =
  'INSERT INTO app_floor (platform, min_version, set_at, set_by) VALUES (?, ?, ?, ?) ' +
  'ON CONFLICT (platform) DO UPDATE SET min_version = excluded.min_version, set_at = excluded.set_at, set_by = excluded.set_by';

/** The floors in D1's `app_floor` (migrations/0012_app_floor.sql). */
export function d1StaffFloorStore<Statement>(env: {
  ENVIRONMENT_NAME: WebEnv['ENVIRONMENT_NAME'];
  DB: StaffFloorDatabase<Statement>;
}): StaffFloorStore {
  return {
    async read() {
      const { results } = await env.DB.prepare('SELECT platform, min_version FROM app_floor').all();
      const floors: Floors = { android: null, ios: null };
      for (const row of results as { platform: AppPlatform; min_version: string }[]) floors[row.platform] = row.min_version;
      return floors;
    },
    async set({ platform, from, to, force, actor }) {
      await env.DB.batch([
        env.DB.prepare(UPSERT_SQL).bind(platform, to, Date.now(), actor),
        audit(env, { actor, action: 'floor.set', subject: 'app_floor', detail: { platform, from, to, force } }),
      ]);
    },
  };
}
