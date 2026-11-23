import { join } from 'node:path';
import { inject } from 'vitest';

/** One statement's result, as D1 answers it. */
export interface D1Result<T> {
  results: T[];
  meta: { changes: number; last_row_id: number };
}

/** The part of D1 the integration tests use. */
export interface D1 {
  prepare(sql: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<unknown>;
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  first<T>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface LocalDevEnv {
  ENVIRONMENT_NAME: 'dev';
  DB: D1;
}

/**
 * Miniflare's proxy frees a statement's address once garbage collection
 * finalises it, and a statement given to `batch` is unreachable as soon as the
 * call returns, while its request can still be queued behind others
 * (shyden-labs/ShyTalk#159: 5 of 40 runs of 20 confirms at once). So every
 * statement stays reachable until the proxy is disposed.
 */
class KeptStatement implements D1Statement {
  readonly proxied: D1Statement;
  private readonly kept: D1Statement[];

  constructor(proxied: D1Statement, kept: D1Statement[]) {
    this.proxied = proxied;
    this.kept = kept;
    kept.push(proxied);
  }

  bind(...values: unknown[]): D1Statement {
    return new KeptStatement(this.proxied.bind(...values), this.kept);
  }

  run(): Promise<unknown> {
    return this.proxied.run();
  }

  first<T>(): Promise<T | null> {
    return this.proxied.first<T>();
  }

  all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.proxied.all<T>();
  }
}

function keepingStatements(db: D1): D1 {
  const kept: D1Statement[] = [];
  return {
    prepare: (sql) => new KeptStatement(db.prepare(sql), kept),
    batch: <T = unknown>(statements: D1Statement[]) => db.batch<T>(statements.map((statement) => (statement as KeptStatement).proxied)),
    exec: (sql) => db.exec(sql),
  };
}

/**
 * Wrangler's `getPlatformProxy`, typed here: Wrangler's own declarations pull
 * in miniflare's, which need @cloudflare/workers-types and more that this
 * repository does not install, and lib checks are on. Loaded through a
 * variable so the compiler does not resolve those declarations.
 * `@vite-ignore` tells Vite the variable import is meant, so it does not warn.
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
  const { getPlatformProxy } = (await import(/* @vite-ignore */ WRANGLER)) as { getPlatformProxy: GetPlatformProxy };
  const proxy = await getPlatformProxy({
    configPath: 'workers/web/wrangler.json',
    environment: 'dev',
    persist: { path: join(inject('d1Persist'), 'v3') },
    remoteBindings: false,
  });
  return { env: { ...proxy.env, DB: keepingStatements(proxy.env.DB) }, dispose: proxy.dispose };
}
