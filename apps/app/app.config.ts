import type { ExpoConfig } from 'expo/config';
import web from '../../workers/web/wrangler.json' with { type: 'json' };

/**
 * The app's build settings (plan 6.1 Task 1). Each environment's build talks to
 * that environment's people-facing site (`SITE_ORIGIN` in
 * workers/web/wrangler.json), so no build carries a password or a door secret
 * (Shyden, 2026-11-22, shyden-labs/ShyTalk#314). The ids and the version code
 * carry on from the store apps.
 */
export type AppEnvironment = 'dev' | 'test' | 'prod';

const ENVIRONMENTS: readonly string[] = ['dev', 'test', 'prod'];

export function appConfig(env: { SHYTALK_ENV: AppEnvironment }): ExpoConfig {
  const environment = env.SHYTALK_ENV;
  if (!ENVIRONMENTS.includes(environment)) throw new Error(`appConfig: unknown SHYTALK_ENV "${environment}"`);
  return {
    name: 'ShyTalk',
    slug: 'shytalk',
    scheme: 'shytalk',
    version: '1.0.0',
    ios: { bundleIdentifier: 'com.shyden.shytalk' },
    android: { package: 'com.shyden.shytalk', versionCode: 179 },
    plugins: ['expo-router'],
    extra: { apiBase: web.env[environment].vars.SITE_ORIGIN },
  };
}

/** What `expo prebuild` and the dev server read: the environment comes from SHYTALK_ENV, DEV when unset. */
export default (): ExpoConfig => appConfig({ SHYTALK_ENV: (process.env['SHYTALK_ENV'] ?? 'dev') as AppEnvironment });
