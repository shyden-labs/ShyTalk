import { describe, expect, it } from 'vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createOTP } from '@better-auth/utils/otp';
import { createAuth } from '../../workers/web/src/auth/better-auth.ts';
import { tokenHash } from '../../workers/web/src/app/email-code.ts';
import { encryptSecret } from '../../workers/web/src/app/totp.ts';
import {
  SETUP_DEPS,
  codeVerifier,
  ipLimit,
  passkeyHooksFor,
  passkeyRouteDeps,
  sessionReader,
  totpRouteDeps,
  type ReadyEnv,
} from '../../workers/web/src/app/wiring.ts';

/**
 * How the router joins the real pieces (plan 7, shyden-labs/ShyTalk#134):
 * each factory's functions are called against Better Auth on its memory
 * adapter and a D1 stand-in answering by statement, so every piece the router
 * hands a route is shown to reach the right code.
 */

const SECRET = 'a-test-secret-that-is-long-enough-for-better-auth';
const TOTP_KEY = 'a-test-totp-key-long-enough-to-derive-from';
const RFC_SECRET = new TextEncoder().encode('12345678901234567890');

interface Bound {
  sql: string;
  values: unknown[];
}

type Answer = { changes?: number; rows?: unknown[] };

function world(answers: Record<string, Answer> = {}) {
  const statements: Bound[] = [];
  const keys: string[] = [];
  const answerFor = (sql: string) => {
    const match = Object.keys(answers).find((prefix) => sql.startsWith(prefix));
    const found = match === undefined ? {} : (answers[match] ?? {});
    return { meta: { changes: found.changes ?? 1 }, results: found.rows ?? [] };
  };
  const store: Record<string, Record<string, unknown>[]> = {
    user: [{ id: 'u-1', name: 'Member', email: 'm@example.test', emailVerified: true, createdAt: new Date(), updatedAt: new Date() }],
    session: [],
    account: [],
    verification: [],
    passkey: [],
  };
  const ready = {
    ENVIRONMENT_NAME: 'dev',
    SITE_ORIGIN: 'https://site.example.test',
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_CLIENT_IDS: 'g',
    APPLE_AUDIENCES: 'a',
    DB: {
      prepare: (sql: string) => ({ bind: (...values: unknown[]): Bound => ({ sql, values }) }),
      batch: (list: Bound[]) => {
        statements.push(...list);
        return Promise.resolve(list.map(({ sql }) => answerFor(sql)));
      },
    },
    SIGN_IN_LIMIT: {
      limit: ({ key }: { key: string }) => {
        keys.push(key);
        return Promise.resolve({ success: true });
      },
    },
  } as unknown as ReadyEnv;
  const auth = createAuth(ready, {
    database: memoryAdapter(store),
    googleKeys: () => Promise.reject(new Error('unused')),
    appleKeys: () => Promise.reject(new Error('unused')),
  });
  return { ready, auth, store, statements, keys };
}

const bare = (headers: Record<string, string> = {}): Request => new Request('https://site.example.test/api/app/x', { headers });

async function signedIn(w: ReturnType<typeof world>): Promise<Request> {
  const session = await (await w.auth.$context).internalAdapter.createSession('u-1');
  return bare({ authorization: `Bearer ${session.token}` });
}

describe('SETUP_DEPS, sessionReader and ipLimit', () => {
  it("are the real clock and member ids, Better Auth's session, and the IP limit (keyed 'unknown' without an address)", async () => {
    expect(SETUP_DEPS.now).toBe(Date.now);
    expect(SETUP_DEPS.newId()).toMatch(/^[0-9a-f-]{36}$/);
    const w = world();
    expect((await sessionReader(w.auth)(await signedIn(w)))?.userId).toBe('u-1');
    expect(await ipLimit(bare({ 'cf-connecting-ip': '203.0.113.7' }), w.ready)()).toBe(true);
    expect(await ipLimit(bare(), w.ready)()).toBe(true);
    expect(w.keys).toEqual(['203.0.113.7', 'unknown']);
  });
});

describe('codeVerifier', () => {
  it("checks a recovery code with the address's tries", async () => {
    const w = world({ 'UPDATE sign_in_lock SET wrong_tries = wrong_tries + 1': { changes: 0 } });
    expect(await codeVerifier('recovery-code', w.ready, TOTP_KEY)('m@example.test', 'ABCD-EFGH-JKMN-PQRS', Date.now())).toBeNull();
    expect(w.statements.some(({ sql }) => sql.includes("kind = 'recovery-code'"))).toBe(true);
  });

  it('checks an authenticator code under TOTP_KEY, answering its member', async () => {
    const now = 1_800_000_000_000;
    const w = world({
      'SELECT id FROM "user"': { rows: [{ id: 'u-1' }] },
      'SELECT id, secret_enc': { rows: [{ id: 4, secret_enc: await encryptSecret(TOTP_KEY, RFC_SECRET), last_step: 0 }] },
    });
    const code = await createOTP(RFC_SECRET, { digits: 6, period: 30 }).hotp(Math.floor(now / 30_000));
    expect(await codeVerifier('totp', w.ready, TOTP_KEY)('m@example.test', code, now)).toEqual({ userId: 'u-1' });
  });

  it('answers null for an authenticator code that is refused', async () => {
    const w = world({ 'UPDATE sign_in_lock SET wrong_tries = wrong_tries + 1': { changes: 0 } });
    expect(await codeVerifier('totp', w.ready, TOTP_KEY)('m@example.test', '000000', Date.now())).toBeNull();
  });
});

