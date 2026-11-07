/**
 * Tells every open app the newest UI version (plan 4 Task 8,
 * shyden-labs/ShyTalk#81). The deploy puts a fresh announce secret in the
 * Worker, then runs, with that secret:
 *
 *   ANNOUNCE_ENVIRONMENT=dev ANNOUNCE_SECRET=<secret> node scripts/announce-ui.ts
 *
 * It calls `POST /api/app/live/announce`, which announces the newest
 * `everyone` version through the Announcer. A Durable Object cannot be a
 * remote binding (developers.cloudflare.com/workers/development-testing/,
 * read 2026-11-07), so the call goes through the Worker (Shyden's choice,
 * 2026-11-07). A machine skips the doors (decision 197): DEV and TEST are
 * called at their workers.dev origins (`ORIGIN` in workers/door/wrangler.json)
 * with the door secret, which the deploy also sets as DOOR_SECRET; PROD, which
 * has no door, at its `SITE_ORIGIN` (workers/web/wrangler.json).
 */
import { readFileSync } from 'node:fs';
import { DOOR_SECRET_HEADER } from '../packages/environment/index.ts';
import { runIfEntry } from './cli.ts';

const SITE_CONFIG = 'workers/web/wrangler.json';
const DOOR_CONFIG = 'workers/door/wrangler.json';
const ENVIRONMENTS = ['dev', 'test', 'prod'];
const SETTINGS = ['ANNOUNCE_ENVIRONMENT', 'ANNOUNCE_SECRET'] as const;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** `environment`'s `name` var in the Wrangler config at `path`, failing naming both when it has none. */
function configVar(read: (path: string) => string, path: string, environment: string, name: string): string {
  const parsed = JSON.parse(read(path)) as { env?: Record<string, { vars?: Record<string, unknown> }> };
  const value = parsed.env?.[environment]?.vars?.[name];
  if (typeof value !== 'string') throw new Error(`announce-ui: ${path} gives ${environment} no ${name}`);
  return value;
}

/** Where a machine calls `environment`: the door's workers.dev origin for DEV and TEST, the site for PROD. */
export function announceOrigin(read: (path: string) => string, environment: string): string {
  return environment === 'prod'
    ? configVar(read, SITE_CONFIG, environment, 'SITE_ORIGIN')
    : configVar(read, DOOR_CONFIG, environment, 'ORIGIN');
}

/** The answer's JSON, or null when it is not JSON. */
async function body(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function main(
  args: string[] = [],
  env: Record<string, string | undefined> = process.env,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
  send: Fetch = (url, init) => fetch(url, init),
  print: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<number> {
  if (args.length > 0) throw new Error('usage: node scripts/announce-ui.ts (no arguments; the deploy sets ANNOUNCE_* in the environment)');
  const missing = SETTINGS.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`announce-ui: missing ${missing.join(', ')}`);
  const environment = env['ANNOUNCE_ENVIRONMENT'] as string;
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Error(`announce-ui: ANNOUNCE_ENVIRONMENT must be dev, test or prod, not ${environment}`);
  }
  const headers: Record<string, string> = { authorization: `Bearer ${env['ANNOUNCE_SECRET'] as string}` };
  if (environment !== 'prod') {
    const door = env['DOOR_SECRET'];
    if (!door) throw new Error(`announce-ui: missing DOOR_SECRET, which ${environment} needs`);
    headers[DOOR_SECRET_HEADER] = door;
  }
  const response = await send(`${announceOrigin(read, environment)}/api/app/live/announce`, { method: 'POST', headers });
  const answer = await body(response);
  if (response.status !== 200) {
    const error = typeof answer?.['error'] === 'string' ? ` ${answer['error']}` : '';
    throw new Error(`announce-ui: ${environment} answered ${String(response.status)}${error}`);
  }
  const version = answer?.['announced'];
  if (typeof version !== 'number') throw new Error(`announce-ui: ${environment} answered 200 without a version`);
  print(`announce-ui: ${environment} announced UI version ${String(version)}`);
  return 0;
}

await runIfEntry(import.meta.url, main);
