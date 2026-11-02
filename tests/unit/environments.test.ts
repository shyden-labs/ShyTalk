import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { doorHosts, environmentProblems, filesUnder, hostMentions, type EnvironmentsFile, type FoundConfig } from './environments.ts';

/**
 * The environment checks (plan 2 Task E3, shyden-labs/ShyTalk#29; design
 * 4.17). TEST, DEV and PROD never share a store: every D1, KV or R2 id a
 * Wrangler config binds is listed in environments.json under that config's
 * own environment, and nowhere else. Machines skip the doors, so no test,
 * script or workflow names a door host. The fixture tests below are the
 * plants each rule was seen failing on; the last tests judge the real tree.
 */

const LISTED: EnvironmentsFile = {
  prod: { d1: ['prod-db'], kv: ['prod-kv'], r2: ['prod-media'] },
  test: { d1: ['test-db'], kv: [], r2: [] },
  dev: { d1: ['dev-db', 'dev-db-preview'], kv: ['dev-kv'], r2: ['dev-media'] },
};

const found = (config: unknown, path = 'workers/api/wrangler.json'): FoundConfig[] => [{ path, config }];

describe('environment ids: fixtures', () => {
  it('passes a config whose every binding is listed under its own environment', () => {
    const config = {
      env: {
        dev: {
          d1_databases: [{ binding: 'DB', database_id: 'dev-db', preview_database_id: 'dev-db-preview' }],
          kv_namespaces: [{ binding: 'KV', id: 'dev-kv' }],
          r2_buckets: [{ binding: 'MEDIA', bucket_name: 'dev-media' }],
        },
        prod: { d1_databases: [{ binding: 'DB', database_id: 'prod-db' }] },
      },
    };
    expect(environmentProblems(found(config), LISTED)).toEqual([]);
  });

  it("refuses DEV bound to PROD's D1", () => {
    const config = { env: { dev: { d1_databases: [{ binding: 'DB', database_id: 'prod-db' }] } } };
    expect(environmentProblems(found(config), LISTED)).toEqual([
      'workers/api/wrangler.json env.dev d1 DB database_id prod-db is listed under prod, not dev',
    ]);
  });

  it.each([
    [
      'a D1 preview id',
      { d1_databases: [{ binding: 'DB', database_id: 'test-db', preview_database_id: 'dev-db' }] },
      'd1 DB preview_database_id dev-db is listed under dev, not test',
    ],
    ['a KV id', { kv_namespaces: [{ binding: 'KV', id: 'prod-kv' }] }, 'kv KV id prod-kv is listed under prod, not test'],
    [
      'a KV preview id',
      { kv_namespaces: [{ binding: 'KV', preview_id: 'dev-kv' }] },
      'kv KV preview_id dev-kv is listed under dev, not test',
    ],
    [
      'an R2 bucket',
      { r2_buckets: [{ binding: 'MEDIA', bucket_name: 'prod-media' }] },
      'r2 MEDIA bucket_name prod-media is listed under prod, not test',
    ],
    [
      'an R2 preview bucket',
      { r2_buckets: [{ binding: 'MEDIA', preview_bucket_name: 'dev-media' }] },
      'r2 MEDIA preview_bucket_name dev-media is listed under dev, not test',
    ],
  ])("refuses TEST bound to another environment's id through %s", (_case, bindings, problem) => {
    expect(environmentProblems(found({ env: { test: bindings } }), LISTED)).toEqual([`workers/api/wrangler.json env.test ${problem}`]);
  });

  it('refuses an id listed under no environment', () => {
    const config = { env: { dev: { kv_namespaces: [{ binding: 'KV', id: 'stray-kv' }] } } };
    expect(environmentProblems(found(config), LISTED)).toEqual([
      'workers/api/wrangler.json env.dev kv KV id stray-kv is listed under no environment',
    ]);
  });

  it('refuses an id listed under two environments', () => {
    const listed: EnvironmentsFile = { ...LISTED, test: { d1: ['dev-db'], kv: [], r2: [] } };
    expect(environmentProblems([], listed)).toEqual(['environments.json lists dev-db under both test and dev']);
  });

  it('passes a config with no env at all, which binds nothing', () => {
    expect(environmentProblems(found({ name: 'plain' }), LISTED)).toEqual([]);
  });

  it.each([
    ['a config that is not an object', [], 'workers/api/wrangler.json is not a JSON object'],
    ['an env that is not an object', { env: ['dev'] }, 'workers/api/wrangler.json env is not an object'],
    ['an environment that is not an object', { env: { dev: 'prod-db' } }, 'workers/api/wrangler.json env.dev is not an object'],
  ])('refuses %s rather than reading it as binding nothing', (_case, config, problem) => {
    expect(environmentProblems(found(config), LISTED)).toEqual([problem]);
  });

  it('refuses an id that is not a string, naming an unnamed binding as such', () => {
    const config = { env: { dev: { d1_databases: [{ database_id: { nested: 'prod-db' } }] } } };
    expect(environmentProblems(found(config), LISTED)).toEqual([
      'workers/api/wrangler.json env.dev d1 (unnamed) database_id is not a string',
    ]);
  });

  it('refuses bindings at the top level, where no environment is named', () => {
    const config = { d1_databases: [{ binding: 'DB', database_id: 'dev-db' }], env: {} };
    expect(environmentProblems(found(config), LISTED)).toEqual([
      'workers/api/wrangler.json top level binds d1_databases: bind stores only inside env.<environment>',
    ]);
  });

  it('refuses an environment that environments.json does not know', () => {
    const config = { env: { staging: { d1_databases: [{ binding: 'DB', database_id: 'dev-db' }] } } };
    expect(environmentProblems(found(config), LISTED)).toEqual([
      'workers/api/wrangler.json env.staging is not an environment in environments.json',
    ]);
  });

  it.each(['wrangler.jsonc', 'wrangler.toml'])('refuses a %s config, which JSON.parse cannot read', (name) => {
    expect(environmentProblems(found(null, `workers/api/${name}`), LISTED)).toEqual([
      `workers/api/${name}: write Wrangler configs as wrangler.json`,
    ]);
  });

  it('refuses a binding entry that is not an object', () => {
    const config = { env: { dev: { r2_buckets: ['dev-media'] } } };
    expect(environmentProblems(found(config), LISTED)).toEqual([
      'workers/api/wrangler.json env.dev r2_buckets holds an entry that is not a binding object',
    ]);
  });

  it('refuses a binding list that is not an array', () => {
    const config = { env: { dev: { kv_namespaces: { binding: 'KV', id: 'dev-kv' } } } };
    expect(environmentProblems(found(config), LISTED)).toEqual(['workers/api/wrangler.json env.dev kv_namespaces is not a list']);
  });
});

