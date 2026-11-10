import { describe, expect, it } from 'vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuth, type ShyTalkAuth } from '../../workers/web/src/auth/better-auth.ts';
import { assert, register, type SignInAnswer, type SoftCredential } from '../support/webauthn.ts';

/**
 * Better Auth's passkey plugin as ShyTalk sets it up (plan 7 Task 5,
 * shyden-labs/ShyTalk#134 AC1), on the memory adapter, answered by the
 * software authenticator in tests/support/webauthn.ts: registration from a
 * session or from #133's token (through `resolveUser`), sign-in with a fresh
 * one-time challenge, and the plugin's own refusals.
 */

const ORIGIN = 'https://dev.site.example';

interface Hooks {
  resolved: (string | null | undefined)[];
  registered: { context: string | null | undefined; userId: string }[];
}

function world() {
  const store: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification: [], passkey: [] };
  const hooks: Hooks = { resolved: [], registered: [] };
  const auth = createAuth(
    {
      ENVIRONMENT_NAME: 'dev',
      SITE_ORIGIN: ORIGIN,
      BETTER_AUTH_SECRET: 'a-test-secret-that-is-long-enough-for-better-auth',
      GOOGLE_CLIENT_IDS: 'g',
      APPLE_AUDIENCES: 'a',
    },
    {
      database: memoryAdapter(store),
      googleKeys: () => Promise.reject(new Error('unused')),
      appleKeys: () => Promise.reject(new Error('unused')),
      passkeys: {
        resolveUser: (context) => {
          hooks.resolved.push(context);
          return Promise.resolve(context === 'token-hash-ok' ? { id: 'u-new', name: 'new@example.test' } : null);
        },
        afterRegistration: (context, userId) => {
          hooks.registered.push({ context, userId });
          if (context === 'token-hash-ok') {
            store['user']?.push({
              id: 'u-new',
              name: 'new',
              email: 'new@example.test',
              emailVerified: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
          return Promise.resolve();
        },
      },
    },
  );
  return { auth, store, hooks };
}

/** The member and a session for them, as a sign-in would leave. */
async function member(auth: ShyTalkAuth, store: Record<string, Record<string, unknown>[]>, id = 'u-1'): Promise<Headers> {
  store['user']?.push({
    id,
    name: 'Member',
    email: `${id}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const session = await (await auth.$context).internalAdapter.createSession(id);
  return new Headers({ authorization: `Bearer ${session.token}`, origin: ORIGIN });
}

/** The cookies an answer set, as the browser would send them back. */
const cookiesFrom = (headers: Headers): string =>
  headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

async function registerWith(auth: ShyTalkAuth, headers: Headers, context?: string): Promise<{ credential: SoftCredential; ok: boolean }> {
  const options = await auth.api.generatePasskeyRegistrationOptions({
    headers,
    query: context === undefined ? {} : { context },
    returnHeaders: true,
  });
  const { challenge, rp, authenticatorSelection } = options.response as {
    challenge: string;
    rp: { id: string };
    authenticatorSelection?: { userVerification?: string };
  };
  expect(rp.id).toBe('dev.site.example');
  expect(authenticatorSelection?.userVerification).toBe('required');
  const { credential, response } = await register({ rpId: rp.id, origin: ORIGIN, challenge });
  const withCookie = new Headers(headers);
  withCookie.set('cookie', cookiesFrom(options.headers));
  try {
    await auth.api.verifyPasskeyRegistration({ headers: withCookie, body: { response } });
    return { credential, ok: true };
  } catch {
    return { credential, ok: false };
  }
}

async function signInWith(auth: ShyTalkAuth, credential: SoftCredential, replay?: SignInAnswer) {
  const options = await auth.api.generatePasskeyAuthenticationOptions({ headers: new Headers({ origin: ORIGIN }), returnHeaders: true });
  const { challenge } = options.response as { challenge: string };
  const response = replay ?? (await assert(credential, { rpId: 'dev.site.example', origin: ORIGIN, challenge }));
  const headers = new Headers({ origin: ORIGIN, cookie: cookiesFrom(options.headers) });
  try {
    const answer = await auth.api.verifyPasskeyAuthentication({ headers, body: { response } });
    return { answer: answer as { session: { token: string; userId: string } }, response };
  } catch {
    return { answer: null, response };
  }
}

describe('the passkey plugin as ShyTalk sets it up', () => {
  it('registers a passkey for a signed-in member, keeping only its public key', async () => {
    const { auth, store, hooks } = world();
    const { ok } = await registerWith(auth, await member(auth, store));
    expect(ok).toBe(true);
    expect(store['passkey']).toHaveLength(1);
    expect(store['passkey']?.[0]?.['userId']).toBe('u-1');
    expect(hooks.resolved).toEqual([]);
    expect(hooks.registered).toEqual([{ context: null, userId: 'u-1' }]);
  });

  it("registers from #133's token through resolveUser when there is no session", async () => {
    const { auth, store, hooks } = world();
    const { ok } = await registerWith(auth, new Headers({ origin: ORIGIN }), 'token-hash-ok');
    expect(ok).toBe(true);
    expect(hooks.resolved).toEqual(['token-hash-ok']);
    expect(hooks.registered).toEqual([{ context: 'token-hash-ok', userId: 'u-new' }]);
    expect(store['passkey']?.[0]?.['userId']).toBe('u-new');
  });

  it('refuses registration with neither a session nor a token it knows', async () => {
    const { auth } = world();
    await expect(
      auth.api.generatePasskeyRegistrationOptions({ headers: new Headers({ origin: ORIGIN }), query: { context: 'unknown' } }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('signs in with the passkey, starting a session for its member', async () => {
    const { auth, store } = world();
    const { credential } = await registerWith(auth, await member(auth, store));
    const { answer } = await signInWith(auth, credential);
    expect(answer?.session.userId).toBe('u-1');
  });

  it('refuses a sign-in answer replayed against a fresh challenge', async () => {
    const { auth, store } = world();
    const { credential } = await registerWith(auth, await member(auth, store));
    const first = await signInWith(auth, credential);
    expect(first.answer).not.toBeNull();
    const replayed = await signInWith(auth, credential, first.response);
    expect(replayed.answer).toBeNull();
  });
});
