import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../apps/web/src/i18n/t.ts';
import type { MailMessage, MailResult } from '../../packages/mail/index.ts';
import { addressHash, CODE_TTL_MS, LIMIT_15_MIN, LIMIT_24_H } from '../../workers/web/src/app/email-code.ts';
import { pause } from '../../workers/web/src/api/closed-testing.ts';
import {
  START_ANSWER_FLOOR_MS,
  emailDeps,
  handleEmailStart,
  type EmailDeps,
  type EmailEnv,
} from '../../workers/web/src/app/email-routes.ts';

/**
 * `POST /api/app/email/start` (plan 6 Task 2, shyden-labs/ShyTalk#133). D1,
 * the sender, the clock, the pause and the code are stood in; what the SQL
 * does on a real D1 is tests/integration/email-code.test.ts.
 */

const ORIGIN = 'https://site.example.test';
const SECRET = 'a-unit-secret-long-enough-for-better-auth';
const NOW = 1_800_000_000_000;
const CODE = '402913';

interface Recorded {
  sql: string;
  values: unknown[];
}

interface Answers {
  /** Rows the conditional send insert changes: 0 means the address is over its limit. */
  sendInserted?: number;
  /** The user id the account lookup finds, or none. */
  userId?: string;
}

function setting(answers: Answers = {}, sent: MailResult = { ok: true, messageId: 'm-1' }, limited = false) {
  const batches: Recorded[][] = [];
  const mails: MailMessage[] = [];
  const pauses: number[] = [];
  const DB = {
    prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) }),
    batch: (statements: unknown[]) => {
      batches.push(statements as Recorded[]);
      return Promise.resolve(
        (statements as Recorded[]).map(({ sql }) => {
          if (sql.startsWith('INSERT INTO email_send')) return { meta: { changes: answers.sendInserted ?? 1 }, results: [] };
          if (sql.startsWith('SELECT id FROM "user"'))
            return { meta: { changes: 0 }, results: answers.userId === undefined ? [] : [{ id: answers.userId }] };
          return { meta: { changes: 1 }, results: [] };
        }),
      );
    },
  };
  const env = {
    ENVIRONMENT_NAME: 'dev',
    SITE_ORIGIN: ORIGIN,
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_CLIENT_IDS: 'g',
    APPLE_AUDIENCES: 'a',
    DB,
    SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: !limited }) },
  } as unknown as EmailEnv;
  let clock = NOW;
  const deps: EmailDeps = {
    now: () => clock,
    pause: (ms) => {
      pauses.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    send: (message) => {
      mails.push(message);
      clock += 400;
      return Promise.resolve(sent);
    },
    code: () => CODE,
    token: () => 'unused-token',
  };
  return { env, deps, batches, mails, pauses };
}

const start = (body: unknown, method = 'POST', type = 'application/json'): Request =>
  new Request(`${ORIGIN}/api/app/email/start`, {
    method,
    headers: { 'content-type': type, 'cf-connecting-ip': '203.0.113.9' },
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });

const answerOf = async (response: Response) => ({ status: response.status, body: await response.json() });

const SENT = { status: 202, body: { sent: true } };

