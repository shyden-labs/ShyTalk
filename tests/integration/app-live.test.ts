import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inject } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { d1UiStore, publishUi } from '../../workers/web/src/app/ui.ts';
import { DOOR_SECRET_HEADER, SITE_PASSWORD_HEADER, SITE_USER } from '../../packages/environment/index.ts';
import { localDev } from './d1.ts';
import { appHeaders } from '../support/app-headers.ts';

/**
 * The live announcement against the real runtime (plan 4 Task 8,
 * shyden-labs/ShyTalk#81 AC 2): the site Worker runs under `wrangler dev`
 * with its real Announcer Durable Object, on the integration suite's migrated
 * local DEV database, and real WebSockets connect to it.
 */

const DOOR_SECRET = 'integration-door-secret';
const ANNOUNCE_SECRET = 'integration-announce-secret';
/** DEV's site password (shyden-labs/ShyTalk#262), given in its header as the app gives it beside a bearer token. */
const SITE_PASSWORD = 'integration-site-password';
/** DEV's dev pass key (shyden-labs/ShyTalk#263), as the partner site would sign with it. */
const DEV_PASS_SECRET = 'integration-dev-pass-secret';

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

/** DEV's host, from the Worker's own SITE_ORIGIN. */
function devHost(): string {
  const config = JSON.parse(readFileSync(resolve('workers/web/wrangler.json'), 'utf8')) as {
    env: Record<string, { vars: { SITE_ORIGIN: string } }>;
  };
  return new URL(config.env['dev']?.vars.SITE_ORIGIN ?? '').host;
}

/** A socket on `/api/app/live` and every message it receives, once it is open. */
async function open(): Promise<{ socket: WebSocket; messages: unknown[]; next: () => Promise<unknown> }> {
  const messages: unknown[] = [];
  const waiting: ((message: unknown) => void)[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${String(worker.port)}/api/app/live`, {
    headers: { ...appHeaders('android', '1.0.0'), [DOOR_SECRET_HEADER]: DOOR_SECRET, [SITE_PASSWORD_HEADER]: SITE_PASSWORD },
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
    headers: { [DOOR_SECRET_HEADER]: DOOR_SECRET, [SITE_PASSWORD_HEADER]: SITE_PASSWORD, authorization: `Bearer ${secret}` },
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
    vars: { DOOR_SECRET, ANNOUNCE_SECRET, SITE_PASSWORD, DEV_PASS_SECRET },
    logLevel: 'error',
    experimental: { disableExperimentalWarning: true },
  });
}, 60_000);

afterAll(async () => {
  await worker.stop();
  rmSync(folder, { recursive: true, force: true });
});

describe('the live announcement, in the real runtime', () => {
  // Three sockets, opened once, carry every check (shyden-labs/ShyTalk#180).
  it('sends each socket the current version as soon as it connects, then one message to each connected socket on an announcement, dropping one that closed', async () => {
    const first = await open();
    const second = await open();
    const gone = await open();
    expect.soft(await first.next()).toEqual({ type: 'ui', version });
    expect.soft(await second.next()).toEqual({ type: 'ui', version });
    expect.soft(await gone.next()).toEqual({ type: 'ui', version });
    await new Promise<void>((done) => {
      gone.socket.addEventListener('close', () => {
        done();
      });
      gone.socket.close(1000, 'leaving');
    });
    const response = await announceCall();
    expect.soft(response.status).toBe(200);
    expect.soft(await response.json()).toEqual({ announced: version });
    expect.soft(await first.next()).toEqual({ type: 'ui', version });
    expect.soft(await second.next()).toEqual({ type: 'ui', version });
    expect.soft(first.messages).toEqual([]);
    expect.soft(second.messages).toEqual([]);
    first.socket.close();
    second.socket.close();
  });

  it('refuses an announcement without the secret', async () => {
    const response = await announceCall('not-the-secret');
    expect(response.status).toBe(401);
  });

  // shyden-labs/ShyTalk#262: the real runtime asks for DEV's site password with the browser's box and lets the box's
  // answer through.
  it('asks for the site password with the box, and serves the right one given in the box', async () => {
    const address = `http://127.0.0.1:${String(worker.port)}/api/app/health`;
    const asked = await worker.fetch(address, { headers: { [DOOR_SECRET_HEADER]: DOOR_SECRET } });
    expect(asked.status).toBe(401);
    expect(asked.headers.get('www-authenticate')).toBe('Basic realm="ShyTalk dev", charset="UTF-8"');
    const wrong = await worker.fetch(address, {
      headers: { [DOOR_SECRET_HEADER]: DOOR_SECRET, authorization: `Basic ${btoa(`${SITE_USER}:wrong`)}` },
    });
    expect(wrong.status).toBe(401);
    const box = await worker.fetch(address, {
      headers: { [DOOR_SECRET_HEADER]: DOOR_SECRET, authorization: `Basic ${btoa(`${SITE_USER}:${SITE_PASSWORD}`)}` },
    });
    expect(box.status).toBe(200);
  });

  // shyden-labs/ShyTalk#263: a fresh pass, signed as the partner site signs one, opens dev once and sets a cookie that
  // serves pages; the same pass again gets the box, which proves its nonce was recorded in the real D1 table.
  it('opens dev once with a fresh dev pass, serves pages on its cookie, and asks with the box for the same pass again', async () => {
    const encode = (bytes: Uint8Array): string =>
      btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');
    const nonce = encode(crypto.getRandomValues(new Uint8Array(16)));
    const body = encode(
      new TextEncoder().encode(JSON.stringify({ v: 1, host: devHost(), exp: Math.floor(Date.now() / 1000) + 60, nonce })),
    );
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(DEV_PASS_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);
    const token = `${body}.${encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))))}`;
    const link = `http://127.0.0.1:${String(worker.port)}/api/app/health?dev_pass=${token}`;
    const first = await worker.fetch(link, { headers: { [DOOR_SECRET_HEADER]: DOOR_SECRET }, redirect: 'manual' });
    expect.soft(first.status).toBe(302);
    expect.soft(first.headers.get('location')).toBe('/api/app/health');
    const [cookie = ''] = (first.headers.get('set-cookie') ?? '').split(';');
    expect.soft(cookie.startsWith('shytalk_site_pass=')).toBe(true);
    const served = await worker.fetch(`http://127.0.0.1:${String(worker.port)}/api/app/health`, {
      headers: { [DOOR_SECRET_HEADER]: DOOR_SECRET, cookie },
    });
    expect.soft(served.status).toBe(200);
    const again = await worker.fetch(link, { headers: { [DOOR_SECRET_HEADER]: DOOR_SECRET }, redirect: 'manual' });
    expect.soft(again.status).toBe(401);
    expect.soft(again.headers.get('set-cookie')).toBeNull();
  });
});
