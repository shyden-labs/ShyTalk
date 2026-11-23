import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuth, type ShyTalkAuth } from '../../workers/web/src/auth/better-auth.ts';
import { finishSetup } from '../../workers/web/src/app/finish-setup.ts';
import { appSession } from '../../workers/web/src/app/session.ts';
import type { SignInEnv } from '../../workers/web/src/app/sign-in.ts';
import { tokenHash } from '../../workers/web/src/app/email-code.ts';
import { issuer } from '../support/id-tokens.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * Finishing a setup on a real D1 (plan 7, shyden-labs/ShyTalk#134): the member
 * a sign-up writes is one Better Auth reads back through its session, and a
 * recovery ends every older session of the member.
 */

let local: LocalDevEnv;
let dispose: () => Promise<void>;
let auth: ShyTalkAuth;
let env: SignInEnv;

beforeAll(async () => {
  ({ env: local, dispose } = await localDev());
  const settings = {
    ENVIRONMENT_NAME: 'dev',
    SITE_ORIGIN: 'https://site.example.test',
    BETTER_AUTH_SECRET: 'an-integration-secret-long-enough-for-better-auth',
    GOOGLE_CLIENT_IDS: 'g',
    APPLE_AUDIENCES: 'a',
  } as const;
  const keys = (await issuer(inject('idTokenKeys'))).keys;
  auth = createAuth(settings, { database: local.DB, googleKeys: keys, appleKeys: keys });
  env = { ...settings, DB: local.DB, SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: true }) } };
});

afterAll(async () => {
  await dispose();
});

const bearer = (token: string): Request =>
  new Request('https://site.example.test/api/app/x', { headers: { authorization: `Bearer ${token}` } });

describe('finishSetup on D1', () => {
  it('makes a sign-up a member Better Auth reads back through the new session', async () => {
    const hash = await tokenHash('sign-up-finish');
    await local.DB.prepare("INSERT INTO one_time_token (token_hash, purpose, user_id, email, expires_at) VALUES (?, 'sign-up', ?, ?, ?)")
      .bind(hash, 'u-finish', 'finish@example.test', Date.now() + 600_000)
      .run();
    const finished = await finishSetup(
      env,
      auth,
      { kind: 'sign-up', userId: 'u-finish', email: 'finish@example.test', tokenHash: hash },
      'totp',
      Date.now(),
    );
    if (finished instanceof Response) throw new Error(`refused ${String(finished.status)}`);
    const session = await appSession(bearer(finished.token ?? ''), auth);
    expect(session?.userId).toBe('u-finish');
    expect(session?.email).toBe('finish@example.test');
    expect(finished.recoveryCodes).toHaveLength(10);
  });

  it('ends every older session of a recovering member', async () => {
    const at = new Date().toISOString();
    await local.DB.prepare('INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)')
      .bind('u-recovers', 'Member', 'recovers@example.test', at, at)
      .run();
    const older = await (await auth.$context).internalAdapter.createSession('u-recovers');
    const another = await (await auth.$context).internalAdapter.createSession('u-recovers');
    const hash = await tokenHash('recovery-finish');
    await local.DB.prepare(
      "INSERT INTO one_time_token (token_hash, purpose, user_id, email, expires_at) VALUES (?, 'recovery', ?, NULL, ?)",
    )
      .bind(hash, 'u-recovers', Date.now() + 600_000)
      .run();
    await local.DB.prepare(
      'INSERT INTO passkey (id, name, "publicKey", "userId", "credentialID", counter, "deviceType", "backedUp") VALUES (?, ?, ?, ?, ?, 0, ?, 0)',
    )
      .bind('pk-lost', 'Lost phone', 'key', 'u-recovers', 'cred-lost', 'singleDevice')
      .run();
    const identity = { kind: 'recovery', userId: 'u-recovers', recoveryId: 999, tokenHash: hash } as const;
    const finished = await finishSetup(env, auth, identity, 'totp', Date.now());
    if (finished instanceof Response) throw new Error(`refused ${String(finished.status)}`);
    expect(await appSession(bearer(older.token), auth)).toBeNull();
    expect(await appSession(bearer(another.token), auth)).toBeNull();
    expect((await appSession(bearer(finished.token ?? ''), auth))?.userId).toBe('u-recovers');
    // One session.end row per session ended, naming it and the reason, never its token (shyden-labs/ShyTalk#177).
    const ends = await local.DB.prepare("SELECT actor, subject, detail FROM audit WHERE action = 'session.end' AND subject = ? ORDER BY id")
      .bind('user:u-recovers')
      .all<{ actor: string; subject: string; detail: string }>();
    expect(
      ends.results.map(({ detail }) => JSON.parse(detail) as unknown).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual(
      [
        { revoked: older.id, reason: 'recovery' },
        { revoked: another.id, reason: 'recovery' },
      ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
    expect(
      ends.results.every(
        ({ actor, detail }) => actor === 'user:u-recovers' && !detail.includes(older.token) && !detail.includes(another.token),
      ),
    ).toBe(true);
    const left = await local.DB.prepare('SELECT COUNT(*) AS n FROM passkey WHERE "userId" = ?').bind('u-recovers').first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it('writes no session.end row for a recovering member with no session left (shyden-labs/ShyTalk#177)', async () => {
    const at = new Date().toISOString();
    await local.DB.prepare('INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)')
      .bind('u-no-sessions', 'Member', 'no-sessions@example.test', at, at)
      .run();
    const hash = await tokenHash('recovery-no-sessions');
    await local.DB.prepare(
      "INSERT INTO one_time_token (token_hash, purpose, user_id, email, expires_at) VALUES (?, 'recovery', ?, NULL, ?)",
    )
      .bind(hash, 'u-no-sessions', Date.now() + 600_000)
      .run();
    const identity = { kind: 'recovery', userId: 'u-no-sessions', recoveryId: 998, tokenHash: hash } as const;
    const finished = await finishSetup(env, auth, identity, 'totp', Date.now());
    if (finished instanceof Response) throw new Error(`refused ${String(finished.status)}`);
    const ends = await local.DB.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'session.end' AND subject = ?")
      .bind('user:u-no-sessions')
      .first<{ n: number }>();
    expect(ends?.n).toBe(0);
  });

  it('refuses a second finish with the same token', async () => {
    const hash = await tokenHash('sign-up-twice');
    await local.DB.prepare("INSERT INTO one_time_token (token_hash, purpose, user_id, email, expires_at) VALUES (?, 'sign-up', ?, ?, ?)")
      .bind(hash, 'u-twice', 'twice@example.test', Date.now() + 600_000)
      .run();
    const identity = { kind: 'sign-up', userId: 'u-twice', email: 'twice@example.test', tokenHash: hash } as const;
    const answers = await Promise.all([
      finishSetup(env, auth, identity, 'totp', Date.now()),
      finishSetup(env, auth, identity, 'totp', Date.now()),
    ]);
    expect(answers.filter((answer) => answer instanceof Response && answer.status === 401)).toHaveLength(1);
  });
});
