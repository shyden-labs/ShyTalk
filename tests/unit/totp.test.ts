import { describe, expect, it } from 'vitest';
import { createOTP } from '@better-auth/utils/otp';
import { addressHash } from '../../workers/web/src/app/email-code.ts';
import { MAX_WRONG_SIGN_INS } from '../../workers/web/src/app/recovery-codes.ts';
import {
  confirmTotp,
  decryptSecret,
  encryptSecret,
  matchStep,
  setupTotp,
  signInTotp,
  totpGoesLive,
  type TotpEnv,
} from '../../workers/web/src/app/totp.ts';

/**
 * The authenticator app (plan 7 Task 4, shyden-labs/ShyTalk#134 AC2): RFC
 * 6238, 6 digits, 30 s; the secret only as AES-GCM ciphertext under TOTP_KEY;
 * a code's step at or below the last one accepted is refused; tries reserved
 * on the address first, as for recovery codes.
 */

const KEY = 'a-unit-totp-key-long-enough-to-derive-from';
const SECRET = 'a-unit-secret-long-enough-for-better-auth';
const RFC_SECRET = new TextEncoder().encode('12345678901234567890');
const NOW = 1_800_000_000_000;
const STEP = Math.floor(NOW / 30_000);

const codeAt = (secret: Uint8Array, step: number): Promise<string> => createOTP(secret, { digits: 6, period: 30 }).hotp(step);

interface Recorded {
  sql: string;
  values: unknown[];
}

interface Answers {
  reserved?: number;
  userId?: string | null;
  method?: { id: number; secret_enc: string; last_step: number } | null;
  stepTaken?: number;
  /** Whether the member already has a live authenticator. */
  live?: boolean;
  pending?: { secret_enc: string; flow: string; created_at: number } | null;
}

function setting(answers: Answers = {}) {
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
          if (sql.startsWith('SELECT id, secret_enc')) return { meta: { changes: 0 }, results: answers.method ? [answers.method] : [] };
          if (sql.startsWith('UPDATE sign_in_method SET last_step')) return { meta: { changes: answers.stepTaken ?? 1 }, results: [] };
          if (sql.startsWith('SELECT id FROM sign_in_method'))
            return { meta: { changes: 0 }, results: answers.live === true ? [{ id: 4 }] : [] };
          if (sql.startsWith('SELECT secret_enc, flow, created_at FROM totp_pending'))
            return { meta: { changes: 0 }, results: answers.pending ? [answers.pending] : [] };
          return { meta: { changes: 1 }, results: [] };
        }),
      );
    },
  };
  const env = { ENVIRONMENT_NAME: 'dev', BETTER_AUTH_SECRET: SECRET, TOTP_KEY: KEY, DB } as unknown as TotpEnv;
  return { env, batches, all: () => batches.flat() };
}

describe('encryptSecret and decryptSecret', () => {
  it('round-trips a secret, with a fresh nonce each time', async () => {
    const first = await encryptSecret(KEY, RFC_SECRET);
    expect(first).not.toBe(await encryptSecret(KEY, RFC_SECRET));
    expect(await decryptSecret(KEY, first)).toEqual(RFC_SECRET);
  });

  it('answers null under another key or for damaged text', async () => {
    const sealed = await encryptSecret(KEY, RFC_SECRET);
    expect(await decryptSecret(`${KEY}-other`, sealed)).toBeNull();
    expect(await decryptSecret(KEY, `${sealed.slice(0, -4)}AAAA`)).toBeNull();
    expect(await decryptSecret(KEY, 'not base64 at all!')).toBeNull();
  });
});

describe('matchStep', () => {
  it('meets RFC 6238 (step 1 of its SHA-1 secret is 287082)', async () => {
    expect(await matchStep(RFC_SECRET, '287082', 59_000, 0)).toBe(1);
  });

  it.each([-1, 0, 1])('accepts the code of step %i from now', async (offset) => {
    expect(await matchStep(RFC_SECRET, await codeAt(RFC_SECRET, STEP + offset), NOW, 0)).toBe(STEP + offset);
  });

  it.each([-2, 2])('refuses the code of step %i from now', async (offset) => {
    expect(await matchStep(RFC_SECRET, await codeAt(RFC_SECRET, STEP + offset), NOW, 0)).toBeNull();
  });

  it('refuses a step at or below the last one accepted', async () => {
    expect(await matchStep(RFC_SECRET, await codeAt(RFC_SECRET, STEP), NOW, STEP)).toBeNull();
    expect(await matchStep(RFC_SECRET, await codeAt(RFC_SECRET, STEP + 1), NOW, STEP)).toBe(STEP + 1);
  });

  it('refuses what is not six digits', async () => {
    expect(await matchStep(RFC_SECRET, '28708', NOW, 0)).toBeNull();
    expect(await matchStep(RFC_SECRET, 287082, NOW, 0)).toBeNull();
  });
});

