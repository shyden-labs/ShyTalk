import { describe, expect, it } from 'vitest';
import { addressHash } from '../../workers/web/src/app/email-code.ts';
import {
  LOCK_MS,
  MAX_LOCK_DOUBLINGS,
  MAX_WRONG_SIGN_INS,
  newRecoveryCodes,
  normaliseRecoveryCode,
  recoveryCodeHash,
  replaceRecoveryCodes,
  useRecoveryCode,
  type CodeSignInEnv,
} from '../../workers/web/src/app/recovery-codes.ts';

/**
 * Recovery codes (plan 7 Task 3, shyden-labs/ShyTalk#134 AC3): ten one-time
 * codes, 80 random bits each in Crockford base32, kept only as SHA-256; a new
 * set replaces the old; using one reserves a try on the address first.
 */

const SECRET = 'a-unit-secret-long-enough-for-better-auth';
const NOW = 1_800_000_000_000;
const SHAPE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

interface Recorded {
  sql: string;
  values: unknown[];
}

function setting(answers: { reserved?: number; userId?: string | null; spent?: number; left?: number } = {}) {
  const batches: Recorded[][] = [];
  const DB = {
    prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) }),
    batch: (statements: unknown[]) => {
      batches.push(statements as Recorded[]);
      return Promise.resolve(
        (statements as Recorded[]).map(({ sql }) => {
          if (sql.startsWith('UPDATE sign_in_lock SET wrong_tries = wrong_tries + 1'))
            return { meta: { changes: answers.reserved ?? 1 }, results: [] };
          if (sql.startsWith('SELECT id FROM "user"'))
            return { meta: { changes: 0 }, results: answers.userId ? [{ id: answers.userId }] : [] };
          if (sql.startsWith('UPDATE recovery_code SET used_at')) return { meta: { changes: answers.spent ?? 1 }, results: [] };
          if (sql.startsWith('SELECT COUNT(*) AS n FROM recovery_code'))
            return { meta: { changes: 0 }, results: [{ n: answers.left ?? 9 }] };
          return { meta: { changes: 1 }, results: [] };
        }),
      );
    },
  };
  const env = { ENVIRONMENT_NAME: 'dev', BETTER_AUTH_SECRET: SECRET, DB } as unknown as CodeSignInEnv;
  return { env, batches, all: () => batches.flat() };
}

describe('newRecoveryCodes', () => {
  it('makes ten distinct codes of four groups of four Crockford characters', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(SHAPE);
  });

  it('turns 80 bits into 16 characters: all-zero bytes are all zeros, all-one bytes all Zs', () => {
    expect(newRecoveryCodes(() => new Uint8Array(10))[0]).toBe('0000-0000-0000-0000');
    expect(newRecoveryCodes(() => new Uint8Array(10).fill(255))[0]).toBe('ZZZZ-ZZZZ-ZZZZ-ZZZZ');
  });
});

describe('normaliseRecoveryCode', () => {
  it('ignores dashes, spaces and case, and reads I and L as 1 and O as 0', () => {
    expect(normaliseRecoveryCode(' abcd-efgh-jkmn-pqrs ')).toBe('ABCDEFGHJKMNPQRS');
    expect(normaliseRecoveryCode('ILO0-0000-0000-0000')).toBe('1100000000000000');
  });

  it.each([
    ['too short', 'ABCD-EFGH'],
    ['a U', 'UUUU-0000-0000-0000'],
    ['not text', 42],
  ])('refuses %s', (_name, input) => {
    expect(normaliseRecoveryCode(input)).toBeNull();
  });
});

describe('replaceRecoveryCodes', () => {
  it("deletes the member's old set, stores ten hashes of one new set, and audits it, as statements for one batch", async () => {
    const { env } = setting();
    const { statements, codes } = await replaceRecoveryCodes(env, 'u-1', 'user:u-1');
    const recorded = statements as unknown as Recorded[];
    expect(recorded[0]).toEqual({ sql: 'DELETE FROM recovery_code WHERE user_id = ?', values: ['u-1'] });
    const inserts = recorded.filter(({ sql }) => sql.startsWith('INSERT INTO recovery_code'));
    expect(inserts).toHaveLength(10);
    const sets = new Set(inserts.map(({ values }) => values[1]));
    expect(sets.size).toBe(1);
    expect(inserts.map(({ values }) => values[2])).toEqual(
      await Promise.all(codes.map((code) => recoveryCodeHash(code.replaceAll('-', '')))),
    );
    const audited = recorded.at(-1);
    expect(audited?.values.slice(1, 5)).toEqual(['user:u-1', 'recovery_codes.new', 'user:u-1', JSON.stringify({ codes: 10 })]);
    for (const code of codes) expect(JSON.stringify(recorded)).not.toContain(code.replaceAll('-', ''));
  });
});

