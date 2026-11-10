import { describe, expect, it } from 'vitest';
import type { MailMessage } from '../../packages/mail/index.ts';
import {
  addressHash,
  codeHash,
  MAX_WRONG_TRIES,
  RECOVERY_LAPSE_MS,
  RECOVERY_WAIT_MS,
  SIGN_UP_TTL_MS,
  tokenHash,
} from '../../workers/web/src/app/email-code.ts';
import { handleEmailVerify, type EmailDeps, type EmailEnv } from '../../workers/web/src/app/email-routes.ts';

/**
 * `POST /api/app/email/verify` (plan 6 Task 3, shyden-labs/ShyTalk#133). D1,
 * the sender, the clock and the tokens are stood in; the SQL on a real D1 is
 * tests/integration/email-code.test.ts.
 */

const ORIGIN = 'https://site.example.test';
const SECRET = 'a-unit-secret-long-enough-for-better-auth';
const NOW = 1_800_000_000_000;
const EMAIL = 'member@example.test';
const CODE = '402913';

interface Recorded {
  sql: string;
  values: unknown[];
}

interface Rows {
  code?: { id: number; code_hash: string; expires_at: number; wrong_tries: number } | null;
  userId?: string | null;
  pending?: { id: number; started_at: number; completes_at: number } | null;
  /** Rows the code's DELETE changes: 0 when another verify spent it first. */
  codeDeleted?: number;
  /** Rows the try reservation changes: 0 when no try is left. */
  reserved?: number;
}

async function liveCode(wrongTries = 0, expiresAt = NOW + 60_000) {
  const hash = await addressHash(SECRET, EMAIL);
  return { id: 7, code_hash: await codeHash(SECRET, hash, CODE), expires_at: expiresAt, wrong_tries: wrongTries };
}

function setting(rows: Rows) {
  const batches: Recorded[][] = [];
  const mails: MailMessage[] = [];
  const answer = ({ sql }: Recorded) => {
    if (sql.startsWith('SELECT id, code_hash')) return { meta: { changes: 0 }, results: rows.code ? [rows.code] : [] };
    if (sql.startsWith('SELECT id FROM "user"')) return { meta: { changes: 0 }, results: rows.userId ? [{ id: rows.userId }] : [] };
    if (sql.startsWith('SELECT id, started_at')) return { meta: { changes: 0 }, results: rows.pending ? [rows.pending] : [] };
    if (sql.startsWith('DELETE FROM email_code WHERE id = ? AND code_hash'))
      return { meta: { changes: rows.codeDeleted ?? 1 }, results: [] };
    if (sql.startsWith('UPDATE email_code SET wrong_tries')) return { meta: { changes: rows.reserved ?? 1 }, results: [] };
    return { meta: { changes: 1 }, results: [] };
  };
  const DB = {
    prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) }),
    batch: (statements: unknown[]) => {
      batches.push(statements as Recorded[]);
      return Promise.resolve((statements as Recorded[]).map(answer));
    },
  };
  const env = {
    ENVIRONMENT_NAME: 'dev',
    SITE_ORIGIN: ORIGIN,
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_CLIENT_IDS: 'g',
    APPLE_AUDIENCES: 'a',
    DB,
    SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: true }) },
  } as unknown as EmailEnv;
  const tokens = ['token-one', 'token-two'];
  const deps: EmailDeps = {
    now: () => NOW,
    send: (message) => {
      mails.push(message);
      return Promise.resolve({ ok: true, messageId: 'm-1' });
    },
    token: () => tokens.shift() ?? 'token-more',
    pause: () => Promise.resolve(),
    code: () => '000000',
  };
  return { env, deps, batches, mails, all: () => batches.flat() };
}

const verify = (body: unknown, method = 'POST'): Request =>
  new Request(`${ORIGIN}/api/app/email/verify`, {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });

const answerOf = async (response: Response) => ({ status: response.status, body: await response.json() });
const REFUSED = { status: 401, body: { error: 'code_refused' } };