describe('POST /api/app/email/start: refusals', () => {
  it('answers 405 to anything but POST', async () => {
    const { env, deps } = setting();
    const response = await handleEmailStart(start(undefined, 'GET'), env, deps);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('answers 429 when the IP is over its limit, before reading the body', async () => {
    const { env, deps, batches } = setting({}, undefined, true);
    expect(await answerOf(await handleEmailStart(start('not json'), env, deps))).toEqual({ status: 429, body: { error: 'slow_down' } });
    expect(batches).toHaveLength(0);
  });

  it.each([
    ['not JSON', 'not json'],
    ['an array', [1]],
    ['null', null],
    ['a bad address', { email: 'nobody', purpose: 'sign-up' }],
    ['an unknown purpose', { email: 'a@example.test', purpose: 'sign-in' }],
    ['an unknown locale', { email: 'a@example.test', purpose: 'sign-up', locale: 'fr' }],
  ])('answers 400 to %s, writing nothing', async (_name, body) => {
    const { env, deps, batches, mails } = setting();
    expect(await answerOf(await handleEmailStart(start(body), env, deps))).toEqual({ status: 400, body: { error: 'bad_request' } });
    expect(batches).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it('answers 400 to a body that is not sent as JSON', async () => {
    const { env, deps } = setting();
    const response = await handleEmailStart(start({ email: 'a@example.test', purpose: 'sign-up' }, 'POST', 'text/plain'), env, deps);
    expect(response.status).toBe(400);
  });
});

describe('POST /api/app/email/start: the per-address limit', () => {
  it('claims the send only while the address has fewer than 3 in 15 minutes and 10 in 24 hours', async () => {
    const { env, deps, batches } = setting();
    await handleEmailStart(start({ email: 'A@example.test', purpose: 'sign-up' }), env, deps);
    const hash = await addressHash(SECRET, 'a@example.test');
    const claim = batches[0]?.find(({ sql }) => sql.startsWith('INSERT INTO email_send'));
    expect(claim?.values).toEqual([hash, NOW, hash, NOW - 15 * 60_000, LIMIT_15_MIN, hash, NOW - 24 * 3_600_000, LIMIT_24_H]);
    // Every address's rows past 24 hours go, not only this one's: an address never used again keeps nothing.
    const pruned = batches[0]?.find(({ sql }) => sql.startsWith('DELETE FROM email_send'));
    expect(pruned).toEqual({ sql: 'DELETE FROM email_send WHERE at < ?', values: [NOW - 24 * 3_600_000] });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('removes every code past its life on each start', async () => {
    const { env, deps, batches } = setting();
    await handleEmailStart(start({ email: 'a@example.test', purpose: 'sign-up' }), env, deps);
    expect(batches[0]?.find(({ sql }) => sql.startsWith('DELETE FROM email_code'))).toEqual({
      sql: 'DELETE FROM email_code WHERE expires_at < ?',
      values: [NOW],
    });
  });

  it.each([
    ['an address with an account', 'u-1'],
    ['an address without one', undefined],
  ])('answers 429 for %s over its limit, sending nothing', async (_name, userId) => {
    const { env, deps, mails, batches } = setting({ sendInserted: 0, ...(userId === undefined ? {} : { userId }) });
    const answer = await answerOf(await handleEmailStart(start({ email: 'a@example.test', purpose: 'sign-up' }), env, deps));
    expect(answer).toEqual({ status: 429, body: { error: 'slow_down' } });
    expect(mails).toHaveLength(0);
    expect(batches).toHaveLength(1);
  });
});

describe('POST /api/app/email/start: what is mailed', () => {
  it('mails a sign-up code to an address with no account, storing only its hashes', async () => {
    const { env, deps, mails, batches } = setting();
    expect(await answerOf(await handleEmailStart(start({ email: 'new@example.test', purpose: 'sign-up' }), env, deps))).toEqual(SENT);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe('new@example.test');
    expect(mails[0]?.text).toContain(CODE);
    const stored = batches[1] ?? [];
    expect(stored.map(({ sql }) => sql.split(' (')[0])).toEqual([
      'DELETE FROM email_code WHERE address_hash = ? AND purpose = ?',
      'INSERT INTO email_code',
    ]);
    const hash = await addressHash(SECRET, 'new@example.test');
    expect(stored[0]?.values).toEqual([hash, 'sign-up']);
    expect(stored[1]?.values).toEqual([hash, 'sign-up', expect.stringMatching(/^[0-9a-f]{64}$/), NOW + CODE_TTL_MS, NOW]);
    // Only the account lookup reads the plain address; no write holds it or the code.
    const writes = batches.flat().filter(({ sql }) => !sql.startsWith('SELECT'));
    expect(JSON.stringify(writes)).not.toContain('new@example.test');
    expect(JSON.stringify(batches)).not.toContain(CODE);
    expect(
      batches
        .flat()
        .filter(({ values }) => values.includes('new@example.test'))
        .map(({ sql }) => sql),
    ).toEqual(['SELECT id FROM "user" WHERE email = ?']);
  });

  it('mails an address that has an account a notice with no code, answering the same', async () => {
    const { env, deps, mails, batches } = setting({ userId: 'u-1' });
    expect(await answerOf(await handleEmailStart(start({ email: 'old@example.test', purpose: 'sign-up' }), env, deps))).toEqual(SENT);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.text).not.toMatch(/\d{6}/);
    expect(mails[0]?.text).toContain(`${ORIGIN}/recover/`);
    expect(batches).toHaveLength(1);
  });

  it('mails a recovery code to an address that has an account', async () => {
    const { env, deps, mails, batches } = setting({ userId: 'u-1' });
    expect(await answerOf(await handleEmailStart(start({ email: 'old@example.test', purpose: 'recovery' }), env, deps))).toEqual(SENT);
    expect(mails[0]?.text).toContain(CODE);
    expect(batches[1]?.[1]?.values[1]).toBe('recovery');
  });

  it('sends nothing for a recovery of an address with no account, answering the same', async () => {
    const { env, deps, mails, batches } = setting();
    expect(await answerOf(await handleEmailStart(start({ email: 'nobody@example.test', purpose: 'recovery' }), env, deps))).toEqual(SENT);
    expect(mails).toHaveLength(0);
    expect(batches).toHaveLength(1);
  });

  it('answers 502 when a due send fails, never "sent"', async () => {
    const { env, deps } = setting({}, { ok: false, reason: 'unavailable' });
    const answer = await answerOf(await handleEmailStart(start({ email: 'new@example.test', purpose: 'sign-up' }), env, deps));
    expect(answer).toEqual({ status: 502, body: { error: 'mail_failed' } });
  });

  it.each(LOCALES)('writes the mail in %s', async (locale) => {
    const { env, deps, mails } = setting();
    await handleEmailStart(start({ email: 'new@example.test', purpose: 'sign-up', locale }), env, deps);
    expect(mails[0]?.subject).not.toBe('');
  });

  it('removes tokens past their life in the first batch', async () => {
    const { env, deps, batches } = setting();
    await handleEmailStart(start({ email: 'new@example.test', purpose: 'sign-up' }), env, deps);
    expect(batches[0]?.find(({ sql }) => sql === 'DELETE FROM one_time_token WHERE expires_at < ?')?.values).toEqual([NOW]);
  });
});

describe('POST /api/app/email/start: timing', () => {
  it('does not pause when the answer is already later than the floor', async () => {
    const { env, deps, pauses } = setting();
    const slow = {
      ...deps,
      send: async (message: MailMessage) => {
        await deps.send(message);
        for (let i = 0; i < 10; i += 1) await deps.pause(1_000);
        return { ok: true, messageId: 'm-slow' } as const;
      },
    };
    pauses.length = 0;
    await handleEmailStart(start({ email: 'a@example.test', purpose: 'sign-up' }), env, slow);
    expect(pauses).toEqual(Array.from({ length: 10 }, () => 1_000));
  });

  it.each([
    ['a code sent', {}, 'sign-up'],
    ['a notice sent', { userId: 'u-1' }, 'sign-up'],
    ['nothing sent', {}, 'recovery'],
    ['over the limit', { sendInserted: 0 }, 'sign-up'],
  ] as const)('answers no sooner than the floor when %s', async (_name, answers, purpose) => {
    const { env, deps } = setting(answers);
    const before = deps.now();
    await handleEmailStart(start({ email: 'a@example.test', purpose }), env, deps);
    expect(deps.now() - before).toBeGreaterThanOrEqual(START_ANSWER_FLOOR_MS);
  });
});

describe('emailDeps: what the routes use in production', () => {
  it("is the real clock, the closed-testing form's pause, a fresh code and token, and the sender, which answers a failure when mail is not set up", async () => {
    const { env, batches } = setting();
    const deps = emailDeps(env);
    expect(deps.now).toBe(Date.now);
    expect(deps.pause).toBe(pause);
    expect(deps.code()).toMatch(/^\d{6}$/);
    expect(deps.token()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await deps.send({ to: 'a@example.test', subject: 's', text: 't' })).toEqual({ ok: false, reason: 'unavailable' });
    expect(batches.flat().some(({ values }) => values[2] === 'mail.failed')).toBe(true);
  });
});