describe('setupTotp', () => {
  it('keeps the new secret only as ciphertext in the pending table, and answers the otpauth URI', async () => {
    const { env, all } = setting();
    const uri = (await setupTotp(env, 'u-1', 'm@example.test', NOW, { flow: 'session' }))?.uri ?? '';
    expect(uri).toMatch(/^otpauth:\/\/totp\/ShyTalk:m%40example\.test\?secret=[A-Z2-7]+&issuer=ShyTalk&digits=6&period=30$/);
    const secret = /secret=([A-Z2-7]+)/.exec(uri)?.[1] ?? '';
    const stored = all().find(({ sql }) => sql.startsWith('INSERT INTO totp_pending'));
    expect(stored?.sql).toBe(
      'INSERT INTO totp_pending (user_id, secret_enc, flow, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET secret_enc = excluded.secret_enc, flow = excluded.flow, created_at = excluded.created_at',
    );
    expect(stored?.values[0]).toBe('u-1');
    expect(stored?.values.slice(2)).toEqual(['session', NOW]);
    expect(JSON.stringify(all())).not.toContain(secret);
    expect(all().some(({ sql }) => /^(INSERT|UPDATE|DELETE).*sign_in_method/.test(sql))).toBe(false);
  });

  it('removes every pending authenticator more than a day old, in the same batch as its own', async () => {
    const { env, batches } = setting();
    await setupTotp(env, 'u-1', 'm@example.test', NOW, { flow: 'session' });
    const stored = batches.find((batch) => batch.some(({ sql }) => sql.startsWith('INSERT INTO totp_pending'))) ?? [];
    expect(stored[0]).toEqual({ sql: 'DELETE FROM totp_pending WHERE created_at < ?', values: [NOW - 86_400_000] });
  });

  it('answers null when the member already has a live authenticator', async () => {
    const { env, all } = setting({ live: true });
    expect(await setupTotp(env, 'u-1', 'm@example.test', NOW, { flow: 'session' })).toBeNull();
    expect(all().some(({ sql }) => sql.startsWith('INSERT INTO totp_pending'))).toBe(false);
  });

  it('lets a recovery start a new one beside a live one, leaving the live one untouched until the recovery completes', async () => {
    const { env, all } = setting({ live: true });
    expect(await setupTotp(env, 'u-1', 'm@example.test', NOW, { flow: 'recovery-hash', replaceLive: true })).not.toBeNull();
    expect(all().some(({ sql }) => /^(INSERT|UPDATE|DELETE).*sign_in_method/.test(sql))).toBe(false);
  });
});

describe('confirmTotp', () => {
  const pendingFrom = async (flow: string, createdAt = NOW - 60_000) => ({
    secret_enc: await encryptSecret(KEY, RFC_SECRET),
    flow,
    created_at: createdAt,
  });

  it('answers the sealed secret and the step for a current code from the flow that started it, writing nothing', async () => {
    const pending = await pendingFrom('th');
    const { env, all } = setting({ pending });
    expect(await confirmTotp(env, 'u-1', await codeAt(RFC_SECRET, STEP), NOW, 'th')).toEqual({ secretEnc: pending.secret_enc, step: STEP });
    expect(all().every(({ sql }) => sql.startsWith('SELECT'))).toBe(true);
  });

  it('answers null for a wrong code, no pending authenticator, another flow, or one more than a day old', async () => {
    const code = await codeAt(RFC_SECRET, STEP);
    expect(await confirmTotp(setting({ pending: await pendingFrom('th') }).env, 'u-1', '000000', NOW, 'th')).toBeNull();
    expect(await confirmTotp(setting({ pending: null }).env, 'u-1', code, NOW, 'th')).toBeNull();
    expect(await confirmTotp(setting({ pending: await pendingFrom('th') }).env, 'u-1', code, NOW, 'session')).toBeNull();
    expect(await confirmTotp(setting({ pending: await pendingFrom('th', NOW - 86_400_001) }).env, 'u-1', code, NOW, 'th')).toBeNull();
    expect(await confirmTotp(setting({ pending: await pendingFrom('th', NOW - 86_400_000) }).env, 'u-1', code, NOW, 'th')).not.toBeNull();
  });
});

