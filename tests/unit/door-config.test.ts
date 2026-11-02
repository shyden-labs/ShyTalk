import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The door's Wrangler config (ShyTalk#28): keys are allowed by name, so the
 * door can hold no binding (no D1, R2, KV, service or secret store) and only
 * forwards. Each environment's vars hold ORIGIN alone; the door secret is a
 * Wrangler secret, never a var.
 */

type Config = Record<string, unknown>;
const config = (): Config => JSON.parse(readFileSync('workers/door/wrangler.json', 'utf8')) as Config;
const environment = (name: string): Config => (config()['env'] as Record<string, Config>)[name] as Config;

describe('door config', () => {
  it('holds only the allowed top-level keys', () => {
    expect(Object.keys(config()).sort()).toEqual(['account_id', 'compatibility_date', 'env', 'main', 'name', 'workers_dev']);
  });

  // The doors live in the production "shytalk" account, which holds the
  // shytalk.app zone (decisions 193, 207); the id was read from Cloudflare (ShyTalk#26).
  it('deploys to the production shytalk account, never Non-Prod', () => {
    expect(config()['account_id']).toBe('debdf0b47ce2f7e5554e99c1f5d3a1e0');
  });

  it('runs src/index.ts, never on a workers.dev address of its own', () => {
    expect(config()['main']).toBe('src/index.ts');
    expect(config()['workers_dev']).toBe(false);
  });

  it('has exactly the test and dev environments', () => {
    expect(Object.keys(config()['env'] as Config).sort()).toEqual(['dev', 'test']);
  });

  it.each(['test', 'dev'])('the %s environment holds only name, routes and vars', (name) => {
    expect(Object.keys(environment(name)).sort()).toEqual(['name', 'routes', 'vars']);
  });

  it.each(['test', 'dev'])('the %s environment vars hold ORIGIN alone', (name) => {
    expect(Object.keys(environment(name)['vars'] as Config)).toEqual(['ORIGIN']);
  });

  // The Non-Prod account's workers.dev subdomain, read from Cloudflare on
  // 2026-11-01 (ShyTalk#30); each door forwards to its own environment's Worker.
  it.each(['test', 'dev'])('the %s door forwards to its own Worker on the Non-Prod workers.dev address', (name) => {
    expect((environment(name)['vars'] as Config)['ORIGIN']).toBe(`https://shytalk-${name}.shytalk-non-prod.workers.dev`);
  });

  it.each(['test', 'dev'])('the %s door answers on %s.shytalk.app as a custom domain', (name) => {
    expect(environment(name)['name']).toBe(`shytalk-door-${name}`);
    expect(environment(name)['routes']).toEqual([{ pattern: `${name}.shytalk.app`, custom_domain: true }]);
  });
});
