import { describe, it, expect, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import config, { appConfig } from '../../app.config.ts';

/**
 * The app's build settings (plan 6.1 Task 1): one app id on both stores, the
 * store's next version code, and the API each environment's build talks to:
 * that environment's people-facing site, so no build carries a password or
 * a door secret (Shyden, 2026-11-22, shyden-labs/ShyTalk#314).
 */

const web = JSON.parse(readFileSync(`${__dirname}/../../../../workers/web/wrangler.json`, 'utf8')) as {
  env: Record<string, { vars: { SITE_ORIGIN: string } }>;
};
const siteOrigin = (environment: string): string => {
  const origin = web.env[environment]?.vars.SITE_ORIGIN;
  if (!origin) throw new Error(`workers/web/wrangler.json gives ${environment} no SITE_ORIGIN`);
  return origin;
};

describe('appConfig', () => {
  it('names the store apps on both platforms', () => {
    const config = appConfig({ SHYTALK_ENV: 'dev' });
    expect(config.ios?.bundleIdentifier).toBe('com.shyden.shytalk');
    expect(config.android?.package).toBe('com.shyden.shytalk');
  });

  it('gives Android a version code above the store apps last one, 178', () => {
    expect(appConfig({ SHYTALK_ENV: 'dev' }).android?.versionCode).toBeGreaterThan(178);
  });

  it('starts at version 1.0.0', () => {
    expect(appConfig({ SHYTALK_ENV: 'prod' }).version).toBe('1.0.0');
  });

  it('points DEV at the dev site', () => {
    expect(appConfig({ SHYTALK_ENV: 'dev' }).extra?.['apiBase']).toBe(siteOrigin('dev'));
  });

  it('points TEST at the test site', () => {
    expect(appConfig({ SHYTALK_ENV: 'test' }).extra?.['apiBase']).toBe(siteOrigin('test'));
  });

  it('points PROD at the live site', () => {
    expect(appConfig({ SHYTALK_ENV: 'prod' }).extra?.['apiBase']).toBe(siteOrigin('prod'));
  });

  it('carries no password or secret in any environment', () => {
    for (const environment of ['dev', 'test', 'prod'] as const) {
      const text = JSON.stringify(appConfig({ SHYTALK_ENV: environment }));
      expect(text).not.toMatch(/password|secret/i);
    }
  });

  it('refuses an environment it does not know, naming it', () => {
    expect(() => appConfig({ SHYTALK_ENV: 'staging' as 'dev' })).toThrow('appConfig: unknown SHYTALK_ENV "staging"');
  });

  afterEach(() => {
    delete process.env['SHYTALK_ENV'];
  });

  it('is what expo prebuild reads, for the environment in SHYTALK_ENV', () => {
    process.env['SHYTALK_ENV'] = 'test';
    expect(config().extra?.['apiBase']).toBe(siteOrigin('test'));
  });

  it('builds DEV when SHYTALK_ENV is unset', () => {
    expect(config().extra?.['apiBase']).toBe(siteOrigin('dev'));
  });
});
