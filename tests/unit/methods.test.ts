import { describe, expect, it } from 'vitest';
import { AUDIT_IF_CHANGED_SQL } from '../../workers/web/src/audit.ts';
import { handleMethods, type MethodsEnv } from '../../workers/web/src/app/methods.ts';
import type { AppSession } from '../../workers/web/src/app/session.ts';

/**
 * A member's sign-in methods and devices (plan 7 Task 6, shyden-labs/ShyTalk#134
 * AC4, AC6, AC7): `GET /api/app/sign-in-methods`, `DELETE
 * /api/app/sign-in-methods/passkey/:id` and `/totp`, `GET /api/app/sessions`
 * and `DELETE /api/app/sessions/:id`. D1 and the session are stood in; the SQL
 * on a real D1 is tests/integration/methods.test.ts.
 */

const ORIGIN = 'https://site.example.test';
const SESSION: AppSession = { sessionId: 's-here', userId: 'u-1', email: 'm@example.test', createdAt: 1 };

interface Recorded {
  sql: string;
  values: unknown[];
}

interface Rows {
  passkeys?: { id: string; name: string | null; createdAt: string }[];
  totp?: boolean;
  linked?: string[];
  codesLeft?: number;
  sessions?: { id: string; createdAt: string; userAgent: string | null }[];
  /** Rows the conditional removal changes: 0 when it is the last method. */
  removed?: number;
  exists?: boolean;
  ended?: number;
  failOn?: string;
}

function setting(rows: Rows = {}) {
  const batches: Recorded[][] = [];
  const answer = ({ sql }: Recorded) => {
    const rowsOf = (results: unknown[]) => ({ meta: { changes: 0 }, results });
    if (sql.startsWith('SELECT id, name, "createdAt" FROM passkey')) return rowsOf(rows.passkeys ?? []);
    if (sql.startsWith('SELECT COUNT(*) AS n FROM sign_in_method')) return rowsOf([{ n: rows.totp === true ? 1 : 0 }]);
    if (sql.startsWith('SELECT "providerId" FROM account')) return rowsOf((rows.linked ?? []).map((providerId) => ({ providerId })));
    if (sql.startsWith('SELECT COUNT(*) AS n FROM recovery_code')) return rowsOf([{ n: rows.codesLeft ?? 0 }]);
    if (sql.startsWith('SELECT id, "createdAt", "userAgent" FROM session')) return rowsOf(rows.sessions ?? []);
    if (sql.startsWith('SELECT 1 FROM')) return rowsOf(rows.exists === false ? [] : [{ 1: 1 }]);
    if (sql.startsWith('DELETE FROM passkey') || sql.startsWith('DELETE FROM sign_in_method'))
      return { meta: { changes: rows.removed ?? 1 }, results: [] };
    if (sql.startsWith('DELETE FROM session')) return { meta: { changes: rows.ended ?? 1 }, results: [] };
    return { meta: { changes: 1 }, results: [] };
  };
  const DB = {
    prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) }),
    batch: (statements: unknown[]) => {
      const list = statements as Recorded[];
      if (rows.failOn !== undefined && list.some(({ values }) => typeof values[2] === 'string' && values[2].startsWith(rows.failOn ?? '')))
        return Promise.reject(new Error('D1 is down'));
      batches.push(list);
      return Promise.resolve(list.map(answer));
    },
  };
  const env = { ENVIRONMENT_NAME: 'dev', DB } as unknown as MethodsEnv;
  return { env, batches, all: () => batches.flat() };
}

const signedIn = () => Promise.resolve(SESSION);
const signedOut = () => Promise.resolve(null);
const request = (method: string, path: string): Request => new Request(`${ORIGIN}/api/app/${path}`, { method });
const answerOf = async (response: Response) => ({ status: response.status, body: await response.json() });

