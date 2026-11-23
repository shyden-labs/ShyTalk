/**
 * Publishes manifests/ui.json to one environment's D1 (plan 4 Task 6,
 * shyden-labs/ShyTalk#79) as the next `everyone` version of the app's UI
 * document, through the same store the Worker reads. The deploy looks up the
 * database's id and runs, with its Cloudflare token:
 *
 *   UI_ENVIRONMENT=dev UI_DATABASE_NAME=shytalk-dev UI_DATABASE_ID=<uuid> \
 *   UI_PUBLISHED_BY=ci:deploy-dev node scripts/publish-ui.ts
 *
 * The database is reached through a Wrangler remote binding (Shyden's choice,
 * 2026-11-06): a throwaway Wrangler config binds only that database, by id,
 * with `remote: true`, so workers/web/wrangler.json and local `wrangler dev`
 * stay local. Nothing is published when the newest `everyone` version already
 * is the manifest, so every deploy can run it.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateUiDocument } from '../packages/ui-document/index.ts';
import { d1UiStore, publishValid, type UiDatabase } from '../workers/web/src/app/ui.ts';
import { runIfEntry } from './cli.ts';

const MANIFEST = 'manifests/ui.json';
const ENVIRONMENTS = ['dev', 'test', 'prod'] as const;
const SETTINGS = ['UI_ENVIRONMENT', 'UI_DATABASE_NAME', 'UI_DATABASE_ID', 'UI_PUBLISHED_BY'] as const;

export interface Target {
  environment: (typeof ENVIRONMENTS)[number];
  databaseName: string;
  databaseId: string;
  publishedBy: string;
}

/** Opens the database a Wrangler config binds; `dispose` closes it again. */
export type OpenDb = (config: object) => Promise<{ db: UiDatabase; dispose: () => Promise<void> }>;

/**
 * Wrangler's `getPlatformProxy`, typed here: Wrangler's own declarations pull
 * in miniflare's, which this repository does not type-check (as in
 * tests/integration/d1.ts).
 */
export type GetPlatformProxy = (options: {
  configPath: string;
  persist: false;
  remoteBindings: true;
}) => Promise<{ env: { DB: UiDatabase }; dispose: () => Promise<void> }>;

/** The target the deploy names in its environment; fails naming every missing setting. */
export function readTarget(env: Record<string, string | undefined>): Target {
  const missing = SETTINGS.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`publish-ui: missing ${missing.join(', ')}`);
  const environment = env['UI_ENVIRONMENT'] as string;
  if (!(ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw new Error(`publish-ui: UI_ENVIRONMENT must be dev, test or prod, not ${environment}`);
  }
  return {
    environment: environment as Target['environment'],
    databaseName: env['UI_DATABASE_NAME'] as string,
    databaseId: env['UI_DATABASE_ID'] as string,
    publishedBy: env['UI_PUBLISHED_BY'] as string,
  };
}

/** A Wrangler config binding only the target database, by id, as a remote binding. */
export function remoteConfig(target: Target): object {
  return {
    name: 'shytalk-publish-ui',
    compatibility_date: '2026-10-20',
    d1_databases: [{ binding: 'DB', database_name: target.databaseName, database_id: target.databaseId, remote: true }],
  };
}

/** Publishes `manifest` unless the newest `everyone` version already is it; answers what it did. */
export async function publishManifest(target: Target, manifest: string, open: OpenDb): Promise<string> {
  let input: unknown;
  try {
    input = JSON.parse(manifest);
  } catch (error) {
    throw new Error(`${MANIFEST} is not JSON: ${(error as Error).message}`, { cause: error });
  }
  const checked = validateUiDocument(input);
  if (!checked.ok) throw new Error(`${MANIFEST} is not a valid UI document: ${checked.errors.join('; ')}`);

  const { db, dispose } = await open(remoteConfig(target));
  try {
    const store = d1UiStore({ ENVIRONMENT_NAME: target.environment, DB: db });
    const newest = await store.newest('everyone');
    if (newest?.body === JSON.stringify(checked.doc)) {
      return `${target.environment} already serves this UI as version ${String(newest.version)}; nothing published`;
    }
    const version = await publishValid(store, checked.doc, 'everyone', target.publishedBy);
    return `${target.environment} now serves UI version ${String(version)}`;
  } finally {
    await dispose();
  }
}

const WRANGLER = 'wrangler';

/** Loads Wrangler at run time, through a variable so the compiler does not resolve its declarations. */
const loadWrangler = (): Promise<{ getPlatformProxy: GetPlatformProxy }> =>
  import(/* @vite-ignore */ WRANGLER) as Promise<{ getPlatformProxy: GetPlatformProxy }>;

/** Opens `config`'s remote binding through Wrangler, from a config file in a folder of its own, removed on dispose. */
export async function openRemote(
  config: object,
  load: () => Promise<{ getPlatformProxy: GetPlatformProxy }> = loadWrangler,
): Promise<{ db: UiDatabase; dispose: () => Promise<void> }> {
  const folder = mkdtempSync(join(tmpdir(), 'shytalk-publish-ui-'));
  const configPath = join(folder, 'wrangler.json');
  writeFileSync(configPath, JSON.stringify(config));
  try {
    const { getPlatformProxy } = await load();
    const proxy = await getPlatformProxy({ configPath, persist: false, remoteBindings: true });
    return {
      db: proxy.env.DB,
      dispose: async () => {
        await proxy.dispose();
        rmSync(folder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

export async function main(
  args: string[] = [],
  env: Record<string, string | undefined> = process.env,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
  open: OpenDb = openRemote,
  print: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<number> {
  if (args.length > 0) throw new Error('usage: node scripts/publish-ui.ts (no arguments; the deploy sets UI_* in the environment)');
  print(`publish-ui: ${await publishManifest(readTarget(env), read(MANIFEST), open)}`);
  return 0;
}

await runIfEntry(import.meta.url, main);
