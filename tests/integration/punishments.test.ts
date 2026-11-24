import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuth, type ShyTalkAuth } from '../../workers/web/src/auth/better-auth.ts';
import { handleSignIn, type SignInEnv } from '../../workers/web/src/app/sign-in.ts';
import { handleShyDeskCallback, type ShyDeskCallbackEnv } from '../../workers/web/src/moderation/callback-route.ts';
import { APPLE_ID, GOOGLE_IDS, issuer, type Issuer } from '../support/id-tokens.ts';
import { localDev, type LocalDevEnv } from './d1.ts';

/**
 * ShyDesk punishments on a real D1 (shyden-labs/ShyTalk#310 AC1 and AC2; Shyden 2026-11-23: record and enforce, the
 * keys ShyTalk's own list): migrations/0012_punishments.sql, Better Auth's tables and the audit table. ShyDesk's
 * delivery is signed here as ShyDesk signs it: `v1=` and the hex HMAC-SHA256 of `timestamp.body`.
 */

let local: LocalDevEnv;
let dispose: () => Promise<void>;
let provider: Issuer;
let auth: ShyTalkAuth;
let signInEnv: SignInEnv;
let env: ShyDeskCallbackEnv;

const SECRET = 'an-integration-shydesk-signing-secret';
const settings = {
  ENVIRONMENT_NAME: 'dev',
  SITE_ORIGIN: 'https://site.example.test',
  BETTER_AUTH_SECRET: 'an-integration-secret-long-enough-for-better-auth',
  GOOGLE_CLIENT_IDS: GOOGLE_IDS.join(','),
  APPLE_AUDIENCES: APPLE_ID,
} as const;

beforeAll(async () => {
  ({ env: local, dispose } = await localDev());
  provider = await issuer(inject('idTokenKeys'));
  auth = createAuth(settings, { database: local.DB, googleKeys: provider.keys, appleKeys: provider.keys });
  signInEnv = { ...settings, DB: local.DB, SIGN_IN_LIMIT: { limit: () => Promise.resolve({ success: true }) } };
  env = { ENVIRONMENT_NAME: 'dev', DB: local.DB, SHYDESK_CALLBACK_SECRET: SECRET } as unknown as ShyDeskCallbackEnv;
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

async function hmacHex(secret: string, text: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
  return [...mac].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface Delivery {
  type?: string;
  id: string;
  user: string;
  key?: string;
  seconds?: number | null;
  secret?: string;
  skew?: number;
}

/** A delivery as ShyDesk sends it, signed with `secret` and stamped `skew` seconds from now. */
async function delivery({ type = 'punishment.apply', id, user, key = 'ban', seconds = null, secret = SECRET, skew = 0 }: Delivery) {
  const body = JSON.stringify({
    type,
    punishment_id: id,
    product: 'shytalk',
    subject_user_id: user,
    punishment: { key, label: `Label for ${key}`, duration_seconds: seconds },
    report_ticket_id: 'tkt-1',
    ...(type === 'punishment.apply' ? { appeal_url: 'https://site.example.test/appeal#appeal=t' } : {}),
    issued_at: '2026-11-23T15:00:00Z',
  });
  const timestamp = String(Math.floor(Date.now() / 1000) + skew);
  const request = new Request('https://site.example.test/api/shydesk/callback', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'shydesk-timestamp': timestamp,
      'shydesk-signature': `v1=${await hmacHex(secret, `${timestamp}.${body}`)}`,
    },
    body,
  });
  const response = await handleShyDeskCallback(request, env);
  return { status: response.status, body: await response.json() };
}

async function signIn(email: string, sub: string) {
  const request = new Request('https://site.example.test/api/app/sign-in/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
    body: JSON.stringify({ idToken: await provider.idToken({ email, sub }) }),
  });
  const response = await handleSignIn(request, signInEnv, auth, 'google');
  return { status: response.status, body: (await response.json()) as { token?: string; userId?: string; error?: string } };
}

const live = async (token: string): Promise<boolean> =>
  (await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) })) !== null;

