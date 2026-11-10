import { describe, expect, it } from 'vitest';
import { handleTotpConfirm, handleTotpSetup, type TotpRouteDeps } from '../../workers/web/src/app/totp-routes.ts';
import type { SetupIdentity } from '../../workers/web/src/app/setup-identity.ts';

/**
 * `POST /api/app/totp/setup {token?}` and `POST /api/app/totp/confirm {code,
 * token?}` (plan 7 Task 4, shyden-labs/ShyTalk#134 AC2): who is setting up,
 * the pending authenticator and its finish are stood in (each has its own
 * tests); this pins what the routes do with them.
 */

const SIGN_UP: SetupIdentity = { kind: 'sign-up', userId: 'u-new', email: 'new@example.test', tokenHash: 'th' };
const MEMBER: SetupIdentity = { kind: 'session', userId: 'u-1' };

function deps(overrides: Partial<TotpRouteDeps> = {}): TotpRouteDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    limit: () => Promise.resolve(true),
    identity: (token) => {
      calls.push(`identity:${String(token)}`);
      return Promise.resolve(SIGN_UP);
    },
    emailOf: (userId) => {
      calls.push(`email:${userId}`);
      return Promise.resolve('member@example.test');
    },
    setup: (userId, email) => {
      calls.push(`setup:${userId}:${email}`);
      return Promise.resolve({ uri: 'otpauth://totp/ShyTalk:x?secret=ABC' });
    },
    confirm: (userId, code) => {
      calls.push(`confirm:${userId}:${String(code)}`);
      return Promise.resolve({ secretEnc: 'sealed', step: 7 });
    },
    finish: (identity, confirmed) => {
      calls.push(`finish:${identity.kind}:${confirmed.secretEnc}:${String(confirmed.step)}`);
      return Promise.resolve({ userId: identity.userId, token: 'session-token', recoveryCodes: ['A'] });
    },
    sessionCookie: (token) => Promise.resolve(`session_token=${token}; HttpOnly`),
    ...overrides,
  };
}

const post = (body: unknown): Request =>
  new Request('https://site.example.test/api/app/totp/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const answerOf = async (response: Response) => ({ status: response.status, body: await response.json() });

describe('POST /api/app/totp/setup', () => {
  it('starts a pending authenticator for a sign-up, by its confirmed address, and answers the URI once', async () => {
    const d = deps();
    expect(await answerOf(await handleTotpSetup(post({ token: 'su' }), d))).toEqual({
      status: 200,
      body: { uri: 'otpauth://totp/ShyTalk:x?secret=ABC' },
    });
    expect(d.calls).toEqual(['identity:su', 'setup:u-new:new@example.test']);
  });

  it("looks up a signed-in member's address", async () => {
    const d = deps({ identity: () => Promise.resolve(MEMBER) });
    await handleTotpSetup(post({}), d);
    expect(d.calls).toEqual(['email:u-1', 'setup:u-1:member@example.test']);
  });

  it('answers 409 totp_exists when a live authenticator is already set up', async () => {
    const d = deps({ setup: () => Promise.resolve(null) });
    expect(await answerOf(await handleTotpSetup(post({ token: 'su' }), d))).toEqual({ status: 409, body: { error: 'totp_exists' } });
  });

  it('passes a refusal of who is setting up straight through', async () => {
    const d = deps({ identity: () => Promise.resolve(new Response(JSON.stringify({ error: 'recovery_waiting' }), { status: 403 })) });
    expect((await handleTotpSetup(post({ token: 'rt' }), d)).status).toBe(403);
    expect(d.calls).toEqual([]);
  });

  it('answers 429 over the IP limit, and 400 to a body that is not a JSON object', async () => {
    expect((await handleTotpSetup(post({}), deps({ limit: () => Promise.resolve(false) }))).status).toBe(429);
    expect((await handleTotpSetup(post('nope'), deps())).status).toBe(400);
  });
});

describe('POST /api/app/totp/confirm', () => {
  it('confirms the code, then finishes the setup, answering what the finish gives', async () => {
    const d = deps();
    expect(await answerOf(await handleTotpConfirm(post({ token: 'su', code: '123456' }), d))).toEqual({
      status: 200,
      body: { userId: 'u-new', token: 'session-token', recoveryCodes: ['A'] },
    });
    expect(d.calls).toEqual(['identity:su', 'confirm:u-new:123456', 'finish:sign-up:sealed:7']);
  });

  it('sets the session cookie beside a new session, and none when no session was made', async () => {
    const withToken = await handleTotpConfirm(post({ token: 'su', code: '123456' }), deps());
    expect(withToken.headers.getSetCookie()).toEqual(['session_token=session-token; HttpOnly']);
    const member = await handleTotpConfirm(post({ code: '123456' }), deps({ finish: () => Promise.resolve({ userId: 'u-1' }) }));
    expect(member.headers.getSetCookie()).toEqual([]);
  });

  it('answers 401 code_refused and finishes nothing when the code is wrong', async () => {
    const d = deps({ confirm: () => Promise.resolve(null) });
    expect(await answerOf(await handleTotpConfirm(post({ token: 'su', code: '000000' }), d))).toEqual({
      status: 401,
      body: { error: 'code_refused' },
    });
    expect(d.calls.some((call) => call.startsWith('finish'))).toBe(false);
  });

  it('passes a failed finish straight through', async () => {
    const d = deps({ finish: () => Promise.resolve(new Response(JSON.stringify({ error: 'setup_failed' }), { status: 500 })) });
    expect((await handleTotpConfirm(post({ token: 'su', code: '123456' }), d)).status).toBe(500);
  });

  it('answers 405 to anything but POST', async () => {
    const request = new Request('https://site.example.test/api/app/totp/confirm', { method: 'GET' });
    expect((await handleTotpConfirm(request, deps())).status).toBe(405);
    expect((await handleTotpSetup(request, deps())).status).toBe(405);
  });
});
