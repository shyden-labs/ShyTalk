import { describe, expect, it } from 'vitest';
import { passkeyHooks, preparedKey, type PreparedPasskeys } from '../../workers/web/src/app/passkey-hooks.ts';
import type { SetupIdentity } from '../../workers/web/src/app/setup-identity.ts';

/**
 * What Better Auth's passkey plugin calls while registering (plan 7 Task 5,
 * shyden-labs/ShyTalk#134): who a token's hash names, and, once the passkey is
 * verified and before it is written, the setup's database part
 * (prepareSetup), whose result the route then reads. Who-is-setting-up and
 * prepareSetup are stood in; each has its own tests.
 */

const SIGN_UP: SetupIdentity = { kind: 'sign-up', userId: 'u-new', email: 'new@example.test', tokenHash: 'h-1' };
const RECOVERY: SetupIdentity = { kind: 'recovery', userId: 'u-1', recoveryId: 3, tokenHash: 'h-2' };

function setting(
  identities: Record<string, SetupIdentity | Response>,
  prepared: { userId: string; recoveryCodes?: string[] } | Response = { userId: 'u-new', recoveryCodes: ['A'] },
) {
  const store: PreparedPasskeys = new Map();
  const asked: SetupIdentity[] = [];
  const hooks = passkeyHooks(
    {
      identityByHash: (hash) => Promise.resolve(identities[hash] ?? new Response(null, { status: 401 })),
      prepare: (identity) => {
        asked.push(identity);
        return Promise.resolve(prepared);
      },
    },
    store,
  );
  return { hooks, store, asked };
}

describe('resolveUser', () => {
  it("names a sign-up's member by its confirmed address", async () => {
    const { hooks } = setting({ 'h-1': SIGN_UP });
    expect(await hooks.resolveUser('h-1')).toEqual({ id: 'u-new', name: 'new@example.test' });
  });

  it('names a ready recovery by its member', async () => {
    const { hooks } = setting({ 'h-2': RECOVERY });
    expect(await hooks.resolveUser('h-2')).toEqual({ id: 'u-1', name: 'u-1' });
  });

  it('answers null for no context, an unknown hash or a refused one', async () => {
    const { hooks } = setting({ 'h-3': new Response(null, { status: 403 }) });
    expect(await hooks.resolveUser(null)).toBeNull();
    expect(await hooks.resolveUser('nope')).toBeNull();
    expect(await hooks.resolveUser('h-3')).toBeNull();
  });
});

describe('afterRegistration', () => {
  it("prepares a token's setup for the passkey and keeps the result for the route, by context and member", async () => {
    const { hooks, store, asked } = setting({ 'h-1': SIGN_UP });
    await hooks.afterRegistration('h-1', 'u-new');
    expect(asked).toEqual([SIGN_UP]);
    expect(store.get(preparedKey('h-1', 'u-new'))).toEqual({ identity: SIGN_UP, prepared: { userId: 'u-new', recoveryCodes: ['A'] } });
  });

  it('prepares a signed-in member adding a passkey', async () => {
    const { hooks, store, asked } = setting({}, { userId: 'u-1' });
    await hooks.afterRegistration(null, 'u-1');
    expect(asked).toEqual([{ kind: 'session', userId: 'u-1' }]);
    expect(store.get(preparedKey(null, 'u-1'))?.prepared).toEqual({ userId: 'u-1' });
  });

  it("refuses a token whose member is not the one registering (a session's member with another's token)", async () => {
    const { hooks, store, asked } = setting({ 'h-1': SIGN_UP });
    await expect(hooks.afterRegistration('h-1', 'u-session')).rejects.toMatchObject({ statusCode: 401 });
    expect(asked).toEqual([]);
    expect(store.size).toBe(0);
  });

  it('refuses, with its status, when the setup cannot be prepared (its token spent meanwhile)', async () => {
    const { hooks, store } = setting({ 'h-1': SIGN_UP }, new Response(null, { status: 401 }));
    await expect(hooks.afterRegistration('h-1', 'u-new')).rejects.toMatchObject({ statusCode: 401 });
    expect(store.size).toBe(0);
  });

  it('refuses with 500 when the setup could not be written (D1 failing), so the route answers a failure, not a refusal', async () => {
    const { hooks, store } = setting({ 'h-1': SIGN_UP }, new Response(null, { status: 500 }));
    await expect(hooks.afterRegistration('h-1', 'u-new')).rejects.toMatchObject({ statusCode: 500 });
    expect(store.size).toBe(0);
  });

  it('refuses an unknown token', async () => {
    const { hooks } = setting({});
    await expect(hooks.afterRegistration('nope', 'u-new')).rejects.toMatchObject({ statusCode: 401 });
  });
});
