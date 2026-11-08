import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The site Worker's Wrangler config (plan 3 Task 1, shyden-labs/ShyTalk#51;
 * design 4.17): PROD answers shytalk.app from the production account; TEST
 * and DEV are the doors' workers.dev origins on the Non-Prod account.
 */

type Config = Record<string, unknown>;
const config = (): Config => JSON.parse(readFileSync('workers/web/wrangler.json', 'utf8')) as Config;
const environment = (name: string): Config => (config()['env'] as Record<string, Config>)[name] as Config;

const NON_PROD = '6a27c9ff4b4eefef2c46535449ea4f49';
const PROD = 'debdf0b47ce2f7e5554e99c1f5d3a1e0';

describe('web config', () => {
  it('serves the built site, running the Worker first and each language its own 404', () => {
    expect(config()['main']).toBe('src/index.ts');
    expect(config()['assets']).toEqual({
      directory: '../../apps/web/dist',
      binding: 'ASSETS',
      run_worker_first: true,
      not_found_handling: '404-page',
    });
  });

  it('has exactly the production, test and dev environments', () => {
    expect(Object.keys(config()['env'] as Config).sort()).toEqual(['dev', 'prod', 'test']);
  });

  it.each([
    ['dev', 'shytalk-dev', NON_PROD],
    ['test', 'shytalk-test', NON_PROD],
  ])('%s is the door origin %s on the Non-Prod account, named by its marker var', (name, worker, account) => {
    const block = environment(name);
    expect(block['name']).toBe(worker);
    expect(block['account_id']).toBe(account);
    expect(block['workers_dev']).toBe(true);
    expect(block['routes']).toBeUndefined();
    expect((block['vars'] as Config)['ENVIRONMENT_NAME']).toBe(name);
  });

  it('prod answers shytalk.app from the production account, with no workers.dev address', () => {
    const block = environment('prod');
    expect(block['name']).toBe('shytalk-web');
    expect(block['account_id']).toBe(PROD);
    expect(block['workers_dev']).toBe(false);
    expect(block['routes']).toEqual([{ pattern: 'shytalk.app', custom_domain: true }]);
    expect((block['vars'] as Config)['ENVIRONMENT_NAME']).toBe('prod');
  });

  it('has no top-level account, so no deploy can fall back to one', () => {
    expect(config()['account_id']).toBeUndefined();
  });
});

// App sign-in's settings (plan 4 Task 3, shyden-labs/ShyTalk#76). Client IDs
// are public, so they are vars; GOOGLE_CLIENT_IDS stays empty (sign-in answers
// 503) until the Google clients exist.
describe('app sign-in config', () => {
  // TEST's and DEV's origins are their doors, read from the door's own config:
  // no test names a door host (environments.test.ts).
  const door = JSON.parse(readFileSync('workers/door/wrangler.json', 'utf8')) as { env: Record<string, { routes: { pattern: string }[] }> };
  const doorOrigin = (name: string): string => `https://${door.env[name]?.routes[0]?.pattern ?? 'no-door-route'}`;
  const ORIGINS = { prod: 'https://shytalk.app', test: doorOrigin('test'), dev: doorOrigin('dev') };

  // The audiences Google signs app tokens for, from project `shytalk-app`
  // (made 2026-11-05): Android tokens name the web client, iOS tokens the iOS
  // client. The three Android clients only bind the package to its keys.
  const GOOGLE_WEB = '415977447751-nu1hom2nn6dlg15gdh02de1kl3rm3onj.apps.googleusercontent.com';
  const GOOGLE_IOS = '415977447751-s5v065q1pv58mjqp12bmosknv2g96ak1.apps.googleusercontent.com';

  it.each(Object.entries(ORIGINS))('%s holds its origin, the client IDs and the bundle ID as vars', (name, origin) => {
    expect(environment(name)['vars']).toEqual({
      ENVIRONMENT_NAME: name,
      SITE_ORIGIN: origin,
      GOOGLE_CLIENT_IDS: `${GOOGLE_WEB},${GOOGLE_IOS}`,
      APPLE_AUDIENCES: 'com.shyden.shytalk',
    });
  });

  it.each(Object.keys(ORIGINS))('%s limits sign-in to 10 a minute', (name) => {
    const [limit, ...others] = environment(name)['ratelimits'] as Config[];
    expect(others).toEqual([]);
    expect(limit).toMatchObject({ name: 'SIGN_IN_LIMIT', simple: { limit: 10, period: 60 } });
  });

  it('gives each environment its own counter: dev and test share an account, so they must not share a namespace', () => {
    const ids = Object.keys(ORIGINS).map((name) => ((environment(name)['ratelimits'] as Config[])[0] as Config)['namespace_id']);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[1-9][0-9]*$/);
  });

  // The live announcement (plan 4 Task 8, shyden-labs/ShyTalk#81). Durable
  // Object bindings are not inherited, so each environment names its own;
  // the Free plan runs only SQLite-backed objects.
  it.each(Object.keys(ORIGINS))('%s binds ANNOUNCER to the Announcer class and nothing else', (name) => {
    expect(environment(name)['durable_objects']).toEqual({ bindings: [{ name: 'ANNOUNCER', class_name: 'Announcer' }] });
  });

  // ShyTalk#88: only PROD holds a mail binding, and it may send only as the live sender;
  // TEST and DEV send through their door.
  it('prod may send only as no-reply@shytalk.app', () => {
    expect(environment('prod')['send_email']).toEqual([{ name: 'EMAIL', allowed_sender_addresses: ['no-reply@shytalk.app'] }]);
  });

  it.each(['test', 'dev'])('%s holds no mail binding', (name) => {
    expect(environment(name)['send_email']).toBeUndefined();
  });

  it('creates the Announcer as a SQLite-backed class in its first migration', () => {
    expect(config()['migrations']).toEqual([{ tag: 'v1', new_sqlite_classes: ['Announcer'] }]);
  });
});