describe('totpRouteDeps', () => {
  it('limits by IP, refuses no session and no token, and reads a signed-in member as a session flow', async () => {
    const w = world({ 'SELECT id FROM sign_in_method': { rows: [] } });
    expect(await totpRouteDeps(bare(), w.ready, TOTP_KEY, w.auth).limit()).toBe(true);
    const refused = await totpRouteDeps(bare(), w.ready, TOTP_KEY, w.auth).identity(null);
    expect(refused instanceof Response && refused.status).toBe(401);
    const deps = totpRouteDeps(await signedIn(w), w.ready, TOTP_KEY, w.auth);
    expect(await deps.identity(null)).toEqual({ kind: 'session', userId: 'u-1' });
    await deps.setup('u-1', 'm@example.test');
    const pending = w.statements.find(({ sql }) => sql.startsWith('INSERT INTO totp_pending'));
    expect(pending?.values[2]).toBe('session');
  });

  it("ties a recovery's authenticator to its token and lets it replace a live one", async () => {
    const hash = await tokenHash('recovery-token');
    const w = world({
      'SELECT purpose': { rows: [{ purpose: 'recovery', user_id: 'u-1', email: null, expires_at: Date.now() + 60_000, used_at: null }] },
      'SELECT id, completes_at': { rows: [{ id: 3, completes_at: Date.now() - 1 }] },
    });
    const deps = totpRouteDeps(bare(), w.ready, TOTP_KEY, w.auth);
    expect(await deps.identity('recovery-token')).toMatchObject({ kind: 'recovery', tokenHash: hash });
    await deps.setup('u-1', 'm@example.test');
    expect(w.statements.some(({ sql }) => sql.startsWith('SELECT id FROM sign_in_method'))).toBe(false);
    expect(w.statements.find(({ sql }) => sql.startsWith('INSERT INTO totp_pending'))?.values[2]).toBe(hash);
  });

  it("reads a member's address, empty when there is none, confirms against the pending one, finishes, and makes the cookie", async () => {
    const w = world({ 'SELECT email FROM "user"': { rows: [{ email: 'm@example.test' }] }, 'SELECT secret_enc': { rows: [] } });
    const deps = totpRouteDeps(bare(), w.ready, TOTP_KEY, w.auth);
    expect(await deps.emailOf('u-1')).toBe('m@example.test');
    expect(await totpRouteDeps(bare(), world().ready, TOTP_KEY, w.auth).emailOf('u-none')).toBe('');
    expect(await deps.confirm('u-1', '123456')).toBeNull();
    const finished = await deps.finish({ kind: 'session', userId: 'u-1' }, { secretEnc: 'sealed', step: 7 });
    expect(finished).toMatchObject({ userId: 'u-1' });
    expect(w.statements.some(({ sql }) => sql.startsWith('INSERT INTO sign_in_method'))).toBe(true);
    expect(await deps.sessionCookie('t-1')).toMatch(/session_token=/);
  });
});

describe('passkeyHooksFor and passkeyRouteDeps', () => {
  it("reads who a token's hash names, and prepares a setup for the passkey", async () => {
    const w = world({ 'SELECT COUNT(*) AS n FROM recovery_code': { rows: [{ n: 3 }] } });
    const hooks = passkeyHooksFor(w.ready, new Map());
    expect(await hooks.resolveUser('unknown-hash')).toBeNull();
    await hooks.afterRegistration(null, 'u-1');
    expect(w.statements.some(({ values }) => values[2] === 'method.add')).toBe(true);
  });

  it('limits, reads the session, refuses an unknown setup, starts and audits sessions, makes the cookie and undoes a sign-up', async () => {
    const w = world();
    const deps = passkeyRouteDeps(bare(), w.ready, w.auth, new Map());
    expect(await deps.limit()).toBe(true);
    expect(await deps.session()).toBeNull();
    const refused = await deps.identity(null, null);
    expect(refused instanceof Response && refused.status).toBe(401);
    const started = await deps.startSession('u-1', { method: 'passkey' });
    if (started instanceof Response) throw new Error('refused');
    expect(await deps.signedIn('u-1', started.token)).toBeNull();
    expect(await deps.sessionCookie(started.token)).toMatch(/session_token=/);
    await deps.undoSignUp('u-new');
    expect(w.statements.some(({ sql, values }) => sql.startsWith('DELETE FROM "user"') && values[0] === 'u-new')).toBe(true);
  });
});