describe('GET /api/app/sign-in-methods', () => {
  it("lists the member's passkeys, authenticator, linked Google and Apple, and recovery codes left", async () => {
    const { env } = setting({
      passkeys: [{ id: 'pk-1', name: 'iPhone', createdAt: '2026-11-11T00:00:00.000Z' }],
      totp: true,
      linked: ['google'],
      codesLeft: 7,
    });
    expect(await answerOf(await handleMethods(request('GET', 'sign-in-methods'), env, signedIn))).toEqual({
      status: 200,
      body: {
        passkeys: [{ id: 'pk-1', name: 'iPhone', createdAt: '2026-11-11T00:00:00.000Z' }],
        authenticator: true,
        linked: ['google'],
        recoveryCodesLeft: 7,
      },
    });
  });

  it('answers 401 signed_out without a session', async () => {
    const { env } = setting();
    expect((await handleMethods(request('GET', 'sign-in-methods'), env, signedOut)).status).toBe(401);
  });
});

describe('DELETE a sign-in method', () => {
  it('removes a passkey only while another method remains, auditing it in the same batch', async () => {
    const { env, batches } = setting();
    expect(await answerOf(await handleMethods(request('DELETE', 'sign-in-methods/passkey/pk-1'), env, signedIn))).toEqual({
      status: 200,
      body: { ok: true },
    });
    const removal = batches.at(-1) ?? [];
    expect(removal[0]?.sql).toContain('DELETE FROM passkey WHERE id = ? AND "userId" = ? AND');
    expect(removal[0]?.sql).toContain("\"providerId\" IN ('google', 'apple')");
    expect(removal[0]?.values.slice(0, 2)).toEqual(['pk-1', 'u-1']);
    expect(removal[1]?.sql).toBe(AUDIT_IF_CHANGED_SQL);
    expect(removal[1]?.values.slice(1, 5)).toEqual([
      'user:u-1',
      'method.remove',
      'user:u-1',
      JSON.stringify({ kind: 'passkey', id: 'pk-1' }),
    ]);
  });

  it('answers 409 last_method when it is the last way in', async () => {
    const { env } = setting({ removed: 0 });
    expect(await answerOf(await handleMethods(request('DELETE', 'sign-in-methods/passkey/pk-1'), env, signedIn))).toEqual({
      status: 409,
      body: { error: 'last_method' },
    });
  });

  it('answers 404 for a passkey the member does not have', async () => {
    const { env, all } = setting({ exists: false });
    expect((await handleMethods(request('DELETE', 'sign-in-methods/passkey/pk-other'), env, signedIn)).status).toBe(404);
    expect(all().some(({ sql }) => sql.startsWith('DELETE'))).toBe(false);
  });

  it('removes the authenticator the same way', async () => {
    const { env, batches } = setting();
    expect((await handleMethods(request('DELETE', 'sign-in-methods/totp'), env, signedIn)).status).toBe(200);
    expect(batches.at(-1)?.[0]?.sql).toContain("DELETE FROM sign_in_method WHERE user_id = ? AND kind = 'totp' AND");
  });

  it('answers 404 to a kind it does not know', async () => {
    const { env } = setting();
    expect((await handleMethods(request('DELETE', 'sign-in-methods/google'), env, signedIn)).status).toBe(404);
  });
});

describe('GET /api/app/sessions', () => {
  it("lists the member's sessions, marking this one, never a token", async () => {
    const { env, all } = setting({
      sessions: [
        { id: 's-here', createdAt: '2026-11-11T00:00:00.000Z', userAgent: 'Safari' },
        { id: 's-other', createdAt: '2026-11-10T00:00:00.000Z', userAgent: null },
      ],
    });
    expect(await answerOf(await handleMethods(request('GET', 'sessions'), env, signedIn))).toEqual({
      status: 200,
      body: {
        sessions: [
          { id: 's-here', startedAt: '2026-11-11T00:00:00.000Z', device: 'Safari', current: true },
          { id: 's-other', startedAt: '2026-11-10T00:00:00.000Z', device: null, current: false },
        ],
      },
    });
    expect(all().find(({ sql }) => sql.startsWith('SELECT id, "createdAt"'))?.values).toEqual(['u-1']);
  });
});

