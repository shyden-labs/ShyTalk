import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { t, LOCALES } from '../../apps/web/src/i18n/t.ts';
import {
  ANSWER_FLOOR_MS,
  RESEND_WINDOW_MS,
  UNCONFIRMED_LIFE_MS,
  handleClosedTesting,
  hashToken,
  isClosedTesting,
  newToken,
  pause,
  type ClosedTestingDeps,
  type ClosedTestingEnv,
} from '../../workers/web/src/api/closed-testing.ts';
import type { MailMessage, MailResult } from '../../packages/mail/index.ts';

/**
 * The closed-testing form's API (plan 3 Task 5, shyden-labs/ShyTalk#55). D1,
 * the sender, the clock and the pause are stood in; what the SQL itself does
 * on a real D1 is tests/integration/closed-testing.test.ts.
 */

const ORIGIN = 'https://site.example.test';
const NOW = 1_800_000_000_000;

interface Recorded {
  sql: string;
  values: unknown[];
}

/** A D1 stand-in: every batch is recorded; `changes` answers how many rows each statement changed. */
function database(changes: (sql: string) => number = () => 1): { DB: ClosedTestingEnv['DB']; batches: Recorded[][] } {
  const batches: Recorded[][] = [];
  return {
    batches,
    DB: {
      prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) }),
      batch: (statements: unknown[]) => {
        batches.push(statements as Recorded[]);
        return Promise.resolve((statements as Recorded[]).map(({ sql }) => ({ meta: { changes: changes(sql) } })));
      },
    },
  };
}

function setting(changes?: (sql: string) => number, sent: MailResult = { ok: true, messageId: 'm-1' }) {
  const { DB, batches } = database(changes);
  const mails: MailMessage[] = [];
  const pauses: number[] = [];
  const limit = vi.fn(() => Promise.resolve({ success: true }));
  const env: ClosedTestingEnv = { ENVIRONMENT_NAME: 'dev', DB, SITE_ORIGIN: ORIGIN, APPLY_LIMIT: { limit } };
  const deps: ClosedTestingDeps = {
    now: () => NOW,
    pause: (ms) => {
      pauses.push(ms);
      return Promise.resolve();
    },
    send: (message) => {
      mails.push(message);
      return Promise.resolve(sent);
    },
    token: () => 'raw-token',
  };
  return { env, deps, batches, mails, pauses, limit };
}

