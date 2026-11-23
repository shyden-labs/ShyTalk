import { describe, it, expect } from 'vitest';
import { SITE_PASS_COOKIE, SITE_PASS_SECONDS, requireSitePassword, sitePassCookie } from '../../packages/environment/index.ts';

/**
 * After a valid dev pass (shyden-labs/ShyTalk#263 AC1), the browser holds a
 * cookie that stands in for the password box for SITE_PASS_SECONDS. Its value
 * is `<exp>.<HMAC-SHA256(pass key, exp and the password's hash)>`: keyed by a
 * server secret, so a leaked cookie cannot be guessed back to the password
 * offline; ended by its expiry, a new password or a new key.
 */

const PASSWORD = 'the-site-password';
const KEY = 'the-dev-pass-secret';
const REALM = 'ShyTalk dev';
const NOW = 1763520000;

const withCookie = (cookie: string): Request => new Request('https://origin.example.test/', { headers: { cookie } });
const check = (cookie: string, configured: string | undefined = PASSWORD, key: string | undefined = KEY, now = NOW) =>
  requireSitePassword(withCookie(cookie), configured, REALM, { key, now });

async function expectAsked(answer: Response | null): Promise<void> {
  expect(answer?.status).toBe(401);
  expect(answer?.headers.get('www-authenticate')).toBe(`Basic realm="${REALM}", charset="UTF-8"`);
  expect(await answer?.text()).toBe('Unauthorized');
}

describe('the site pass cookie', () => {
  it('is named shytalk_site_pass and lasts 12 hours', () => {
    expect(SITE_PASS_COOKIE).toBe('shytalk_site_pass');
    expect(SITE_PASS_SECONDS).toBe(12 * 60 * 60);
  });

  it('lets a request holding it through, as the right password would', async () => {
    expect(await check(`${SITE_PASS_COOKIE}=${await sitePassCookie(PASSWORD, KEY, NOW + 60)}`)).toBeNull();
  });

  it('is found among other cookies', async () => {
    expect(await check(`a=1; ${SITE_PASS_COOKIE}=${await sitePassCookie(PASSWORD, KEY, NOW + 60)}; b=2`)).toBeNull();
  });

  it('lets a request through in its last second and asks with the box after it', async () => {
    const cookie = `${SITE_PASS_COOKIE}=${await sitePassCookie(PASSWORD, KEY, NOW)}`;
    expect(await check(cookie, PASSWORD, KEY, NOW)).toBeNull();
    await expectAsked(await check(cookie, PASSWORD, KEY, NOW + 1));
  });

  it('carries its expiry and never the password', async () => {
    const value = await sitePassCookie(PASSWORD, KEY, NOW + 60);
    expect(value.startsWith(`${NOW + 60}.`)).toBe(true);
    expect(value).not.toContain(PASSWORD);
  });

  it('changes with the key, the password and the expiry', async () => {
    const value = await sitePassCookie(PASSWORD, KEY, NOW + 60);
    expect(await sitePassCookie(PASSWORD, KEY, NOW + 60)).toBe(value);
    expect(await sitePassCookie(PASSWORD, `${KEY}2`, NOW + 60)).not.toBe(value);
    expect(await sitePassCookie(`${PASSWORD}2`, KEY, NOW + 60)).not.toBe(value);
    expect((await sitePassCookie(PASSWORD, KEY, NOW + 61)).split('.')[1]).not.toBe(value.split('.')[1]);
  });

  it('asks with the box for a cookie whose expiry was moved later', async () => {
    const [, signature = ''] = (await sitePassCookie(PASSWORD, KEY, NOW)).split('.');
    await expectAsked(await check(`${SITE_PASS_COOKIE}=${NOW + 3600}.${signature}`, PASSWORD, KEY, NOW + 1));
  });

  it('asks with the box for a cookie made before the password changed', async () => {
    await expectAsked(await check(`${SITE_PASS_COOKIE}=${await sitePassCookie('the-old-password', KEY, NOW + 60)}`));
  });

  it('asks with the box for a cookie made with another key', async () => {
    await expectAsked(await check(`${SITE_PASS_COOKIE}=${await sitePassCookie(PASSWORD, 'another-key', NOW + 60)}`));
  });

  it.each([
    ['a wrong value', () => Promise.resolve(`${SITE_PASS_COOKIE}=nope`)],
    ['an empty value', () => Promise.resolve(`${SITE_PASS_COOKIE}=`)],
    ['no signature', () => Promise.resolve(`${SITE_PASS_COOKIE}=${NOW + 60}.`)],
    ['an expiry that is not a number', async () => `${SITE_PASS_COOKIE}=x${await sitePassCookie(PASSWORD, KEY, NOW + 60)}`],
    ['the value under another name', async () => `other=${await sitePassCookie(PASSWORD, KEY, NOW + 60)}`],
    [
      'the value under a name that only ends in its name',
      async () => `x_${SITE_PASS_COOKIE}=${await sitePassCookie(PASSWORD, KEY, NOW + 60)}`,
    ],
    ['the password itself as the value', () => Promise.resolve(`${SITE_PASS_COOKIE}=${PASSWORD}`)],
  ])('asks with the box for %s', async (_case, cookie) => {
    await expectAsked(await check(await cookie()));
  });

  it.each([
    ['the configured password is unset', undefined, KEY],
    ['the configured password is empty', '', KEY],
    ['the key is unset', PASSWORD, undefined],
    ['the key is empty', PASSWORD, ''],
  ])('lets no cookie through while %s', async (_case, configured, key) => {
    const cookie = `${SITE_PASS_COOKIE}=${await sitePassCookie(configured ?? '', key || 'k', NOW + 60)}`;
    await expectAsked(await check(cookie, configured, key));
  });

  it('lets no cookie through when the caller gives no pass key at all, as on test and production', async () => {
    const cookie = `${SITE_PASS_COOKIE}=${await sitePassCookie(PASSWORD, KEY, NOW + 60)}`;
    await expectAsked(await requireSitePassword(withCookie(cookie), PASSWORD, REALM));
  });
});