describe('useRecoveryCode', () => {
  it('reserves a try on the address before looking at the code', async () => {
    const { env, batches } = setting({ userId: 'u-1' });
    await useRecoveryCode(env, 'Member@Example.test', 'ABCD-EFGH-JKMN-PQRS', NOW);
    const first = batches[0] ?? [];
    const hash = await addressHash(SECRET, 'member@example.test');
    expect(first[0]).toEqual({
      sql: "INSERT OR IGNORE INTO sign_in_lock (address_hash, kind) VALUES (?, 'recovery-code')",
      values: [hash],
    });
    expect(first[1]?.values).toEqual([hash, NOW, MAX_WRONG_SIGN_INS]);
  });

  it('spends a matching unused code and answers the member and the codes left', async () => {
    const { env, all } = setting({ userId: 'u-1', left: 7 });
    expect(await useRecoveryCode(env, 'member@example.test', 'abcd efgh jkmn pqrs', NOW)).toEqual({ userId: 'u-1', left: 7 });
    expect(all().find(({ sql }) => sql.startsWith('UPDATE recovery_code SET used_at'))?.values).toEqual([
      NOW,
      'u-1',
      await recoveryCodeHash('ABCDEFGHJKMNPQRS'),
    ]);
    expect(all().some(({ sql }) => sql.startsWith('UPDATE sign_in_lock SET wrong_tries = 0'))).toBe(true);
  });

  it('refuses a code that matched nothing, and locks the address once its tries are used', async () => {
    const { env, all } = setting({ userId: 'u-1', spent: 0 });
    expect(await useRecoveryCode(env, 'member@example.test', 'ABCD-EFGH-JKMN-PQRS', NOW)).toBeNull();
    const lock = all().find(({ sql }) => sql.startsWith('UPDATE sign_in_lock SET locked_until'));
    // Each spent window doubles the next lock, up to 64 windows (16 hours): guessing stays slow over months.
    expect(lock?.sql).toBe(
      "UPDATE sign_in_lock SET locked_until = ? + ? * (1 << MIN(locks, ?)), locks = locks + 1, wrong_tries = 0 WHERE address_hash = ? AND kind = 'recovery-code' AND wrong_tries >= ?",
    );
    expect(lock?.values).toEqual([NOW, LOCK_MS, MAX_LOCK_DOUBLINGS, await addressHash(SECRET, 'member@example.test'), MAX_WRONG_SIGN_INS]);
  });

  it('starts the lock doubling again after a right code', async () => {
    const { env, all } = setting({ userId: 'u-1', left: 7 });
    await useRecoveryCode(env, 'member@example.test', 'ABCD-EFGH-JKMN-PQRS', NOW);
    expect(all().find(({ sql }) => sql.startsWith('UPDATE sign_in_lock SET wrong_tries = 0'))?.sql).toBe(
      "UPDATE sign_in_lock SET wrong_tries = 0, locks = 0 WHERE address_hash = ? AND kind = 'recovery-code'",
    );
  });

  it('refuses without looking further when no try is left', async () => {
    const { env, all } = setting({ userId: 'u-1', reserved: 0 });
    expect(await useRecoveryCode(env, 'member@example.test', 'ABCD-EFGH-JKMN-PQRS', NOW)).toBeNull();
    expect(all().some(({ sql }) => sql.startsWith('UPDATE recovery_code'))).toBe(false);
  });

  it('refuses an address with no account the same way, after the same reservation', async () => {
    const { env, all } = setting({ userId: null });
    expect(await useRecoveryCode(env, 'nobody@example.test', 'ABCD-EFGH-JKMN-PQRS', NOW)).toBeNull();
    expect(all().some(({ sql }) => sql.startsWith('UPDATE sign_in_lock SET wrong_tries = wrong_tries + 1'))).toBe(true);
  });

  it('refuses a badly formed code as a wrong try', async () => {
    const { env, all } = setting({ userId: 'u-1' });
    expect(await useRecoveryCode(env, 'member@example.test', 'nope', NOW)).toBeNull();
    expect(all().some(({ sql }) => sql.startsWith('UPDATE sign_in_lock SET wrong_tries = wrong_tries + 1'))).toBe(true);
    expect(all().some(({ sql }) => sql.startsWith('UPDATE recovery_code'))).toBe(false);
  });
});
