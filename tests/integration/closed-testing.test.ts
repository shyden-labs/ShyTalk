import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { handleClosedTesting, type ClosedTestingDeps, type ClosedTestingEnv } from '../../workers/web/src/api/closed-testing.ts';
import type { MailMessage, MailResult } from '../../packages/mail/index.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * The closed-testing form on a real D1 (plan 3 Task 5, shyden-labs/ShyTalk#55):
 * one row per address, what the guarded write refuses, a token that works once
 * even under 20 confirms at a time, and one audit row per real change. Only
 * the sender and the clock are stood in.
 */

const ORIGIN = 'https://site.example.test';
const HOUR = 3_600_000;
const START = 1_800_000_000_000;
const ANN = 'ann@example.test';

let dev: LocalDevEnv;
let dispose: () => Promise<void>;
let env: ClosedTestingEnv;
let clock: number;
let mails: MailMessage[];
let sendResult: MailResult;

const deps = (): ClosedTestingDeps => ({
  now: () => clock,
  pause: () => Promise.resolve(),
  send: (message) => {
    mails.push(message);
    return Promise.resolve(sendResult);
  },
});

const apply = (email = ANN, locale = 'en'): Promise<Response> =>
  handleClosedTesting(
    new Request(`${ORIGIN}/api/closed-testing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, adult: true, locale }),
    }),
    env,
    deps(),
  );

const confirm = (t: string): Promise<Response> =>
  handleClosedTesting(new Request(`${ORIGIN}/api/closed-testing/confirm`, { method: 'POST', body: JSON.stringify({ t }) }), env, deps());

const tokenIn = (mail: MailMessage | undefined): string => /[?&]t=([\w-]+)/.exec(mail?.text ?? '')?.[1] ?? '';

interface Row {
  email: string;
  locale: string;
  applied_at: number;
  confirmed_at: number | null;
  confirm_hash: string | null;
  confirm_sent_at: number | null;
}
const rows = async (): Promise<Row[]> => (await dev.DB.prepare('SELECT * FROM applicants').all<Row>()).results;

/** Audit rows written since this test began: the table keeps every row for ever. */
let auditStart: number;
const auditCount = async (action: string): Promise<number> =>
  (await dev.DB.prepare('SELECT COUNT(*) AS n FROM audit WHERE action = ? AND id > ?').bind(action, auditStart).first<{ n: number }>())
    ?.n ?? -1;

beforeAll(async () => {
  ({ env: dev, dispose } = await localDev());
  env = {
    ENVIRONMENT_NAME: 'dev',
    DB: dev.DB,
    SITE_ORIGIN: ORIGIN,
    APPLY_LIMIT: { limit: () => Promise.resolve({ success: true }) },
  };
});

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  await dev.DB.exec('DELETE FROM applicants');
  auditStart = (await dev.DB.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM audit').first<{ n: number }>())?.n ?? 0;
  clock = START;
  mails = [];
  sendResult = { ok: true, messageId: 'm-1' };
});

describe('applying', () => {
  it('stores one row and sends one mail, holding the hash and never the token', async () => {
    expect((await apply()).status).toBe(202);
    const [row, ...others] = await rows();
    expect(others).toEqual([]);
    expect(row).toMatchObject({ email: ANN, locale: 'en', applied_at: START, confirmed_at: null, confirm_sent_at: START });
    expect(row?.confirm_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(mails).toHaveLength(1);
    expect(JSON.stringify(row)).not.toContain(tokenIn(mails[0]));
    expect(await auditCount('applicant.applied')).toBe(1);
    expect(await auditCount('applicant.expired')).toBe(0);
  });

  it('makes one row of spaces and capitals', async () => {
    await apply(' Ann@Example.TEST ');
    clock += 11 * 60_000;
    await apply(ANN);
    expect((await rows()).map(({ email }) => email)).toEqual([ANN]);
  });

  it('sends one mail for 20 applications at once, however long the sender takes', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: ClosedTestingDeps = {
      ...deps(),
      send: async (message) => {
        mails.push(message);
        await held;
        return sendResult;
      },
    };
    const request = (): Request =>
      new Request(`${ORIGIN}/api/closed-testing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: ANN, adult: true, locale: 'en' }),
      });
    const answering = Array.from({ length: 20 }, () => handleClosedTesting(request(), env, slow));
    // The 19 others answer while the first send is still held.
    const answers = await Promise.all(
      answering.map((answer) =>
        Promise.race([
          answer,
          new Promise<null>((resolve) =>
            setTimeout(() => {
              resolve(null);
            }, 2_000),
          ),
        ]),
      ),
    );
    release();
    await Promise.all(answering);
    expect(answers.filter((answer) => answer?.status === 202)).toHaveLength(19);
    expect(mails).toHaveLength(1);
  });

  it('sends nothing to the same address within 10 minutes, and audits no change', async () => {
    await apply();
    clock += 9 * 60_000;
    expect((await apply()).status).toBe(202);
    expect(mails).toHaveLength(1);
    expect(await auditCount('applicant.applied')).toBe(1);
  });

  it('sends a fresh mail after 10 minutes, and the old link stops working', async () => {
    await apply();
    const old = tokenIn(mails[0]);
    clock += 10 * 60_000 + 1;
    await apply();
    expect(mails).toHaveLength(2);
    expect((await confirm(old)).status).toBe(410);
    expect((await confirm(tokenIn(mails[1]))).status).toBe(200);
  });

  it('sends nothing to a confirmed address, and answers the same', async () => {
    await apply();
    await confirm(tokenIn(mails[0]));
    clock += HOUR;
    const answer = await apply();
    expect(answer.status).toBe(202);
    expect(await answer.json()).toEqual({ state: 'sent' });
    expect(mails).toHaveLength(1);
  });

  it('keeps confirm_sent_at null when the sender fails, and a retry at once sends', async () => {
    sendResult = { ok: false, reason: 'unavailable' };
    expect((await apply()).status).toBe(503);
    expect((await rows())[0]?.confirm_sent_at).toBeNull();
    expect(await auditCount('applicant.send_failed')).toBe(1);
    sendResult = { ok: true, messageId: 'm-2' };
    expect((await apply()).status).toBe(202);
    expect(mails).toHaveLength(2);
  });

  it('removes unconfirmed sign-ups past 48 hours on the next write, auditing it, and keeps confirmed ones', async () => {
    await apply('old@example.test');
    await apply('kept@example.test');
    await confirm(tokenIn(mails[1]));
    clock += 48 * HOUR + 1;
    await apply('new@example.test');
    expect((await rows()).map(({ email }) => email).sort()).toEqual(['kept@example.test', 'new@example.test']);
    expect(await auditCount('applicant.expired')).toBe(1);
  });
});

