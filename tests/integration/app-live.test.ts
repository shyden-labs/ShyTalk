import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inject } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { d1UiStore, publishUi } from '../../workers/web/src/app/ui.ts';
import { DOOR_SECRET_HEADER } from '../../packages/environment/index.ts';
import { localDev } from './d1.ts';

/**
 * The live announcement against the real runtime (plan 4 Task 8,
 * shyden-labs/ShyTalk#81 AC 2): the site Worker runs under `wrangler dev`
 * with its real Announcer Durable Object, on the integration suite's migrated
 * local DEV database, and real WebSockets connect to it.
 */

const DOOR_SECRET = 'integration-door-secret';
const ANNOUNCE_SECRET = 'integration-announce-secret';

interface DevWorker {
  address: string;
  port: number;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  stop(): Promise<void>;
}
type UnstableDev = (script: string, options: Record<string, unknown>) => Promise<DevWorker>;

const WRANGLER = 'wrangler';

let worker: DevWorker;
let folder: string;
let version: number;

/** The Worker's config with absolute paths and an empty assets folder, so the suite needs no website build. */
function configFor(dir: string): string {
  const web = resolve('workers/web');
  const config = JSON.parse(readFileSync(join(web, 'wrangler.json'), 'utf8')) as Record<string, unknown> & {
    assets: Record<string, unknown>;
    env: Record<string, { d1_databases: Record<string, unknown>[] }>;
  };
  const assets = join(dir, 'assets');
  mkdirSync(assets);
  config['main'] = join(web, 'src/index.ts');
  config.assets['directory'] = assets;
  for (const database of config.env['dev']?.d1_databases ?? []) database['migrations_dir'] = resolve('migrations');
  const path = join(dir, 'wrangler.json');
  writeFileSync(path, JSON.stringify(config));
  return path;
}

/** A socket on `/api/app/live` and every message it receives, once it is open. */
async function open(): Promise<{ socket: WebSocket; messages: unknown[]; next: () => Promise<unknown> }> {
  const messages: unknown[] = [];
  const waiting: ((message: unknown) => void)[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${String(worker.port)}/api/app/live`, {
    headers: { [DOOR_SECRET_HEADER]: DOOR_SECRET },
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as unknown;
    const waiter = waiting.shift();
    if (waiter) waiter(message);
    else messages.push(message);
  });
  await new Promise<void>((done, fail) => {
    socket.addEventListener('open', () => {
      done();
    });
    socket.addEventListener('error', () => {
      fail(new Error('the live socket did not open'));
    });
  });
  const next = (): Promise<unknown> =>
    messages.length > 0
      ? Promise.resolve(messages.shift())
      : new Promise((done) => {
          waiting.push(done);
        });
  return { socket, messages, next };
}

const announceCall = (secret = ANNOUNCE_SECRET): Promise<Response> =>
  worker.fetch(`http://127.0.0.1:${String(worker.port)}/api/app/live/announce`, {
    method: 'POST',
    headers: { [DOOR_SECRET_HEADER]: DOOR_SECRET, authorization: `Bearer ${secret}` },
  });

beforeAll(async () => {
  // The marker and a published document go in before the Worker opens the same database.
  const local = await localDev();
  try {
    await local.env.DB.exec(
      "CREATE TABLE IF NOT EXISTS environment_marker (name TEXT NOT NULL); INSERT INTO environment_marker (name) SELECT 'dev' WHERE NOT EXISTS (SELECT 1 FROM environment_marker);",
    );
    const published = await publishUi(
      d1UiStore(local.env),
      JSON.parse(readFileSync('manifests/ui.json', 'utf8')) as unknown,
      'everyone',
      'ci:integration',
    );
    if (!published.ok) throw new Error(`manifests/ui.json did not publish: ${published.errors.join('; ')}`);
    version = published.version;
  } finally {
    await local.dispose();
  }
  folder = mkdtempSync(join(tmpdir(), 'shytalk-live-'));
  const { unstable_dev } = (await import(/* @vite-ignore */ WRANGLER)) as { unstable_dev: UnstableDev };
  worker = await unstable_dev(join(resolve('workers/web'), 'src/index.ts'), {
    config: configFor(folder),
    env: 'dev',
    ip: '127.0.0.1',
    persistTo: inject('d1Persist'),
    vars: { DOOR_SECRET, ANNOUNCE_SECRET },
    logLevel: 'error',
    experimental: { disableExperimentalWarning: true },
  });
}, 60_000);

afterAll(async () => {
  await worker.stop();
  rmSync(folder, { recursive: true, force: true });
});

describe('the live announcement, in the real runtime', () => {
  it('sends a socket the current version as soon as it connects', async () => {
    const live = await open();
    expect(await live.next()).toEqual({ type: 'ui', version });
    live.socket.close();
  });

  it('sends one message to each connected socket on an announcement', async () => {
    const first = await open();
    const second = await open();
    await first.next();
    await second.next();
    const response = await announceCall();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ announced: version });
    expect(await first.next()).toEqual({ type: 'ui', version });
    expect(await second.next()).toEqual({ type: 'ui', version });
    expect(first.messages).toEqual([]);
    expect(second.messages).toEqual([]);
    first.socket.close();
    second.socket.close();
  });

  it('drops a socket that closed, and still reaches the others', async () => {
    const gone = await open();
    const staying = await open();
    await gone.next();
    await staying.next();
    await new Promise<void>((done) => {
      gone.socket.addEventListener('close', () => {
        done();
      });
      gone.socket.close(1000, 'leaving');
    });
    const response = await announceCall();
    expect(response.status).toBe(200);
    expect(await staying.next()).toEqual({ type: 'ui', version });
    staying.socket.close();
  });

  it('refuses an announcement without the secret', async () => {
    const response = await announceCall('not-the-secret');
    expect(response.status).toBe(401);
  });
});
