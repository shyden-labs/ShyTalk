/**
 * The Worker's Better Auth (plan 4 Task 3, shyden-labs/ShyTalk#76; question 3,
 * option A: created here, plan 3 Task 9 adds email codes). Staff and app users
 * are one `user` table in the environment's D1. The app signs in with a
 * Google or Apple ID token from the phone and holds the session as a bearer
 * token. ID tokens are checked by `verifyIdToken` (./id-token.ts).
 */
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import type { JWTVerifyGetKey } from 'jose';
import { APPLE_ISSUERS, APPLE_KEYS, GOOGLE_ISSUERS, GOOGLE_KEYS, verifyIdToken } from './id-token.ts';

export interface AuthEnv {
  ENVIRONMENT_NAME: 'prod' | 'test' | 'dev';
  /** This environment's own origin, `https://shytalk.app` or its `dev.`/`test.` door (a var). */
  SITE_ORIGIN: string;
  /** Signs Better Auth's cookies and tokens (a Wrangler secret). */
  BETTER_AUTH_SECRET: string;
  /** Our Google OAuth client IDs, comma-separated: web, Android, iOS (a var: client IDs are public). */
  GOOGLE_CLIENT_IDS: string;
  /** The audiences Apple signs for us, comma-separated: the app's bundle ID (a var). */
  APPLE_AUDIENCES: string;
}

export interface AuthDeps {
  database: BetterAuthOptions['database'];
  googleKeys: JWTVerifyGetKey;
  appleKeys: JWTVerifyGetKey;
}

/** A comma-separated var as its non-empty entries. */
export const listOf = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

/** Better Auth for `env` on `deps.database`, with the providers' keys from `deps`. */
export function createAuth(env: AuthEnv, deps: AuthDeps) {
  const googleIds = listOf(env.GOOGLE_CLIENT_IDS);
  const appleIds = listOf(env.APPLE_AUDIENCES);
  return betterAuth({
    appName: 'ShyTalk',
    baseURL: env.SITE_ORIGIN,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: deps.database,
    telemetry: { enabled: false },
    socialProviders: {
      google: {
        clientId: googleIds,
        verifyIdToken: (token, nonce) =>
          verifyIdToken(token, { keys: deps.googleKeys, issuer: GOOGLE_ISSUERS, audience: googleIds }, nonce),
      },
      apple: {
        clientId: appleIds,
        verifyIdToken: (token, nonce) =>
          verifyIdToken(token, { keys: deps.appleKeys, issuer: APPLE_ISSUERS, audience: appleIds, nonce: 'required' }, nonce),
      },
    },
    plugins: [bearer()],
  });
}

export type ShyTalkAuth = ReturnType<typeof createAuth>;

/** The Worker's D1 binding, as Better Auth types the D1 database it accepts. */
export type AuthDatabase = Extract<NonNullable<BetterAuthOptions['database']>, { batch: unknown; exec: unknown }>;

const instances = new WeakMap<object, ShyTalkAuth>();

/** The environment's Better Auth on its D1, made once per binding for the isolate's life. */
export function getAuth(env: AuthEnv & { DB: AuthDatabase }): ShyTalkAuth {
  let auth = instances.get(env.DB);
  if (auth === undefined) {
    auth = createAuth(env, { database: env.DB, googleKeys: GOOGLE_KEYS, appleKeys: APPLE_KEYS });
    instances.set(env.DB, auth);
  }
  return auth;
}
