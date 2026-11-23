import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MailMessage } from '../../packages/mail/index.ts';
import { addressHash, newToken } from '../../workers/web/src/app/email-code.ts';
import { handleEmailStart, handleEmailVerify, type EmailDeps, type EmailEnv } from '../../workers/web/src/app/email-routes.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * Email codes on a real D1 (plan 6, shyden-labs/ShyTalk#133): the tables from
 * migrations/0006_email_codes.sql, with the sender, the pause and the code
 * stood in.
 */

const SECRET = 'an-integration-secret-long-enough-for-better-auth';
let local: LocalDevEnv;
let dispose: () => Promise<void>;
let env: EmailEnv;
const mails: MailMessage[] = [];
let code = '100000';

const deps: EmailDeps = {
  pause: () => Promise.resolve(),
  send: (message) => {
    mails.push(message);
    return Promise.resolve({ ok: true, messageId: 'm-1' });
  },
  code: () => code,
  now: Date.now,
  token: newToken,
};

beforeAll(async () => {
  ({ env: local, dispose } = await localDev());
  env = {
    ENVIRONMENT_NAME: 'dev',
    SITE_ORIGIN: 'https://site.example.test',
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_CLIENT_IDS: 'g',
    APPLE_AUDIENCES: 'a',
    DB: local.DB,
    SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: true }) },
  } as unknown as EmailEnv;
});

afterAll(async () => {
  await dispose();
});

const count = async (sql: string, ...values: unknown[]): Promise<number> =>
  (
    await local.DB.prepare(`SELECT COUNT(*) AS n FROM ${sql}`)
      .bind(...values)
      .first<{ n: number }>()
  )?.n ?? -1;

const verify = (email: string, purpose: string, given: string): Request =>
  new Request('https://site.example.test/api/app/email/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
    body: JSON.stringify({ email, purpose, code: given }),
  });

/** A member as Better Auth stores one, with nothing but the row. */
async function member(id: string, email: string): Promise<void> {
  await local.DB.prepare('INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)')
    .bind(id, 'Member', email, new Date().toISOString(), new Date().toISOString())
    .run();
}

const start = (email: string, purpose: string): Request =>
  new Request('https://site.example.test/api/app/email/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
    body: JSON.stringify({ email, purpose }),
  });

describe('POST /api/app/email/start on D1', () => {
  // One address, started twice, then verified: these were four journeys, each starting first (shyden-labs/ShyTalk#180).
  it('keeps one live code per address and purpose and one send row per start, stores no plain address or code, lets one of two verifies through, and answers a sign-up token making no user and no session', async () => {
    const email = 'start-one@example.test';
    const hash = await addressHash(SECRET, email);
    code = '111111';
    expect.soft((await handleEmailStart(start(email, 'sign-up'), env, deps)).status).toBe(202);
    code = '222222';
    expect.soft((await handleEmailStart(start(email, 'sign-up'), env, deps)).status).toBe(202);
    expect.soft(await count('email_code WHERE address_hash = ? AND purpose = ?', hash, 'sign-up')).toBe(1);
    expect.soft(await count('email_send WHERE address_hash = ?', hash)).toBe(2);
    expect.soft(mails.at(-1)?.text).toContain('222222');

    const stored = await local.DB.prepare('SELECT * FROM email_code').all();
    expect.soft(JSON.stringify(stored.results)).not.toContain(email);
    expect.soft(JSON.stringify(stored.results)).not.toContain('222222');

    const users = await count('"user"');
    const sessions = await count('session');
    const answers = await Promise.all([1, 2].map(() => handleEmailVerify(verify(email, 'sign-up', '222222'), env, deps)));
    expect.soft(answers.map(({ status }) => status).sort()).toEqual([200, 401]);
    expect.soft(await count('"user"')).toBe(users);
    expect.soft(await count('session')).toBe(sessions);
    expect.soft(await count("one_time_token WHERE purpose = 'sign-up' AND email = ?", email)).toBe(1);
  });

  it('refuses the fourth start in 15 minutes with 429, for an address with no account', async () => {
    const email = 'start-limit@example.test';
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await handleEmailStart(start(email, 'recovery'), env, deps)).status);
    expect(statuses).toEqual([202, 202, 202, 429]);
    expect(await count('email_send WHERE address_hash = ?', await addressHash(SECRET, email))).toBe(3);
  });

  it('lets only three of six starts at one moment through the limit', async () => {
    const email = 'start-race@example.test';
    const statuses = await Promise.all(Array.from({ length: 6 }, () => handleEmailStart(start(email, 'recovery'), env, deps)));
    expect(statuses.map(({ status }) => status).sort()).toEqual([202, 202, 202, 429, 429, 429]);
  });
});

describe('POST /api/app/email/verify on D1', () => {
  it('spends a code on its fifth wrong try', async () => {
    const email = 'verify-wrong@example.test';
    code = '515151';
    await handleEmailStart(start(email, 'sign-up'), env, deps);
    for (let i = 0; i < 5; i += 1) expect((await handleEmailVerify(verify(email, 'sign-up', '000000'), env, deps)).status).toBe(401);
    expect((await handleEmailVerify(verify(email, 'sign-up', '515151'), env, deps)).status).toBe(401);
  });

  it('compares at most five guesses, however many arrive at one moment', async () => {
    const email = 'verify-parallel@example.test';
    code = '737373';
    await handleEmailStart(start(email, 'sign-up'), env, deps);
    const wrong = await Promise.all(Array.from({ length: 12 }, () => handleEmailVerify(verify(email, 'sign-up', '000000'), env, deps)));
    expect(wrong.every(({ status }) => status === 401)).toBe(true);
    expect((await handleEmailVerify(verify(email, 'sign-up', '737373'), env, deps)).status).toBe(401);
  });

  it('starts one recovery with its audit row, holding no token, and mails the cancel link', async () => {
    const email = 'verify-recovery@example.test';
    await member('u-recovery', email);
    code = '626262';
    await handleEmailStart(start(email, 'recovery'), env, deps);
    const answer = await handleEmailVerify(verify(email, 'recovery', '626262'), env, deps);
    expect(answer.status).toBe(200);
    const { recoveryToken } = (await answer.json()) as { recoveryToken: string };
    expect(await count("account_recovery WHERE user_id = ? AND state = 'pending'", 'u-recovery')).toBe(1);
    const audited = await local.DB.prepare("SELECT detail FROM audit WHERE action = 'recovery.start' AND subject = ?")
      .bind('user:u-recovery')
      .all<{ detail: string }>();
    expect(audited.results).toHaveLength(1);
    expect(audited.results[0]?.detail).not.toContain(recoveryToken);
    expect(mails.at(-1)?.text).toMatch(/\/recover\/cancel\/#[A-Za-z0-9_-]{43}/);
  });
});
