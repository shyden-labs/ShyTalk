import { describe, it, expect } from 'vitest';
import { SITE_PASS_COOKIE, requireSitePassword, sitePassCookie } from '../../packages/environment/index.ts';

/**
 * After a valid dev pass (shyden-labs/ShyTalk#263 AC1), the browser holds a
 * cookie that stands in for the password box. Its value is derived from the
 * site password, so changing the password ends every such cookie.
 */

const PASSWORD = 'the-site-password';
const REALM = 'ShyTalk dev';

const withCookie = (cookie: string): Request => new Request('https://origin.example.test/', { headers: { cookie } });

describe('the site pass cookie', () => {
  it('is named shytalk_site_pass', () => {
    expect(SITE_PASS_COOKIE).toBe('shytalk_site_pass');
  });

  it('lets a request holding it through, as the right password would', async () => {
    const value = await sitePassCookie(PASSWORD);
    expect(await requireSitePassword(withCookie(`${SITE_PASS_COOKIE}=${value}`), PASSWORD, REALM)).toBeNull();
  });

  it('is found among other cookies', async () => {
    const value = await sitePassCookie(PASSWORD);
    expect(await requireSitePassword(withCookie(`a=1; ${SITE_PASS_COOKIE}=${value}; b=2`), PASSWORD, REALM)).toBeNull();
  });

  it('never carries the password itself', async () => {
    expect(await sitePassCookie(PASSWORD)).not.toContain(PASSWORD);
  });

  it('is the same for one password and different for another', async () => {
    expect(await sitePassCookie(PASSWORD)).toBe(await sitePassCookie(PASSWORD));
    expect(await sitePassCookie(PASSWORD)).not.toBe(await sitePassCookie(`${PASSWORD}2`));
  });

  it.each([
    ['a wrong value', () => Promise.resolve(`${SITE_PASS_COOKIE}=nope`)],
    ['an empty value', () => Promise.resolve(`${SITE_PASS_COOKIE}=`)],
    ['a value made from another password', async () => `${SITE_PASS_COOKIE}=${await sitePassCookie('another')}`],
    ['the value under another name', async () => `other=${await sitePassCookie(PASSWORD)}`],
    ['the value under a name that only ends in its name', async () => `x_${SITE_PASS_COOKIE}=${await sitePassCookie(PASSWORD)}`],
    ['the password itself as the value', () => Promise.resolve(`${SITE_PASS_COOKIE}=${PASSWORD}`)],
  ])('asks with the box for %s', async (_case, cookie) => {
    const answer = await requireSitePassword(withCookie(await cookie()), PASSWORD, REALM);
    expect(answer?.status).toBe(401);
    expect(answer?.headers.get('www-authenticate')).toBe(`Basic realm="${REALM}", charset="UTF-8"`);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('lets no cookie through while the configured password is %s', async (_case, configured) => {
    const value = await sitePassCookie('');
    const answer = await requireSitePassword(withCookie(`${SITE_PASS_COOKIE}=${value}`), configured, REALM);
    expect(answer?.status).toBe(401);
  });
});
