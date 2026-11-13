import { describe, expect, it } from 'vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { AUDIT_IF_CHANGED_SQL } from '../../workers/web/src/audit.ts';
import { createAuth } from '../../workers/web/src/auth/better-auth.ts';
import { finishSetup, prepareSetup } from '../../workers/web/src/app/finish-setup.ts';
import type { SignInEnv } from '../../workers/web/src/app/sign-in.ts';

/**
 * The end of setting up a sign-in method (plan 7 Task 4, shyden-labs/ShyTalk#134
 * AC1-3, AC5, AC7; #133 AC2, AC3): a sign-up becomes a member with a method,
 * recovery codes and a session; a recovery completes, ends every session and
 * starts a fresh one; a signed-in member adding a method gets codes only if
 * they have none. D1 statements are recorded; sessions run on the memory adapter.
 */

const NOW = 1_800_000_000_000;

interface Bound {
  sql: string;
  values: unknown[];
}

function world(options: { codesHeld?: number; failOn?: string; tokenSpent?: number } = {}) {
  const batches: Bound[][] = [];
  const store: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification: [] };
  const env = {
    ENVIRONMENT_NAME: 'dev',
    SITE_ORIGIN: 'https://site.example.test',
    BETTER_AUTH_SECRET: 'a-test-secret-that-is-long-enough-for-better-auth',
    GOOGLE_CLIENT_IDS: 'g',
    APPLE_AUDIENCES: 'a',
    DB: {
      prepare: (sql: string) => ({ bind: (...values: unknown[]): Bound => ({ sql, values }) }),
      batch: (statements: Bound[]) => {
        if (options.failOn !== undefined && statements.some(({ values }) => values[2] === options.failOn))
          return Promise.reject(new Error('D1 is down'));
        batches.push(statements);
        return Promise.resolve(
          statements.map(({ sql }) =>
            sql.startsWith('SELECT COUNT(*) AS n FROM recovery_code')
              ? { meta: { changes: 0 }, results: [{ n: options.codesHeld ?? 0 }] }
              : sql.startsWith('UPDATE one_time_token SET used_at')
                ? { meta: { changes: options.tokenSpent ?? 1 }, results: [] }
                : { meta: { changes: 1 }, results: [] },
          ),
        );
      },
    },
    SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: true }) },
  } as unknown as SignInEnv;
  const auth = createAuth(env, {
    database: memoryAdapter(store),
    googleKeys: () => Promise.reject(new Error('unused')),
    appleKeys: () => Promise.reject(new Error('unused')),
  });
  return { env, auth, store, batches, all: () => batches.flat() };
}

const actions = (statements: Bound[]): unknown[] =>
  statements.filter(({ sql }) => sql.includes('INTO audit')).map(({ values }) => values[2]);

describe('finishSetup: a sign-up', () => {
  it('creates the member, spends the token, adds the method and ten codes, in one batch, then a session', async () => {
    const w = world();
    const answer = await finishSetup(
      w.env,
      w.auth,
      { kind: 'sign-up', userId: 'u-new', email: 'new.person@example.test', tokenHash: 'th' },
      'totp',
      NOW,
    );
    if (answer instanceof Response) throw new Error(`refused ${String(answer.status)}`);
    const [guard, made] = w.batches;
    expect(guard).toEqual([{ sql: 'UPDATE one_time_token SET used_at = ? WHERE token_hash = ? AND used_at IS NULL', values: [NOW, 'th'] }]);
    const created = made?.find(({ sql }) => sql.startsWith('INSERT INTO "user"'));
    // No name until the member chooses one: the address's local part often holds a real name.
    expect(created?.values).toEqual(['u-new', '', 'new.person@example.test', new Date(NOW).toISOString(), new Date(NOW).toISOString()]);
    expect(actions(made ?? [])).toEqual(['user.create', 'method.add', 'recovery_codes.new']);
    expect(answer.recoveryCodes).toHaveLength(10);
    expect(answer.userId).toBe('u-new');
    expect(typeof answer.token).toBe('string');
    expect(w.store['session']).toHaveLength(1);
  });
});

