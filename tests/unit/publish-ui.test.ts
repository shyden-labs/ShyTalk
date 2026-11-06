import { describe, it, expect, vi } from 'vitest';

/** Wrangler itself never loads in a unit test: the script's default loader gets this stand-in. */
const wranglerModule = vi.hoisted(() => ({ getPlatformProxy: vi.fn() }));
vi.mock('wrangler', () => wranglerModule);
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  main,
  openRemote,
  publishManifest,
  readTarget,
  remoteConfig,
  type GetPlatformProxy,
  type OpenDb,
  type Target,
} from '../../scripts/publish-ui.ts';
import type { UiDatabase, UiStatement } from '../../workers/web/src/app/ui.ts';

/**
 * Publishing manifests/ui.json to an environment's D1 (plan 4 Task 6,
 * shyden-labs/ShyTalk#79): the deploy hands the script the database's name and
 * id, the script opens that database through a Wrangler remote binding and
 * publishes the manifest only when it differs from the newest `everyone`
 * version. The database here is a stand-in; the remote binding is measured in
 * the deploy itself.
 */

const target: Target = { environment: 'dev', databaseName: 'shytalk-dev', databaseId: 'uuid-1', publishedBy: 'ci:deploy-dev' };
const manifest = readFileSync('manifests/ui.json', 'utf8');
const stored = JSON.stringify(JSON.parse(manifest));

/** A D1 stand-in holding `newest` as the newest everyone row, recording each batch. */
function standIn(newest: { version: number; body: string } | null) {
  const batches: { sql: string; values: unknown[] }[][] = [];
  const statement = (sql: string, values: unknown[] = []): UiStatement & { sql: string; values: unknown[] } => ({
    sql,
    values,
    bind: (...bound: unknown[]) => statement(sql, bound),
    all: () => Promise.resolve({ results: newest === null ? [] : [{ ...newest, audience: 'everyone', share: null, undoes: null }] }),
  });
  const db: UiDatabase = {
    prepare: (sql) => statement(sql),
    batch: (statements) => {
      batches.push(statements as never);
      return Promise.resolve([{ results: [{ version: (newest?.version ?? 0) + 1 }] }, { results: [] }]);
    },
  };
  return { db, batches };
}

function opener(db: UiDatabase) {
  const calls: { config: unknown; disposed: boolean }[] = [];
  const open: OpenDb = (config) => {
    const call = { config, disposed: false };
    calls.push(call);
    return Promise.resolve({
      db,
      dispose: () => {
        call.disposed = true;
        return Promise.resolve();
      },
    });
  };
  return { open, calls };
}

describe('readTarget', () => {
  it('reads the environment, database and publisher from the deploy', () => {
    expect(
      readTarget({ UI_ENVIRONMENT: 'dev', UI_DATABASE_NAME: 'shytalk-dev', UI_DATABASE_ID: 'uuid-1', UI_PUBLISHED_BY: 'ci:deploy-dev' }),
    ).toEqual(target);
  });

  it('fails naming every missing setting', () => {
    expect(() => readTarget({ UI_ENVIRONMENT: 'dev' })).toThrow('missing UI_DATABASE_NAME, UI_DATABASE_ID, UI_PUBLISHED_BY');
  });

  it('refuses an environment that is not dev, test or prod', () => {
    expect(() => readTarget({ UI_ENVIRONMENT: 'staging', UI_DATABASE_NAME: 'n', UI_DATABASE_ID: 'i', UI_PUBLISHED_BY: 'p' })).toThrow(
      'UI_ENVIRONMENT must be dev, test or prod, not staging',
    );
  });
});

describe('remoteConfig', () => {
  it('binds only the named database, by id, as a remote binding', () => {
    expect(remoteConfig(target)).toEqual({
      name: 'shytalk-publish-ui',
      compatibility_date: '2026-10-20',
      d1_databases: [{ binding: 'DB', database_name: 'shytalk-dev', database_id: 'uuid-1', remote: true }],
    });
  });
});

