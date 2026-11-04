import { join } from 'node:path';
import { inject } from 'vitest';

/** The part of D1 the integration tests use. */
export interface D1 {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  first<T>(): Promise<T | null>;
}

export interface LocalDevEnv {
  ENVIRONMENT_NAME: 'dev';
  DB: D1;
}

/**
 * Wrangler's `getPlatformProxy`, typed here: Wrangler's own declarations pull
 * in miniflare's, which need @cloudflare/workers-types and more that this
 * repository does not install, and lib checks are on. Loaded through a
 * variable so the compiler does not resolve those declarations.
 */
type GetPlatformProxy = (options: {
  configPath: string;
  environment: string;
  persist: { path: string };
  remoteBindings: boolean;
}) => Promise<{ env: LocalDevEnv; dispose: () => Promise<void> }>;

const WRANGLER = 'wrangler';

/**
 * The DEV Worker's bindings from workers/web/wrangler.json, on the local
 * database the global setup migrated. Never remote.
 */
export async function localDev(): Promise<{ env: LocalDevEnv; dispose: () => Promise<void> }> {
  const { getPlatformProxy } = (await import(WRANGLER)) as { getPlatformProxy: GetPlatformProxy };
  const proxy = await getPlatformProxy({
    configPath: 'workers/web/wrangler.json',
    environment: 'dev',
    persist: { path: join(inject('d1Persist'), 'v3') },
    remoteBindings: false,
  });
  return { env: proxy.env, dispose: proxy.dispose };
}