describe('a secret sealed under another key (TOTP_KEY changed)', () => {
  it('confirms nothing', async () => {
    const pending = { secret_enc: await encryptSecret(`${KEY}-old`, RFC_SECRET), flow: 'th', created_at: NOW - 60_000 };
    expect(await confirmTotp(setting({ pending }).env, 'u-1', await codeAt(RFC_SECRET, STEP), NOW, 'th')).toBeNull();
  });

  it('signs nobody in, counting the try', async () => {
    const method = { id: 4, secret_enc: await encryptSecret(`${KEY}-old`, RFC_SECRET), last_step: 0 };
    const { env, all } = setting({ userId: 'u-1', method });
    expect(await signInTotp(env, 'm@example.test', await codeAt(RFC_SECRET, STEP), NOW)).toBeNull();
    expect(all().some(({ sql }) => sql.startsWith('UPDATE sign_in_lock SET locked_until'))).toBe(true);
  });
});

describe('totpGoesLive', () => {
  it('gives the statements that make the confirmed secret the live one and clear the pending one, for the finish batch', () => {
    const { env } = setting();
    const statements = totpGoesLive(env, 'u-1', { secretEnc: 'sealed', step: STEP }, NOW) as unknown as Recorded[];
    expect(statements).toEqual([
      {
        sql: "INSERT INTO sign_in_method (user_id, kind, secret_enc, last_step, created_at) VALUES (?, 'totp', ?, ?, ?) ON CONFLICT (user_id, kind) DO UPDATE SET secret_enc = excluded.secret_enc, last_step = excluded.last_step, created_at = excluded.created_at",
        values: ['u-1', 'sealed', STEP, NOW],
      },
      { sql: 'DELETE FROM totp_pending WHERE user_id = ?', values: ['u-1'] },
    ]);
  });
});

describe('signInTotp', () => {
  const live = async () => ({ id: 4, secret_enc: await encryptSecret(KEY, RFC_SECRET), last_step: STEP - 5 });

  it('reserves a try on the address, then takes the step only if it is still above the last', async () => {
    const { env, batches, all } = setting({ userId: 'u-1', method: await live() });
    expect(await signInTotp(env, 'm@example.test', await codeAt(RFC_SECRET, STEP), NOW)).toBe('u-1');
    expect(batches[0]?.[1]?.values).toEqual([await addressHash(SECRET, 'm@example.test'), NOW, MAX_WRONG_SIGN_INS]);
    const taken = all().find(({ sql }) => sql.startsWith('UPDATE sign_in_method SET last_step'));
    expect(taken?.sql).toBe('UPDATE sign_in_method SET last_step = ? WHERE id = ? AND last_step < ?');
    expect(taken?.values).toEqual([STEP, 4, STEP]);
  });

  it('refuses when another sign-in took the same step first', async () => {
    const { env } = setting({ userId: 'u-1', method: await live(), stepTaken: 0 });
    expect(await signInTotp(env, 'm@example.test', await codeAt(RFC_SECRET, STEP), NOW)).toBeNull();
  });

  it.each([
    ['no try left', { reserved: 0 }],
    ['no account', { userId: null }],
    ['no authenticator', { userId: 'u-1', method: null }],
  ] as const)('refuses with %s', async (_name, answers) => {
    const { env } = setting({ method: await live(), ...answers });
    expect(await signInTotp(env, 'm@example.test', await codeAt(RFC_SECRET, STEP), NOW)).toBeNull();
  });

  it('locks the address once its tries are used, after a wrong code', async () => {
    const { env, all } = setting({ userId: 'u-1', method: await live() });
    expect(await signInTotp(env, 'm@example.test', '000000', NOW)).toBeNull();
    expect(all().some(({ sql }) => sql.startsWith('UPDATE sign_in_lock SET locked_until'))).toBe(true);
  });
});