describe('DELETE /api/app/sessions/:id', () => {
  it("ends one of the member's sessions as sign-out does: an attempt row, then the delete with its success row", async () => {
    const { env, batches } = setting();
    expect(await answerOf(await handleMethods(request('DELETE', 'sessions/s-other'), env, signedIn))).toEqual({
      status: 200,
      body: { ok: true },
    });
    const [attempt, end] = batches.slice(-2);
    expect(attempt?.[0]?.values[2]).toBe('session.end.attempt');
    expect(end?.[0]).toEqual({ sql: 'DELETE FROM session WHERE id = ? AND "userId" = ?', values: ['s-other', 'u-1'] });
    expect(end?.[1]?.values[2]).toBe('session.end.success');
    const chain = (detail: unknown) => (JSON.parse(String(detail)) as { chain: string }).chain;
    expect(chain(attempt?.[0]?.values[4])).toBe(chain(end?.[1]?.values[4]));
    expect(JSON.parse(String(end?.[1]?.values[4]))).toMatchObject({ revoked: 's-other' });
  });

  it("answers 404 for a session that is not the member's, writing nothing", async () => {
    const { env, all } = setting({ exists: false });
    expect((await handleMethods(request('DELETE', 'sessions/s-someone'), env, signedIn)).status).toBe(404);
    expect(all().some(({ sql }) => sql.startsWith('DELETE') || sql.startsWith('INSERT'))).toBe(false);
  });

  it('logs the failure and answers 500 when the session cannot be ended, keeping it', async () => {
    const { env, batches } = setting({ failOn: 'session.end.success' });
    expect((await handleMethods(request('DELETE', 'sessions/s-other'), env, signedIn)).status).toBe(500);
    expect(batches.flat().some(({ values }) => values[2] === 'session.end.failure')).toBe(true);
  });

  it.each(['sessions/s-1/extra', 'sessions/'])('answers 404 to %s', async (path) => {
    const { env, all } = setting();
    expect((await handleMethods(request('DELETE', path), env, signedIn)).status).toBe(404);
    expect(all()).toEqual([]);
  });

  it('still answers 500 when even the failure row cannot be written', async () => {
    const { env } = setting();
    let batches = 0;
    // The existence check and the attempt row go through; the end and the failure row both fail.
    const failing = {
      ...env,
      DB: {
        ...env.DB,
        batch: (statements: unknown[]) => ((batches += 1) <= 2 ? env.DB.batch(statements) : Promise.reject(new Error('D1 is down'))),
      },
    };
    expect((await handleMethods(request('DELETE', 'sessions/s-other'), failing, signedIn)).status).toBe(500);
    expect(batches).toBe(4);
  });

  it('answers 500 and ends nothing when the attempt cannot be logged', async () => {
    const { env, all } = setting({ failOn: 'session.end.attempt' });
    expect((await handleMethods(request('DELETE', 'sessions/s-other'), env, signedIn)).status).toBe(500);
    expect(all().some(({ sql }) => sql.startsWith('DELETE FROM session'))).toBe(false);
  });
});

describe('the methods and sessions routes', () => {
  it('answers 405 to a method they do not take', async () => {
    const { env } = setting();
    expect((await handleMethods(request('POST', 'sign-in-methods'), env, signedIn)).status).toBe(405);
    expect((await handleMethods(request('PUT', 'sessions/s-1'), env, signedIn)).status).toBe(405);
  });
});

describe('POST /api/app/recovery-codes', () => {
  it("replaces the member's codes with a new set of ten, shown once, audited in the same batch", async () => {
    const { env, batches } = setting();
    const response = await handleMethods(request('POST', 'recovery-codes'), env, signedIn);
    expect(response.status).toBe(200);
    const { recoveryCodes } = (await response.json()) as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    const made = batches.at(-1) ?? [];
    expect(made[0]).toEqual({ sql: 'DELETE FROM recovery_code WHERE user_id = ?', values: ['u-1'] });
    expect(made.at(-1)?.values[2]).toBe('recovery_codes.new');
  });

  it('answers 404 to a path below it, making no codes', async () => {
    const { env, all } = setting();
    expect((await handleMethods(request('POST', 'recovery-codes/extra'), env, signedIn)).status).toBe(404);
    expect(all()).toEqual([]);
  });

  it('answers 401 without a session and 405 to GET', async () => {
    const { env } = setting();
    expect((await handleMethods(request('POST', 'recovery-codes'), env, signedOut)).status).toBe(401);
    expect((await handleMethods(request('GET', 'recovery-codes'), env, signedIn)).status).toBe(405);
  });
});