const apply = (body: unknown, ip = '203.0.113.9'): Request =>
  new Request(`${ORIGIN}/api/closed-testing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const confirm = (body: unknown): Request =>
  new Request(`${ORIGIN}/api/closed-testing/confirm`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

const GOOD = { email: 'ann@example.test', adult: true, locale: 'en' };
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const statementsOf = (batches: Recorded[][]): Recorded[] => batches.flat();
const find = (batches: Recorded[][], needle: string): Recorded | undefined => statementsOf(batches).find(({ sql }) => sql.includes(needle));
const audits = (batches: Recorded[][]): unknown[][] =>
  statementsOf(batches)
    .filter(({ sql }) => sql.includes('INTO audit'))
    .map(({ values }) => values);

afterEach(() => {
  vi.useRealTimers();
});

describe('isClosedTesting', () => {
  it.each(['/api/closed-testing', '/api/closed-testing/confirm'])('claims %s', (path) => {
    expect(isClosedTesting(path)).toBe(true);
  });

  it.each(['/api/closed-testing-other', '/api/x', '/closed-testing'])('leaves %s', (path) => {
    expect(isClosedTesting(path)).toBe(false);
  });
});

describe('newToken and hashToken', () => {
  it('makes 32 random bytes as base64url', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
  });

  it('hashes with SHA-256 as hex', async () => {
    expect(await hashToken('abc')).toBe(sha256('abc'));
  });
});

describe('pause', () => {
  it('waits the time it is given', async () => {
    vi.useFakeTimers();
    let done = false;
    const waiting = pause(50).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(done).toBe(true);
  });
});

describe('routes', () => {
  it.each(['/api/closed-testing', '/api/closed-testing/confirm'])('%s takes POST alone', async (path) => {
    const { env, deps, batches } = setting();
    const answer = await handleClosedTesting(new Request(`${ORIGIN}${path}`), env, deps);
    expect(answer.status).toBe(405);
    expect(answer.headers.get('allow')).toBe('POST');
    expect(batches).toEqual([]);
  });

  it('answers 404 for another path under it', async () => {
    const { env, deps } = setting();
    const answer = await handleClosedTesting(new Request(`${ORIGIN}/api/closed-testing/other`, { method: 'POST' }), env, deps);
    expect(answer.status).toBe(404);
  });
});

describe('apply: refusals', () => {
  it('answers 429 with one body for everyone when the IP is over its limit, storing nothing', async () => {
    const { env, deps, batches, mails, limit } = setting();
    limit.mockResolvedValue({ success: false });
    const answer = await handleClosedTesting(apply(GOOD), env, deps);
    expect(answer.status).toBe(429);
    expect(await answer.json()).toEqual({ state: 'slow_down' });
    expect(batches).toEqual([]);
    expect(mails).toEqual([]);
  });

  it('limits by the caller’s IP', async () => {
    const { env, deps, limit } = setting();
    await handleClosedTesting(apply(GOOD, '198.51.100.7'), env, deps);
    expect(limit).toHaveBeenCalledWith({ key: '198.51.100.7' });
  });

  it('limits a caller with no IP header under one shared key', async () => {
    const { env, deps, limit } = setting();
    const request = new Request(`${ORIGIN}/api/closed-testing`, { method: 'POST', body: JSON.stringify(GOOD) });
    await handleClosedTesting(request, env, deps);
    expect(limit).toHaveBeenCalledWith({ key: 'unknown' });
  });

  it('answers 503 send_failed with no rate-limit binding', async () => {
    const { env, deps, batches } = setting();
    const answer = await handleClosedTesting(apply(GOOD), { ...env, APPLY_LIMIT: undefined }, deps);
    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ state: 'send_failed' });
    expect(batches).toEqual([]);
  });

  it('answers 503 send_failed with no site origin to build the link from', async () => {
    const { env, deps, batches } = setting();
    const answer = await handleClosedTesting(apply(GOOD), { ...env, SITE_ORIGIN: undefined }, deps);
    expect(answer.status).toBe(503);
    expect(batches).toEqual([]);
  });

  it.each([
    ['broken JSON', '{'],
    ['a list', '[]'],
    ['null', 'null'],
    ['no email', { adult: true, locale: 'en' }],
    ['a numeric email', { ...GOOD, email: 5 }],
    ['an email with no at sign', { ...GOOD, email: 'ann.example.test' }],
    ['two addresses', { ...GOOD, email: 'a@example.test,b@example.test' }],
    ['adult missing', { email: GOOD.email, locale: 'en' }],
    ['adult false', { ...GOOD, adult: false }],
    ['adult as the word true', { ...GOOD, adult: 'true' }],
    ['no locale', { email: GOOD.email, adult: true }],
    ['an unknown locale', { ...GOOD, locale: 'fr' }],
    ['an inherited property as the locale', { ...GOOD, locale: 'constructor' }],
  ])('answers 400 invalid for %s, storing and sending nothing', async (_name, body) => {
    const { env, deps, batches, mails } = setting();
    const answer = await handleClosedTesting(apply(body), env, deps);
    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({ state: 'invalid' });
    expect(batches).toEqual([]);
    expect(mails).toEqual([]);
  });
});

describe('apply: a new address', () => {
  it('answers 202 sent and sends one mail', async () => {
    const { env, deps, mails } = setting();
    const answer = await handleClosedTesting(apply(GOOD), env, deps);
    expect(answer.status).toBe(202);
    expect(await answer.json()).toEqual({ state: 'sent' });
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe('ann@example.test');
  });

  it('makes spaces and capitals one address', async () => {
    const { env, deps, mails, batches } = setting();
    await handleClosedTesting(apply({ ...GOOD, email: ' Ann@Example.TEST ' }), env, deps);
    expect(mails[0]?.to).toBe('ann@example.test');
    expect(find(batches, 'INSERT INTO applicants')?.values[0]).toBe('ann@example.test');
  });

  it('stores the token’s hash, never the token', async () => {
    const { env, deps, batches } = setting();
    await handleClosedTesting(apply(GOOD), env, deps);
    expect(find(batches, 'INSERT INTO applicants')?.values).toEqual([
      'ann@example.test',
      'en',
      NOW,
      sha256('raw-token'),
      NOW - RESEND_WINDOW_MS,
    ]);
    expect(JSON.stringify(batches)).not.toContain('raw-token');
  });

  it('deletes unconfirmed sign-ups past their life in the same batch as the write', async () => {
    const { env, deps, batches } = setting();
    await handleClosedTesting(apply(GOOD), env, deps);
    const first = batches[0] as Recorded[];
    expect(first[0]?.sql).toContain('DELETE FROM applicants');
    expect(first[0]?.values).toEqual([NOW - UNCONFIRMED_LIFE_MS]);
    expect(first[1]?.values[2]).toBe('applicant.expired');
    expect(first[2]?.sql).toContain('INSERT INTO applicants');
    expect(first[3]?.values[2]).toBe('applicant.applied');
  });

  it('audits only rows that changed, as the public, never naming the address', async () => {
    const { env, deps, batches } = setting();
    await handleClosedTesting(apply(GOOD), env, deps);
    const rows = audits(batches);
    expect(rows.map((values) => values[2])).toEqual(['applicant.expired', 'applicant.applied', 'applicant.confirm_sent']);
    for (const values of rows) expect(values[1]).toBe('public');
    expect(JSON.stringify(rows)).not.toContain('ann@example.test');
    expect(find(batches, 'WHERE changes() > 0')).toBeDefined();
  });

  it('records the send, audited, after the mail went', async () => {
    const { env, deps, batches } = setting();
    await handleClosedTesting(apply(GOOD), env, deps);
    expect(batches).toHaveLength(2);
    expect(batches[1]?.[0]?.sql).toContain('UPDATE applicants SET confirm_sent_at');
    expect(batches[1]?.[0]?.values).toEqual([NOW, 'ann@example.test']);
    expect(batches[1]?.[1]?.values[2]).toBe('applicant.confirm_sent');
  });
});

describe('apply: the mail', () => {
  it.each(LOCALES)('is in %s, holds every statement, and links to that language’s confirm page', async (locale) => {
    const { env, deps, mails } = setting();
    await handleClosedTesting(apply({ ...GOOD, locale }), env, deps);
    const mail = mails[0] as MailMessage;
    expect(mail.subject).toBe(t(locale, 'closedTesting.mailSubject'));
    for (const key of ['noAccess', 'moreDetails', 'safeList', 'removed', 'retention', 'mailIntro', 'mailIgnore'])
      expect(mail.text).toContain(t(locale, `closedTesting.${key}`));
    const prefix = locale === 'en' ? '' : `/${locale}`;
    expect(mail.text).toContain(`${ORIGIN}${prefix}/closed-testing/confirm?t=raw-token`);
  });
});

describe('apply: an address that must not be sent to', () => {
  // The guarded write changes nothing for a confirmed address and for one sent to within 10 minutes.
  const unchanged = (sql: string): number => (sql.includes('INSERT INTO applicants') ? 0 : 1);

  it('answers the same 202 and sends nothing', async () => {
    const { env, deps, mails, batches } = setting(unchanged);
    const answer = await handleClosedTesting(apply(GOOD), env, deps);
    expect(answer.status).toBe(202);
    expect(await answer.json()).toEqual({ state: 'sent' });
    expect(mails).toEqual([]);
    expect(find(batches, 'confirm_sent_at = ?')).toBeUndefined();
  });

  it('waits out the floor, so it takes as long as a send', async () => {
    const { env, deps, pauses } = setting(unchanged);
    await handleClosedTesting(apply(GOOD), env, deps);
    expect(pauses).toEqual([ANSWER_FLOOR_MS]);
  });
});

describe('apply: the answer’s time', () => {
  it('waits only what the send left of the floor', async () => {
    const { env, deps, pauses } = setting();
    let clock = NOW;
    await handleClosedTesting(apply(GOOD), env, {
      ...deps,
      now: () => clock,
      send: () => {
        clock += 400;
        return Promise.resolve({ ok: true, messageId: 'm-1' });
      },
    });
    expect(pauses).toEqual([ANSWER_FLOOR_MS - 400]);
  });

  it('does not wait when the send took longer than the floor', async () => {
    const { env, deps, pauses } = setting();
    let clock = NOW;
    await handleClosedTesting(apply(GOOD), env, {
      ...deps,
      now: () => clock,
      send: () => {
        clock += ANSWER_FLOOR_MS + 1;
        return Promise.resolve({ ok: true, messageId: 'm-1' });
      },
    });
    expect(pauses).toEqual([]);
  });
});

describe('apply: the sender fails', () => {
  it('answers 503 send_failed and never records a send', async () => {
    const { env, deps, batches } = setting(undefined, { ok: false, reason: 'unavailable' });
    const answer = await handleClosedTesting(apply(GOOD), env, deps);
    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ state: 'send_failed' });
    expect(find(batches, 'confirm_sent_at = ?')).toBeUndefined();
  });
});

describe('confirm', () => {
  it('answers 200 confirmed when the token’s hash changed a row, auditing it', async () => {
    const { env, deps, batches } = setting();
    const answer = await handleClosedTesting(confirm({ t: 'raw-token' }), env, deps);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ state: 'confirmed' });
    const update = find(batches, 'UPDATE applicants SET confirmed_at');
    expect(update?.values).toEqual([NOW, sha256('raw-token')]);
    expect(audits(batches).map((values) => values[2])).toEqual(['applicant.expired', 'applicant.confirmed']);
    expect(JSON.stringify(batches)).not.toContain('raw-token');
  });

  it('deletes unconfirmed sign-ups past their life before it looks, so an old token finds nothing', async () => {
    const { env, deps, batches } = setting();
    await handleClosedTesting(confirm({ t: 'raw-token' }), env, deps);
    expect(batches[0]?.[0]?.sql).toContain('DELETE FROM applicants');
    expect(batches[0]?.[0]?.values).toEqual([NOW - UNCONFIRMED_LIFE_MS]);
  });

  it('answers 410 expired when no row changed', async () => {
    const { env, deps } = setting((sql) => (sql.includes('UPDATE applicants') ? 0 : 1));
    const answer = await handleClosedTesting(confirm({ t: 'raw-token' }), env, deps);
    expect(answer.status).toBe(410);
    expect(await answer.json()).toEqual({ state: 'expired' });
  });

  it.each([
    ['broken JSON', '{'],
    ['null', 'null'],
    ['no token', {}],
    ['an empty token', { t: '' }],
    ['a numeric token', { t: 5 }],
  ])('answers 410 expired for %s, touching nothing', async (_name, body) => {
    const { env, deps, batches } = setting();
    const answer = await handleClosedTesting(confirm(body), env, deps);
    expect(answer.status).toBe(410);
    expect(batches).toEqual([]);
  });
});

describe('the defaults', () => {
  it('waits with the real pause when none is stood in', async () => {
    const { env, deps } = setting((sql) => (sql.includes('INSERT INTO applicants') ? 0 : 1));
    vi.useFakeTimers();
    const answering = handleClosedTesting(apply(GOOD), env, { now: deps.now as () => number });
    await vi.waitFor(() => {
      expect(vi.getTimerCount()).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(ANSWER_FLOOR_MS);
    expect((await answering).status).toBe(202);
  });

  it('confirms by the real clock when none is stood in', async () => {
    const { env } = setting();
    expect((await handleClosedTesting(confirm({ t: 'raw-token' }), env)).status).toBe(200);
  });

  it('sends through the real sender, which answers unavailable with no Oracle settings', async () => {
    const { env } = setting();
    const { DB } = env;
    const answer = await handleClosedTesting(
      apply(GOOD),
      { ...env, DB },
      {
        pause: () => Promise.resolve(),
      },
    );
    expect(answer.status).toBe(503);
  });
});