describe('POST /api/app/email/verify: refusals', () => {
  it('answers 429 when the IP is over its limit, before looking at the code', async () => {
    const { env, deps, batches } = setting({ code: await liveCode() });
    const limited = { ...env, SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: false }) } } as EmailEnv;
    expect(await answerOf(await handleEmailVerify(verify({ email: EMAIL, purpose: 'sign-up', code: CODE }), limited, deps))).toEqual({
      status: 429,
      body: { error: 'slow_down' },
    });
    expect(batches).toHaveLength(0);
  });

  it('answers 405 to anything but POST', async () => {
    const { env, deps } = setting({});
    expect((await handleEmailVerify(verify(undefined, 'GET'), env, deps)).status).toBe(405);
  });

  it.each([
    ['not JSON', 'nope'],
    ['an array', []],
    ['a five-digit code', { email: EMAIL, purpose: 'sign-up', code: '12345' }],
    ['a code with letters', { email: EMAIL, purpose: 'sign-up', code: '12a456' }],
    ['a seven-digit code', { email: EMAIL, purpose: 'sign-up', code: '1234567' }],
    ['six digits inside other text', { email: EMAIL, purpose: 'sign-up', code: 'x123456' }],
    ['a number for a code', { email: EMAIL, purpose: 'sign-up', code: 402913 }],
    ['a bad purpose', { email: EMAIL, purpose: 'other', code: CODE }],
  ])('answers 400 to %s', async (_name, body) => {
    const { env, deps, batches } = setting({});
    expect(await answerOf(await handleEmailVerify(verify(body), env, deps))).toEqual({ status: 400, body: { error: 'bad_request' } });
    expect(batches).toHaveLength(0);
  });

  it('answers 401 when no code is live', async () => {
    const { env, deps } = setting({ code: null });
    expect(await answerOf(await handleEmailVerify(verify({ email: EMAIL, purpose: 'sign-up', code: CODE }), env, deps))).toEqual(REFUSED);
  });

  it('answers the same 401 to a code past its life, and deletes it', async () => {
    const { env, deps, all } = setting({ code: await liveCode(0, NOW - 1) });
    expect(await answerOf(await handleEmailVerify(verify({ email: EMAIL, purpose: 'sign-up', code: CODE }), env, deps))).toEqual(REFUSED);
    expect(all().some(({ sql, values }) => sql === 'DELETE FROM email_code WHERE id = ?' && values[0] === 7)).toBe(true);
    expect(all().some(({ sql }) => sql.startsWith('INSERT INTO one_time_token'))).toBe(false);
  });

  it('counts a wrong code and answers 401, spending the code on the fifth wrong try', async () => {
    const { env, deps, all } = setting({ code: await liveCode(MAX_WRONG_TRIES - 1) });
    expect(await answerOf(await handleEmailVerify(verify({ email: EMAIL, purpose: 'sign-up', code: '000000' }), env, deps))).toEqual(
      REFUSED,
    );
    const counted = all().find(({ sql }) => sql.startsWith('UPDATE email_code SET wrong_tries'));
    expect(counted?.values).toEqual([7, MAX_WRONG_TRIES, NOW]);
    const spent = all().find(({ sql }) => sql.startsWith('DELETE FROM email_code WHERE id = ? AND wrong_tries >= ?'));
    expect(spent?.values).toEqual([7, MAX_WRONG_TRIES]);
  });

  it('reserves a try before comparing: with none left, even the right code answers 401 and is not spent', async () => {
    const { env, deps, all } = setting({ code: await liveCode(), reserved: 0 });
    expect(await answerOf(await handleEmailVerify(verify({ email: EMAIL, purpose: 'sign-up', code: CODE }), env, deps))).toEqual(REFUSED);
    const order = all().map(({ sql }) => sql);
    expect(order.some((sql) => sql.startsWith('DELETE FROM email_code WHERE id = ? AND code_hash'))).toBe(false);
    expect(order.some((sql) => sql.startsWith('INSERT INTO one_time_token'))).toBe(false);
  });

  it('reserves a try for the right code too, before spending it', async () => {
    const { env, deps, all } = setting({ code: await liveCode() });
    await handleEmailVerify(verify({ email: EMAIL, purpose: 'sign-up', code: CODE }), env, deps);
    const order = all().map(({ sql }) => sql.split(' ').slice(0, 3).join(' '));
    expect(order.indexOf('UPDATE email_code SET')).toBeGreaterThan(-1);
    expect(order.indexOf('UPDATE email_code SET')).toBeLessThan(order.indexOf('DELETE FROM email_code'));
  });

  it('answers 401 when another verify spent the code first', async () => {
    const { env, deps, all } = setting({ code: await liveCode(), codeDeleted: 0 });
    expect(await answerOf(await handleEmailVerify(verify({ email: EMAIL, purpose: 'sign-up', code: CODE }), env, deps))).toEqual(REFUSED);
    expect(all().some(({ sql }) => sql.startsWith('INSERT INTO one_time_token'))).toBe(false);
  });
});

describe('POST /api/app/email/verify: sign-up', () => {
  it('answers a 30-minute sign-up token holding the confirmed address, making no user and no session', async () => {
    const { env, deps, all } = setting({ code: await liveCode() });
    const answer = await answerOf(
      await handleEmailVerify(verify({ email: ' Member@Example.test', purpose: 'sign-up', code: CODE }), env, deps),
    );
    expect(answer).toEqual({ status: 200, body: { signUpToken: 'token-one' } });
    const stored = all().find(({ sql }) => sql.startsWith('INSERT INTO one_time_token'));
    expect(stored?.values).toEqual([await tokenHash('token-one'), 'sign-up', null, EMAIL, NOW + SIGN_UP_TTL_MS]);
    expect(all().some(({ sql }) => /"user"|session/.test(sql) && !sql.startsWith('SELECT'))).toBe(false);
  });

  it('looks the code up by the address hash and purpose, and spends it by id and hash', async () => {
    const live = await liveCode();
    const { env, deps, all } = setting({ code: live });
    await handleEmailVerify(verify({ email: EMAIL, purpose: 'sign-up', code: CODE }), env, deps);
    expect(all().find(({ sql }) => sql.startsWith('SELECT id, code_hash'))?.values).toEqual([await addressHash(SECRET, EMAIL), 'sign-up']);
    expect(all().find(({ sql }) => sql.startsWith('DELETE FROM email_code WHERE id = ? AND code_hash'))?.values).toEqual([
      7,
      live.code_hash,
    ]);
    expect(all().find(({ sql }) => sql === 'DELETE FROM one_time_token WHERE expires_at < ?')?.values).toEqual([NOW]);
  });
});