describe('confirming', () => {
  it('sets confirmed_at once and clears the hash; a second use is expired', async () => {
    await apply();
    const token = tokenIn(mails[0]);
    clock += HOUR;
    expect((await confirm(token)).status).toBe(200);
    expect((await rows())[0]).toMatchObject({ confirmed_at: START + HOUR, confirm_hash: null });
    expect((await confirm(token)).status).toBe(410);
    expect((await rows())[0]?.confirmed_at).toBe(START + HOUR);
    expect(await auditCount('applicant.confirmed')).toBe(1);
    const { results } = await dev.DB.prepare('SELECT * FROM audit WHERE id > ?').bind(auditStart).all();
    expect(results.length).toBeGreaterThan(0);
    expect(JSON.stringify(results)).not.toContain(ANN);
  });

  it('refuses a token older than 48 hours, and the row is gone', async () => {
    await apply();
    clock += 48 * HOUR + 1;
    expect((await confirm(tokenIn(mails[0]))).status).toBe(410);
    expect(await rows()).toEqual([]);
  });

  it('accepts a token just inside 48 hours', async () => {
    await apply();
    clock += 48 * HOUR;
    expect((await confirm(tokenIn(mails[0]))).status).toBe(200);
  });

  it('refuses an unknown token, changing nothing', async () => {
    await apply();
    expect((await confirm('no-such-token')).status).toBe(410);
    expect((await rows())[0]?.confirmed_at).toBeNull();
    expect(await auditCount('applicant.confirmed')).toBe(0);
  });

  it('lets exactly one of 20 confirms at once through, with one audit row', async () => {
    await apply();
    const token = tokenIn(mails[0]);
    const answers = await Promise.all(Array.from({ length: 20 }, () => confirm(token)));
    expect(answers.filter(({ status }) => status === 200)).toHaveLength(1);
    expect(answers.filter(({ status }) => status === 410)).toHaveLength(19);
    expect(await auditCount('applicant.confirmed')).toBe(1);
  });
});