describe('finishSetup: a recovery', () => {
  it('completes it, ends every session of the member, spends the token, and starts a fresh session', async () => {
    const w = world();
    w.store['session']?.push({
      id: 's-old',
      token: 't-old',
      userId: 'u-1',
      expiresAt: new Date(NOW + 1e9),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const answer = await finishSetup(w.env, w.auth, { kind: 'recovery', userId: 'u-1', recoveryId: 3, tokenHash: 'th' }, 'passkey', NOW);
    if (answer instanceof Response) throw new Error(`refused ${String(answer.status)}`);
    const [guard, made = []] = w.batches;
    expect(guard?.map(({ sql }) => sql)).toEqual(['UPDATE one_time_token SET used_at = ? WHERE token_hash = ? AND used_at IS NULL']);
    const completed = made.findIndex(({ sql }) => sql.startsWith("UPDATE account_recovery SET state = 'completed'"));
    expect(made[completed]?.values).toEqual([NOW, 3]);
    expect(made[completed + 1]?.sql).toBe(AUDIT_IF_CHANGED_SQL);
    expect(made[completed + 1]?.values.slice(1, 4)).toEqual(['user:u-1', 'recovery.complete', 'user:u-1']);
    expect(made.find(({ sql }) => sql === 'DELETE FROM session WHERE "userId" = ?')?.values).toEqual(['u-1']);
    expect(actions(made)).toContain('method.add');
    expect(actions(made)).toContain('recovery_codes.new');
    expect(answer.recoveryCodes).toHaveLength(10);
    expect(typeof answer.token).toBe('string');
  });
});

describe('finishSetup: the token is spent first', () => {
  it.each([
    ['a sign-up', { kind: 'sign-up', userId: 'u-new', email: 'n@example.test', tokenHash: 'th' }],
    ['a recovery (cancelled meanwhile: a cancel spends its tokens)', { kind: 'recovery', userId: 'u-1', recoveryId: 3, tokenHash: 'th' }],
  ] as const)('refuses %s with 401 and writes nothing more when the token was already spent', async (_name, identity) => {
    const w = world({ tokenSpent: 0 });
    const answer = await finishSetup(w.env, w.auth, identity, 'totp', NOW);
    expect(answer instanceof Response && answer.status).toBe(401);
    expect(w.batches).toHaveLength(1);
    expect(w.store['session']).toHaveLength(0);
  });
});

describe('finishSetup: a recovery audits each session it ends (shyden-labs/ShyTalk#177)', () => {
  it('writes one session.end row per session of the member, naming the session and never its token, just before the delete', async () => {
    const w = world();
    await finishSetup(w.env, w.auth, { kind: 'recovery', userId: 'u-1', recoveryId: 3, tokenHash: 'th' }, 'passkey', NOW);
    const made = w.batches[1] ?? [];
    const ended = made.findIndex(({ sql }) => sql === 'DELETE FROM session WHERE "userId" = ?');
    expect(made[ended - 1]?.sql).toBe(
      'INSERT INTO audit (at, actor, action, subject, detail, environment) ' +
        "SELECT ?, ?, 'session.end', ?, json_object('revoked', id, 'reason', 'recovery'), ? FROM session WHERE \"userId\" = ?",
    );
    expect(made[ended - 1]?.values).toEqual([expect.any(Number), 'user:u-1', 'user:u-1', 'dev', 'u-1']);
  });

  it('writes no session.end row for a sign-up or a signed-in member adding a method', async () => {
    for (const identity of [
      { kind: 'sign-up', userId: 'u-new', email: 'n@example.test', tokenHash: 'th' },
      { kind: 'session', userId: 'u-1' },
    ] as const) {
      const w = world({ codesHeld: 1 });
      await finishSetup(w.env, w.auth, identity, 'totp', NOW);
      expect(w.all().filter(({ sql }) => sql.includes("'session.end'"))).toEqual([]);
    }
  });
});

describe('finishSetup: a recovery removes the old methods', () => {
  it('removes old passkeys and the old authenticator when a passkey is set up, auditing each kind removed', async () => {
    const w = world();
    await finishSetup(w.env, w.auth, { kind: 'recovery', userId: 'u-1', recoveryId: 3, tokenHash: 'th' }, 'passkey', NOW);
    const made = w.batches[1] ?? [];
    const passkeys = made.findIndex(({ sql }) => sql === 'DELETE FROM passkey WHERE "userId" = ?');
    const totp = made.findIndex(({ sql }) => sql === "DELETE FROM sign_in_method WHERE user_id = ? AND kind = 'totp'");
    expect(made[passkeys]?.values).toEqual(['u-1']);
    expect(made[passkeys + 1]?.sql).toBe(AUDIT_IF_CHANGED_SQL);
    expect(made[passkeys + 1]?.values.slice(1, 5)).toEqual([
      'user:u-1',
      'method.remove',
      'user:u-1',
      JSON.stringify({ kind: 'passkey', reason: 'recovery' }),
    ]);
    expect(made[totp]?.values).toEqual(['u-1']);
    expect(made[totp + 1]?.sql).toBe(AUDIT_IF_CHANGED_SQL);
    expect(made[totp + 1]?.values.slice(1, 5)).toEqual([
      'user:u-1',
      'method.remove',
      'user:u-1',
      JSON.stringify({ kind: 'totp', reason: 'recovery' }),
    ]);
  });

  it('keeps the authenticator being set up, removing only the old passkeys', async () => {
    const w = world();
    await finishSetup(w.env, w.auth, { kind: 'recovery', userId: 'u-1', recoveryId: 3, tokenHash: 'th' }, 'totp', NOW);
    const sqls = (w.batches[1] ?? []).map(({ sql }) => sql);
    expect(sqls).toContain('DELETE FROM passkey WHERE "userId" = ?');
    expect(sqls.some((sql) => sql.startsWith('DELETE FROM sign_in_method'))).toBe(false);
  });

  it('removes nothing when a signed-in member adds a method', async () => {
    const w = world({ codesHeld: 4 });
    await finishSetup(w.env, w.auth, { kind: 'session', userId: 'u-1' }, 'passkey', NOW);
    expect(w.all().some(({ sql }) => sql.startsWith('DELETE FROM passkey') || sql.startsWith('DELETE FROM sign_in_method'))).toBe(false);
  });
});

describe('finishSetup: a signed-in member', () => {
  it('adds the method without a new session, and issues codes when the member holds none', async () => {
    const w = world({ codesHeld: 0 });
    const answer = await finishSetup(w.env, w.auth, { kind: 'session', userId: 'u-1' }, 'totp', NOW);
    if (answer instanceof Response) throw new Error('refused');
    expect(answer.token).toBeUndefined();
    expect(answer.recoveryCodes).toHaveLength(10);
    expect(w.store['session']).toHaveLength(0);
  });

  it('keeps the codes a member already holds', async () => {
    const w = world({ codesHeld: 4 });
    const answer = await finishSetup(w.env, w.auth, { kind: 'session', userId: 'u-1' }, 'totp', NOW);
    if (answer instanceof Response) throw new Error('refused');
    expect(answer.recoveryCodes).toBeUndefined();
    expect(actions(w.all())).toEqual(['method.add']);
  });

  it('audits the method by kind, never a secret', async () => {
    const w = world({ codesHeld: 4 });
    await finishSetup(w.env, w.auth, { kind: 'session', userId: 'u-1' }, 'passkey', NOW);
    const added = w.all().find(({ values }) => values[2] === 'method.add');
    expect(added?.values.slice(1, 5)).toEqual(['user:u-1', 'method.add', 'user:u-1', JSON.stringify({ kind: 'passkey' })]);
  });
});

describe('finishSetup: failures', () => {
  it("answers the session's 500 when its audit rows cannot be written, with the member already made", async () => {
    const w = world({ failOn: 'session.start' });
    const answer = await finishSetup(
      w.env,
      w.auth,
      { kind: 'sign-up', userId: 'u-new', email: 'n@example.test', tokenHash: 'th' },
      'totp',
      NOW,
    );
    expect(answer instanceof Response && answer.status).toBe(500);
    expect(w.store['session']).toHaveLength(0);
  });

  it('answers 500 and starts no session when the setup batch fails', async () => {
    const w = world({ failOn: 'user.create' });
    const answer = await finishSetup(
      w.env,
      w.auth,
      { kind: 'sign-up', userId: 'u-new', email: 'n@example.test', tokenHash: 'th' },
      'totp',
      NOW,
    );
    expect(answer instanceof Response && answer.status).toBe(500);
    expect(w.store['session']).toHaveLength(0);
  });
});

describe('prepareSetup: everything but the session, for the passkey path', () => {
  it('makes the member and their codes, and starts no session', async () => {
    const w = world();
    const prepared = await prepareSetup(
      w.env,
      { kind: 'sign-up', userId: 'u-new', email: 'n@example.test', tokenHash: 'th' },
      'passkey',
      NOW,
    );
    if (prepared instanceof Response) throw new Error('refused');
    expect(Object.keys(prepared).sort()).toEqual(['recoveryCodes', 'userId']);
    expect(prepared.userId).toBe('u-new');
    expect(prepared.recoveryCodes).toHaveLength(10);
    expect(w.all().some(({ sql }) => sql.startsWith('INSERT INTO "user"'))).toBe(true);
    expect(w.store['session']).toHaveLength(0);
  });

  it('refuses a spent token with 401, as finishSetup does', async () => {
    const w = world({ tokenSpent: 0 });
    const prepared = await prepareSetup(
      w.env,
      { kind: 'sign-up', userId: 'u-new', email: 'n@example.test', tokenHash: 'th' },
      'passkey',
      NOW,
    );
    expect(prepared instanceof Response && prepared.status).toBe(401);
  });
});

describe('finishSetup: the statements of the method itself', () => {
  it('writes them in the main batch, after the token is spent, and not at all when it was spent already', async () => {
    const live = { sql: 'MAKE THE METHOD LIVE', values: [] };
    const w = world();
    await finishSetup(w.env, w.auth, { kind: 'sign-up', userId: 'u-new', email: 'n@example.test', tokenHash: 'th' }, 'totp', NOW, [live]);
    expect(w.batches[0]).not.toContainEqual(live);
    expect(w.batches[1]).toContainEqual(live);
    const refused = world({ tokenSpent: 0 });
    await finishSetup(
      refused.env,
      refused.auth,
      { kind: 'sign-up', userId: 'u-new', email: 'n@example.test', tokenHash: 'th' },
      'totp',
      NOW,
      [live],
    );
    expect(refused.all()).not.toContainEqual(live);
  });
});
