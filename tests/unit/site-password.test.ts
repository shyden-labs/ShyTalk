import { describe, it, expect, vi } from 'vitest';
import { SITE_PASSWORD_HEADER, SITE_USER, requireSitePassword } from '../../packages/environment/index.ts';

/**
 * The dev and test sites' password (shyden-labs/ShyTalk#262): HTTP Basic auth,
 * so a person gets the browser's own box; a caller already using
 * `Authorization: Bearer` gives the password in its own header instead.
 */

const PASSWORD = 'the-site-password';
const REALM = 'ShyTalk dev';

/** `Authorization: Basic` for `user:password`, encoded as UTF-8 the way browsers send it. */
const basic = (user: string, password: string): string => {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
};

const withHeaders = (headers: Record<string, string> = {}): Request => new Request('https://origin.example.test/', { headers });

async function expectRefused(response: Response | null): Promise<void> {
  expect(response?.status).toBe(401);
  expect(response?.headers.get('www-authenticate')).toBe(`Basic realm="${REALM}", charset="UTF-8"`);
  expect(response?.headers.get('cache-control')).toBe('no-store');
  expect(await response?.text()).toBe('Unauthorized');
}

describe('requireSitePassword: the browser box (Basic auth)', () => {
  it('names the user shytalk', () => {
    expect(SITE_USER).toBe('shytalk');
  });

  it('lets the right user and password through', async () => {
    expect(await requireSitePassword(withHeaders({ authorization: basic(SITE_USER, PASSWORD) }), PASSWORD, REALM)).toBeNull();
  });

  it.each([
    ['a blank user name', ''],
    ['another user name', 'someone'],
    ['a user name that is not ASCII', 'ผู้ใช้'],
  ])('lets the password through with %s, as the other products’ dev sites do (shyden-labs/ShyTalk#290)', async (_case, user) => {
    expect(await requireSitePassword(withHeaders({ authorization: basic(user, PASSWORD) }), PASSWORD, REALM)).toBeNull();
  });

  it('keeps a colon inside the password when the user name is blank', async () => {
    const password = 'a:b:c';
    expect(await requireSitePassword(withHeaders({ authorization: basic('', password) }), password, REALM)).toBeNull();
  });

  it('reads the scheme in any case', async () => {
    const header = basic(SITE_USER, PASSWORD).replace('Basic', 'bAsIc');
    expect(await requireSitePassword(withHeaders({ authorization: header }), PASSWORD, REALM)).toBeNull();
  });

  it('reads a password that is not ASCII', async () => {
    const password = 'kata-sandi-ภาษา-密码';
    expect(await requireSitePassword(withHeaders({ authorization: basic(SITE_USER, password) }), password, REALM)).toBeNull();
  });

  it('keeps a colon inside the password', async () => {
    const password = 'a:b:c';
    expect(await requireSitePassword(withHeaders({ authorization: basic(SITE_USER, password) }), password, REALM)).toBeNull();
  });

  it('asks with the box when nothing is given', async () => {
    await expectRefused(await requireSitePassword(withHeaders(), PASSWORD, REALM));
  });

  it.each([
    ['a wrong password', basic(SITE_USER, 'wrong')],
    ['another user with a wrong password', basic('someone', 'wrong')],
    ['a blank user with an empty password', basic('', '')],
    ['the password given as the user name', basic(PASSWORD, '')],
    ['a prefix of the password', basic(SITE_USER, PASSWORD.slice(0, -1))],
    ['a longer password', basic(SITE_USER, `${PASSWORD}x`)],
    ['the password in another case', basic(SITE_USER, PASSWORD.toUpperCase())],
    ['no colon', `Basic ${btoa(`${SITE_USER}${PASSWORD}`)}`],
    ['the password alone with no colon', `Basic ${btoa(PASSWORD)}`],
    ['an empty password', basic(SITE_USER, '')],
    ['broken base64', 'Basic %%%not-base64%%%'],
    ['the scheme alone', 'Basic'],
    ['a bearer token', `Bearer ${PASSWORD}`],
    ['the password unencoded', `Basic ${SITE_USER}:${PASSWORD}`],
  ])('refuses %s with the same answer, saying nothing of which part was wrong', async (_case, authorization) => {
    await expectRefused(await requireSitePassword(withHeaders({ authorization }), PASSWORD, REALM));
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('refuses everything when the configured password is %s, even an empty one given', async (_case, configured) => {
    await expectRefused(await requireSitePassword(withHeaders({ authorization: basic(SITE_USER, '') }), configured, REALM));
    await expectRefused(await requireSitePassword(withHeaders({ [SITE_PASSWORD_HEADER]: '' }), configured, REALM));
    await expectRefused(await requireSitePassword(withHeaders(), configured, REALM));
  });

  it('compares SHA-256 digests, so both sides are hashed whatever their length', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest');
    try {
      await requireSitePassword(withHeaders({ authorization: basic(SITE_USER, 'x') }), PASSWORD, REALM);
      expect(digest).toHaveBeenCalledTimes(2);
      for (const call of digest.mock.calls) expect(call[0]).toBe('SHA-256');
    } finally {
      digest.mockRestore();
    }
  });
});

describe('requireSitePassword: the header for callers already using a bearer token', () => {
  it('names the header x-shytalk-site-password', () => {
    expect(SITE_PASSWORD_HEADER).toBe('x-shytalk-site-password');
  });

  it('lets the right password through beside a bearer token', async () => {
    const request = withHeaders({ [SITE_PASSWORD_HEADER]: PASSWORD, authorization: 'Bearer some-session-token' });
    expect(await requireSitePassword(request, PASSWORD, REALM)).toBeNull();
  });

  it.each([
    ['wrong', 'wrong'],
    ['empty', ''],
    ['a prefix', PASSWORD.slice(0, -1)],
    ['user and password together', `${SITE_USER}:${PASSWORD}`],
  ])('refuses a %s password', async (_case, value) => {
    await expectRefused(await requireSitePassword(withHeaders({ [SITE_PASSWORD_HEADER]: value }), PASSWORD, REALM));
  });

  it('refuses when the header is wrong even though the box is right: one wrong answer is enough', async () => {
    const request = withHeaders({ [SITE_PASSWORD_HEADER]: 'wrong', authorization: basic(SITE_USER, PASSWORD) });
    await expectRefused(await requireSitePassword(request, PASSWORD, REALM));
  });
});