describe('POST /api/app/email/verify: recovery', () => {
  it('starts a recovery: one pending row, its audit row in the same batch, a token, and the notice with a cancel link', async () => {
    const { env, deps, batches, mails } = setting({ code: await liveCode(), userId: 'u-1', pending: null });
    const answer = await answerOf(await handleEmailVerify(verify({ email: EMAIL, purpose: 'recovery', code: CODE }), env, deps));
    const completesAt = NOW + RECOVERY_WAIT_MS;
    expect(answer).toEqual({ status: 200, body: { recoveryToken: 'token-two', completesAt: new Date(completesAt).toISOString() } });
    const started = batches.find((batch) => batch.some(({ sql }) => sql.startsWith('INSERT INTO account_recovery'))) ?? [];
    expect(started.find(({ sql }) => sql.startsWith('INSERT INTO account_recovery'))?.values).toEqual([
      'u-1',
      NOW,
      completesAt,
      await tokenHash('token-one'),
    ]);
    const audited = started.find(({ sql }) => sql.startsWith('INSERT INTO audit'));
    expect(audited?.values.slice(1, 4)).toEqual(['public', 'recovery.start', 'user:u-1']);
    expect(JSON.stringify(audited?.values)).not.toContain('token');
    expect(started.find(({ sql }) => sql.startsWith('INSERT INTO one_time_token'))?.values).toEqual([
      await tokenHash('token-two'),
      'recovery',
      'u-1',
      null,
      completesAt + RECOVERY_LAPSE_MS,
    ]);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe(EMAIL);
    expect(mails[0]?.text).toContain(`${ORIGIN}/recover/cancel/#token-one`);
  });

  it('answers the same 401 when the address has no account', async () => {
    const { env, deps, mails } = setting({ code: await liveCode(), userId: null });
    expect(await answerOf(await handleEmailVerify(verify({ email: EMAIL, purpose: 'recovery', code: CODE }), env, deps))).toEqual(REFUSED);
    expect(mails).toHaveLength(0);
  });

  it('answers a new token for a pending recovery, spending the old ones, keeping its clock and sending nothing', async () => {
    const pending = { id: 3, started_at: NOW - 3_600_000, completes_at: NOW - 3_600_000 + RECOVERY_WAIT_MS };
    const { env, deps, all, mails } = setting({ code: await liveCode(), userId: 'u-1', pending });
    const answer = await answerOf(await handleEmailVerify(verify({ email: EMAIL, purpose: 'recovery', code: CODE }), env, deps));
    expect(answer).toEqual({
      status: 200,
      body: { recoveryToken: 'token-one', completesAt: new Date(pending.completes_at).toISOString() },
    });
    expect(all().find(({ sql }) => sql.startsWith('UPDATE one_time_token SET used_at'))?.values).toEqual([NOW, 'u-1']);
    expect(all().some(({ sql }) => sql.startsWith('INSERT INTO account_recovery'))).toBe(false);
    expect(mails).toHaveLength(0);
  });

  it('lapses a recovery left 24 hours past completing, and starts a new one', async () => {
    const pending = { id: 3, started_at: NOW - RECOVERY_WAIT_MS - RECOVERY_LAPSE_MS - 1, completes_at: NOW - RECOVERY_LAPSE_MS - 1 };
    const { env, deps, all, mails } = setting({ code: await liveCode(), userId: 'u-1', pending });
    await handleEmailVerify(verify({ email: EMAIL, purpose: 'recovery', code: CODE }), env, deps);
    const lapsed = all().find(({ sql }) => sql.startsWith("UPDATE account_recovery SET state = 'cancelled'"));
    expect(lapsed?.values).toEqual([NOW, 3]);
    expect(all().some(({ sql, values }) => sql.startsWith('INSERT INTO audit') && values[2] === 'recovery.lapse')).toBe(true);
    expect(all().some(({ sql }) => sql.startsWith('INSERT INTO account_recovery'))).toBe(true);
    expect(mails).toHaveLength(1);
  });

  it('keeps a recovery exactly 24 hours past completing', async () => {
    const pending = { id: 3, started_at: NOW - RECOVERY_WAIT_MS - RECOVERY_LAPSE_MS, completes_at: NOW - RECOVERY_LAPSE_MS };
    const { env, deps, all } = setting({ code: await liveCode(), userId: 'u-1', pending });
    await handleEmailVerify(verify({ email: EMAIL, purpose: 'recovery', code: CODE }), env, deps);
    expect(all().some(({ sql }) => sql.startsWith("UPDATE account_recovery SET state = 'cancelled'"))).toBe(false);
  });
});