describe('publishManifest', () => {
  it('publishes the manifest as the next version, audited as the deploy, when the database holds none', async () => {
    const { db, batches } = standIn(null);
    const { open, calls } = opener(db);
    await expect(publishManifest(target, manifest, open)).resolves.toBe('dev now serves UI version 1');
    expect(calls).toEqual([{ config: remoteConfig(target), disposed: true }]);
    expect(batches).toHaveLength(1);
    const [insert, audited] = batches[0] ?? [];
    expect(insert?.values.slice(0, 3)).toEqual([stored, 'everyone', null]);
    expect(insert?.values[4]).toBe('ci:deploy-dev');
    expect(audited?.values.slice(1, 4)).toEqual(['ci:deploy-dev', 'ui.publish', 'ui_document']);
  });

  it('publishes again when the newest version differs from the manifest', async () => {
    const { db, batches } = standIn({ version: 3, body: '{"old":true}' });
    await expect(publishManifest(target, manifest, opener(db).open)).resolves.toBe('dev now serves UI version 4');
    expect(batches).toHaveLength(1);
  });

  it('publishes nothing when the newest version already is the manifest', async () => {
    const { db, batches } = standIn({ version: 3, body: stored });
    const { open, calls } = opener(db);
    await expect(publishManifest(target, manifest, open)).resolves.toBe('dev already serves this UI as version 3; nothing published');
    expect(batches).toHaveLength(0);
    expect(calls[0]?.disposed).toBe(true);
  });

  it('refuses an invalid manifest naming its errors, without opening the database', async () => {
    const { open, calls } = opener(standIn(null).db);
    await expect(publishManifest(target, '{"nope":1}', open)).rejects.toThrow(/^manifests\/ui\.json is not a valid UI document: .+/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a manifest that is not JSON, without opening the database', async () => {
    const { open, calls } = opener(standIn(null).db);
    await expect(publishManifest(target, '{', open)).rejects.toThrow(/^manifests\/ui\.json is not JSON/);
    expect(calls).toHaveLength(0);
  });

  it('closes the remote binding when the database fails', async () => {
    const db: UiDatabase = {
      prepare: () => ({ bind: () => db.prepare(''), all: () => Promise.reject(new Error('D1 is down')) }),
      batch: () => Promise.reject(new Error('unused')),
    };
    const { open, calls } = opener(db);
    await expect(publishManifest(target, manifest, open)).rejects.toThrow('D1 is down');
    expect(calls[0]?.disposed).toBe(true);
  });
});

describe('openRemote', () => {
  /** A stand-in for Wrangler's getPlatformProxy, recording its options and the config file it was handed. */
  function wrangler(fail?: Error) {
    const seen: { options?: Parameters<GetPlatformProxy>[0]; config?: unknown; disposed: boolean } = { disposed: false };
    const db = standIn(null).db;
    const getPlatformProxy: GetPlatformProxy = (options) => {
      seen.options = options;
      seen.config = JSON.parse(readFileSync(options.configPath, 'utf8'));
      if (fail) return Promise.reject(fail);
      return Promise.resolve({
        env: { DB: db },
        dispose: () => {
          seen.disposed = true;
          return Promise.resolve();
        },
      });
    };
    return { seen, db, load: () => Promise.resolve({ getPlatformProxy }) };
  }

  it('hands Wrangler the config in a file of its own, remote and unpersisted, and answers its database', async () => {
    const { seen, db, load } = wrangler();
    const opened = await openRemote(remoteConfig(target), load);
    expect(opened.db).toBe(db);
    expect(seen.config).toEqual(remoteConfig(target));
    expect(seen.options).toMatchObject({ persist: false, remoteBindings: true });
  });

  it('closes Wrangler and removes the config folder on dispose', async () => {
    const { seen, load } = wrangler();
    const opened = await openRemote(remoteConfig(target), load);
    const folder = dirname(seen.options?.configPath ?? '');
    expect(existsSync(folder)).toBe(true);
    await opened.dispose();
    expect(seen.disposed).toBe(true);
    expect(existsSync(folder)).toBe(false);
  });

  it('removes the config folder and fails with Wrangler’s error when the binding cannot open', async () => {
    const { seen, load } = wrangler(new Error('Authentication error [code: 10000]'));
    await expect(openRemote(remoteConfig(target), load)).rejects.toThrow('Authentication error [code: 10000]');
    expect(existsSync(dirname(seen.options?.configPath ?? ''))).toBe(false);
  });
});

describe('main', () => {
  const env = { UI_ENVIRONMENT: 'dev', UI_DATABASE_NAME: 'shytalk-dev', UI_DATABASE_ID: 'uuid-1', UI_PUBLISHED_BY: 'ci:deploy-dev' };

  it('publishes manifests/ui.json to the target the environment names, printing what it did', async () => {
    const lines: string[] = [];
    const read: string[] = [];
    const code = await main(
      [],
      env,
      (path) => {
        read.push(path);
        return manifest;
      },
      opener(standIn(null).db).open,
      (line) => lines.push(line),
    );
    expect(code).toBe(0);
    expect(read).toEqual(['manifests/ui.json']);
    expect(lines).toEqual(['publish-ui: dev now serves UI version 1']);
  });

  it('reads the manifest from disk and prints to stdout by default', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      expect(await main([], env, undefined, opener(standIn(null).db).open)).toBe(0);
      expect(stdout).toHaveBeenCalledWith('publish-ui: dev now serves UI version 1\n');
    } finally {
      stdout.mockRestore();
    }
  });

  it('opens the binding through Wrangler by default', async () => {
    const db = standIn({ version: 2, body: stored }).db;
    wranglerModule.getPlatformProxy.mockResolvedValueOnce({ env: { DB: db }, dispose: () => Promise.resolve() });
    const lines: string[] = [];
    expect(
      await main(
        [],
        env,
        () => manifest,
        undefined,
        (line) => lines.push(line),
      ),
    ).toBe(0);
    expect(lines).toEqual(['publish-ui: dev already serves this UI as version 2; nothing published']);
    expect(wranglerModule.getPlatformProxy).toHaveBeenCalledWith(expect.objectContaining({ persist: false, remoteBindings: true }));
  });

  it('refuses any argument', async () => {
    await expect(
      main(
        ['prod'],
        env,
        () => manifest,
        opener(standIn(null).db).open,
        () => undefined,
      ),
    ).rejects.toThrow('usage: node scripts/publish-ui.ts (no arguments; the deploy sets UI_* in the environment)');
  });
});