describe('door hosts: fixtures', () => {
  const door = {
    env: {
      test: { routes: [{ pattern: 'test.example.app', custom_domain: true }] },
      dev: { routes: [{ pattern: 'dev.example.app', custom_domain: true }, 'dev2.example.app/*'] },
    },
  };

  it("reads the hosts from the door's routes", () => {
    expect(doorHosts(door)).toEqual(['test.example.app', 'dev.example.app', 'dev2.example.app']);
  });

  it('refuses a door with no route, which would leave nothing to look for', () => {
    expect(() => doorHosts({ env: { dev: {} } })).toThrow('the door config names no route');
  });

  it.each([
    ['not an object', null],
    ['without env', { name: 'door' }],
  ])('refuses a door config that is %s', (_case, config) => {
    expect(() => doorHosts(config)).toThrow('the door config names no route');
  });

  it('passes files that name no door host', () => {
    expect(hostMentions([{ path: 'scripts/a.ts', text: 'fetch("https://api.example.app")' }], doorHosts(door))).toEqual([]);
  });

  it('refuses a door host planted in a script, naming the file and host', () => {
    const files = [
      { path: 'scripts/smoke.ts', text: 'await fetch("https://DEV.example.app/health")' },
      { path: '.github/workflows/x.yml', text: 'url: test.example.app' },
    ];
    expect(hostMentions(files, doorHosts(door))).toEqual([
      'scripts/smoke.ts names the door host dev.example.app',
      '.github/workflows/x.yml names the door host test.example.app',
    ]);
  });
});

describe('the real tree', () => {
  const listed = JSON.parse(readFileSync('environments.json', 'utf8')) as EnvironmentsFile;

  it('lists exactly the prod, test and dev environments', () => {
    expect(Object.keys(listed).sort()).toEqual(['dev', 'prod', 'test']);
  });

  it('finds the door config among the Wrangler configs', () => {
    expect(filesUnder('.', (name) => name.startsWith('wrangler.'))).toContain('workers/door/wrangler.json');
  });

  it('binds no store outside its own environment', () => {
    const configs = filesUnder('.', (name) => name.startsWith('wrangler.')).map((path) => ({
      path,
      config: path.endsWith('.json') ? (JSON.parse(readFileSync(path, 'utf8')) as unknown) : null,
    }));
    expect(environmentProblems(configs, listed)).toEqual([]);
  });

  it('names no door host under tests/, scripts/ or .github/', () => {
    const hosts = doorHosts(JSON.parse(readFileSync('workers/door/wrangler.json', 'utf8')) as unknown);
    const files = ['tests', 'scripts', '.github']
      .flatMap((root) => filesUnder(root, () => true))
      .map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    expect(files.length).toBeGreaterThan(0);
    expect(hostMentions(files, hosts)).toEqual([]);
  });
});