describe('ShyDesk punishments on D1', () => {
  // One member's journey carries every check (one journey, all its assertions).
  it('refuses a wrong delivery writing nothing; a warning is only stored; a suspension ends every session and refuses sign-in, once however often it comes; a lift lets the member back', async () => {
    const first = await signIn('punished@example.test', 'g-punished');
    const second = await signIn('punished@example.test', 'g-punished');
    const user = first.body.userId ?? '';
    expect(user).not.toBe('');

    // Refusals (AC1): each names its code, and nothing is written.
    expect.soft(await delivery({ id: 'p-bad', user, secret: 'not-the-secret' })).toEqual({ status: 401, body: { error: 'bad_signature' } });
    expect.soft(await delivery({ id: 'p-bad', user, skew: -301 })).toEqual({ status: 401, body: { error: 'stale_timestamp' } });
    expect.soft(await delivery({ id: 'p-bad', user, type: 'punishment.pause' })).toEqual({ status: 422, body: { error: 'unknown_type' } });
    expect.soft(await delivery({ id: 'p-bad', user, key: 'kick', seconds: 60 })).toEqual({
      status: 422,
      body: { error: 'unknown_punishment' },
    });
    expect.soft(await count('punishment')).toBe(0);
    expect.soft(await count("audit WHERE action LIKE 'punishment.%'")).toBe(0);
    expect.soft(await live(first.body.token ?? '')).toBe(true);

    // A warning is only stored.
    expect.soft(await delivery({ id: 'p-warn', user, key: 'warning' })).toEqual({ status: 200, body: { applied: true } });
    expect.soft(await count('punishment WHERE id = ? AND blocks = 0', 'p-warn')).toBe(1);
    expect.soft(await live(first.body.token ?? '')).toBe(true);
    expect.soft((await signIn('punished@example.test', 'g-punished')).status).toBe(200);

    // A suspension ends every session at once and refuses sign-in; its replay applies nothing twice (AC2).
    expect
      .soft(await delivery({ id: 'p-sus', user, key: 'suspend-7d', seconds: 604_800 }))
      .toEqual({ status: 200, body: { applied: true } });
    expect.soft(await live(first.body.token ?? '')).toBe(false);
    expect.soft(await live(second.body.token ?? '')).toBe(false);
    expect.soft(await count('session WHERE "userId" = ?', user)).toBe(0);
    expect.soft(await signIn('punished@example.test', 'g-punished')).toEqual({ status: 403, body: { error: 'member_blocked' } });
    expect.soft(await count('session WHERE "userId" = ?', user)).toBe(0);
    // Nor can a session row land while the block holds, even past the sign-in check: a sign-in checked just before the
    // ban arrived cannot write its session after the ban ended the others (the database refuses the row itself).
    const late = local.DB.prepare(
      'INSERT INTO "session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId") VALUES (\'s-late\', 0, \'t-late\', 0, 0, ?)',
    )
      .bind(user)
      .run();
    await expect.soft(late).rejects.toThrow(/member_blocked/u);
    expect.soft(await count('session WHERE "userId" = ?', user)).toBe(0);
    expect
      .soft(await delivery({ id: 'p-sus', user, key: 'suspend-7d', seconds: 604_800 }))
      .toEqual({ status: 200, body: { applied: true } });
    expect.soft(await count('punishment WHERE id = ?', 'p-sus')).toBe(1);
    expect.soft(await count("audit WHERE action = 'punishment.applied' AND subject = ?", user)).toBe(2);

    // A lift lets the member back, and a second lift is answered the same; a lift of nothing stored is refused.
    expect.soft(await delivery({ id: 'p-sus', user, type: 'punishment.lift', key: 'suspend-7d', seconds: 604_800 })).toEqual({
      status: 200,
      body: { applied: true },
    });
    const back = await signIn('punished@example.test', 'g-punished');
    expect.soft(back.status).toBe(200);
    expect.soft(await delivery({ id: 'p-sus', user, type: 'punishment.lift', key: 'suspend-7d', seconds: 604_800 })).toEqual({
      status: 200,
      body: { applied: true },
    });
    expect.soft(await count("audit WHERE action = 'punishment.lifted' AND subject = ?", user)).toBe(1);
    expect
      .soft(await delivery({ id: 'p-never', user, type: 'punishment.lift' }))
      .toEqual({ status: 404, body: { error: 'unknown_punishment' } });
    // A replayed apply after the lift ends nothing: the session made after the lift stays.
    await delivery({ id: 'p-sus', user, key: 'suspend-7d', seconds: 604_800 });
    expect.soft(await live(back.body.token ?? '')).toBe(true);

    // A suspension whose end has passed no longer blocks.
    await local.DB.prepare(
      "INSERT INTO punishment (id, user_id, key, label, blocks, starts_at, ends_at, report_ticket_id, appeal_url, issued_at) VALUES ('p-old', ?, 'suspend-1d', 'Old', 1, 0, 1, 'tkt-0', 'https://site.example.test/appeal', '2026-01-01T00:00:00Z')",
    )
      .bind(user)
      .run();
    expect.soft((await signIn('punished@example.test', 'g-punished')).status).toBe(200);
  });

  it('answers 503 and writes nothing when this environment has no signing secret', async () => {
    const saved = env;
    env = { ...env, SHYDESK_CALLBACK_SECRET: undefined } as unknown as ShyDeskCallbackEnv;
    try {
      expect(await delivery({ id: 'p-nosecret', user: 'u-x' })).toEqual({ status: 503, body: { error: 'callback_unavailable' } });
      expect(await count('punishment WHERE id = ?', 'p-nosecret')).toBe(0);
    } finally {
      env = saved;
    }
  });
});
