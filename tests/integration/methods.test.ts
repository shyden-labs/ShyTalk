import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuth, type ShyTalkAuth } from '../../workers/web/src/auth/better-auth.ts';
import { handleMethods, type MethodsEnv } from '../../workers/web/src/app/methods.ts';
import { appSession } from '../../workers/web/src/app/session.ts';
import { issuer } from '../support/id-tokens.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * Methods and devices on a real D1 (plan 7 Task 6, shyden-labs/ShyTalk#134 AC4,
 * AC6): the last-method rule inside the DELETE, and a revoked device's next
 * request refused.
 */

let local: LocalDevEnv;
let dispose: () => Promise<void>;
let auth: ShyTalkAuth;
let env: MethodsEnv;

beforeAll(async () => {
  ({ env: local, dispose } = await localDev());
  const keys = (await issuer(inject('idTokenKeys'))).keys;
  auth = createAuth(
    {
      ENVIRONMENT_NAME: 'dev',
      SITE_ORIGIN: 'https://site.example.test',
      BETTER_AUTH_SECRET: 'an-integration-secret-long-enough-for-better-auth',
      GOOGLE_CLIENT_IDS: 'g',
      APPLE_AUDIENCES: 'a',
    },
    { database: local.DB, googleKeys: keys, appleKeys: keys },
  );
  env = { ENVIRONMENT_NAME: 'dev', DB: local.DB } as unknown as MethodsEnv;
});

afterAll(async () => {
  await dispose();
});

const at = (): string => new Date().toISOString();

async function memberWithPasskeys(id: string, passkeys: string[], google = false): Promise<void> {
  await local.DB.prepare('INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)')
    .bind(id, 'Member', `${id}@example.test`, at(), at())
    .run();
  for (const passkey of passkeys)
    await local.DB.prepare(
      'INSERT INTO passkey (id, name, "publicKey", "userId", "credentialID", counter, "deviceType", "backedUp", "createdAt") VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?)',
    )
      .bind(passkey, passkey, 'key', id, `cred-${passkey}`, 'singleDevice', at())
      .run();
  if (google)
    await local.DB.prepare(
      'INSERT INTO account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(`acc-${id}`, `g-${id}`, 'google', id, at(), at())
      .run();
}

const as =
  (userId: string, sessionId = 's') =>
  () =>
    Promise.resolve({ sessionId, userId, email: `${userId}@example.test`, createdAt: Date.now() });
const remove = (userId: string, path: string) =>
  handleMethods(new Request(`https://site.example.test/api/app/${path}`, { method: 'DELETE' }), env, as(userId));

describe('methods and devices on D1', () => {
  it('lets one of two removals at one moment take the last-but-one passkey, refusing the other with 409', async () => {
    await memberWithPasskeys('u-two', ['pk-a', 'pk-b']);
    const answers = await Promise.all([remove('u-two', 'sign-in-methods/passkey/pk-a'), remove('u-two', 'sign-in-methods/passkey/pk-b')]);
    expect(answers.map(({ status }) => status).sort()).toEqual([200, 409]);
    const left = await local.DB.prepare('SELECT COUNT(*) AS n FROM passkey WHERE "userId" = ?').bind('u-two').first<{ n: number }>();
    expect(left?.n).toBe(1);
  });

  it('counts a Google link as a way in', async () => {
    await memberWithPasskeys('u-google', ['pk-g'], true);
    expect((await remove('u-google', 'sign-in-methods/passkey/pk-g')).status).toBe(200);
  });

  it("refuses a revoked device's next request", async () => {
    await memberWithPasskeys('u-devices', []);
    const other = await (await auth.$context).internalAdapter.createSession('u-devices');
    const bearer = new Request('https://site.example.test/api/app/x', { headers: { authorization: `Bearer ${other.token}` } });
    expect((await appSession(bearer, auth))?.userId).toBe('u-devices');
    expect((await remove('u-devices', `sessions/${other.id}`)).status).toBe(200);
    expect(await appSession(bearer, auth)).toBeNull();
  });
});
