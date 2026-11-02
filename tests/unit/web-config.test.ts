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
    expect(block['vars']).toEqual({ ENVIRONMENT_NAME: name });
  });

  it('prod answers shytalk.app from the production account, with no workers.dev address', () => {
    const block = environment('prod');
    expect(block['name']).toBe('shytalk-web');
    expect(block['account_id']).toBe(PROD);
    expect(block['workers_dev']).toBe(false);
    expect(block['routes']).toEqual([{ pattern: 'shytalk.app', custom_domain: true }]);
    expect(block['vars']).toEqual({ ENVIRONMENT_NAME: 'prod' });
  });

  it('has no top-level account, so no deploy can fall back to one', () => {
    expect(config()['account_id']).toBeUndefined();
  });
});
