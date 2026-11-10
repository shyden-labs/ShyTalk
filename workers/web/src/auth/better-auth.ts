/**
 * The Worker's Better Auth (plan 4 Task 3, shyden-labs/ShyTalk#76; question 3,
 * option A: created here, plan 3 Task 9 adds email codes). Staff and app users
 * are one `user` table in the environment's D1. The app signs in with a
 * Google or Apple ID token from the phone and holds the session as a bearer
 * token. ID tokens are checked by `verifyIdToken` (./id-token.ts).
 */
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { bearer } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
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

/**
 * How passkey registration learns who is registering when there is no session
 * (shyden-labs/ShyTalk#134): `context` is the hash of #133's sign-up or
 * recovery token. `afterRegistration` runs once the plugin has verified the
 * passkey and before it writes it, so a sign-up's member exists first.
 */
export interface PasskeyHooks {
  resolveUser(context: string | null | undefined): Promise<{ id: string; name: string } | null>;
  afterRegistration(context: string | null | undefined, userId: string): Promise<void>;
}

/** Registration without a session, through the router's hooks; without hooks the plugin keeps its default, a session required. */
const registrationThrough = (hooks: PasskeyHooks) => ({
  requireSession: false,
  resolveUser: async ({ context }: { context?: string | null | undefined }) => {
    const user = await hooks.resolveUser(context);
    if (user === null) throw new APIError('UNAUTHORIZED', { message: 'sign_in_refused' });
    return { id: user.id, name: user.name, displayName: user.name };
  },
  afterVerification: async ({ context, user }: { context?: string | null | undefined; user: { id: string } }) => {
    await hooks.afterRegistration(context, user.id);
  },
});

export interface AuthDeps {
  passkeys?: PasskeyHooks;
  database: BetterAuthOptions['database'];
  googleKeys: JWTVerifyGetKey;
  appleKeys: JWTVerifyGetKey;
}

/** The website session cookie's life: Better Auth's ceiling of 400 days (shyden-labs/ShyTalk#134). */
export const SESSION_COOKIE_SECONDS = 34_560_000;
/** A session row's stored life: 100 years, so no session ends through age (shyden-labs/ShyTalk#134 AC5). */
export const SESSION_ROW_MS = 100 * 365.25 * 86_400_000;

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
    // Link a Google or Apple sign-in to an existing member only on a verified email at both ends (shyden-labs/ShyTalk#133):
    // no trusted providers, since a trusted one links even when the provider has not verified the email.
    account: { accountLinking: { enabled: true } },
    // A session ends only by sign-out, a revoke, staff or a completed recovery, never by age or disuse (shyden-labs/ShyTalk#134,
    // Shyden 2026-11-08). Better Auth sets the website cookie's Max-Age from expiresIn and refuses more than 400 days, so the
    // cookie keeps that ceiling while each session row is stored to end in 100 years. Better Auth refreshes a row only once its
    // expiry is within expiresIn of now, so these rows are never rewritten by use.
    session: { expiresIn: SESSION_COOKIE_SECONDS, updateAge: 86_400 },
    databaseHooks: {
      session: {
        create: {
          before: (session) => Promise.resolve({ data: { ...session, expiresAt: new Date(Date.now() + SESSION_ROW_MS) } }),
        },
      },
    },
    plugins: [
      bearer(),
      // Passkeys (shyden-labs/ShyTalk#134 AC1): this environment's own host, so a dev passkey never works on prod; the
      // phone's biometric step or PIN every time. Registration without a session takes #133's token through the hooks.
      passkey({
        rpID: new URL(env.SITE_ORIGIN).hostname,
        rpName: 'ShyTalk',
        origin: env.SITE_ORIGIN,
        authenticatorSelection: { userVerification: 'required', residentKey: 'required' },
        ...(deps.passkeys === undefined ? {} : { registration: registrationThrough(deps.passkeys) }),
      }),
    ],
  });
}

export type ShyTalkAuth = ReturnType<typeof createAuth>;

/** The Worker's D1 binding, as Better Auth types the D1 database it accepts. */
export type AuthDatabase = Extract<NonNullable<BetterAuthOptions['database']>, { batch: unknown; exec: unknown }>;

const instances = new WeakMap<object, ShyTalkAuth>();

/**
 * The environment's Better Auth on its D1, made once per binding for the
 * isolate's life, with the passkey hooks `passkeys` makes (the router gives
 * them, as they reach the app's own tables).
 */
export function getAuth(env: AuthEnv & { DB: AuthDatabase }, passkeys?: () => PasskeyHooks): ShyTalkAuth {
  let auth = instances.get(env.DB);
  if (auth === undefined) {
    auth = createAuth(env, {
      database: env.DB,
      googleKeys: GOOGLE_KEYS,
      appleKeys: APPLE_KEYS,
      ...(passkeys === undefined ? {} : { passkeys: passkeys() }),
    });
    instances.set(env.DB, auth);
  }
  return auth;
}
