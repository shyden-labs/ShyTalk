import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  APPEAL_PATH,
  arrivedFromSite,
  browserLocale,
  shydeskOrigin,
  SUPPORT_PATH,
  TICKET_PATH,
  type WranglerShydesk,
} from '../../apps/web/src/support.ts';

/**
 * The support pages (shyden-labs/ShyTalk#37): built for one environment, each
 * embeds that environment's ShyDesk; the one language-free ticket page picks
 * the visitor's language from the browser, as ShyDesk's emailed link carries
 * no language.
 */

const wrangler = JSON.parse(readFileSync('workers/web/wrangler.json', 'utf8')) as WranglerShydesk;

describe('the ShyDesk a build embeds', () => {
  it.each([
    ['dev', 'https://shydesk.shydesk-non-prod.workers.dev'],
    ['test', 'https://shydesk.dpdns.org'],
    ['prod', 'https://shydesk.dpdns.org'],
  ])('a %s build embeds %s, the Worker’s own SHYDESK_ORIGIN', (environment, origin) => {
    expect(shydeskOrigin(environment, wrangler)).toBe(origin);
  });

  it('a build naming no environment stops, naming why', () => {
    expect(() => shydeskOrigin(undefined, wrangler)).toThrow('SITE_ENVIRONMENT is unset');
    expect(() => shydeskOrigin('', wrangler)).toThrow('SITE_ENVIRONMENT is unset');
  });

  it('a build for an environment whose Worker names no ShyDesk stops, naming it', () => {
    expect(() => shydeskOrigin('dev', { env: { dev: { vars: {} } } })).toThrow('workers/web/wrangler.json gives dev no SHYDESK_ORIGIN');
    expect(() => shydeskOrigin('staging', wrangler)).toThrow('workers/web/wrangler.json gives staging no SHYDESK_ORIGIN');
  });
});

describe('the pages’ paths', () => {
  it('are /support and the language-free /support/ticket ShyDesk’s settings name', () => {
    expect([SUPPORT_PATH, TICKET_PATH]).toEqual(['/support', '/support/ticket']);
  });

  it('include the language-free /appeal a punishment notice links to (shyden-labs/ShyTalk#310 AC4)', () => {
    expect(APPEAL_PATH).toBe('/appeal');
  });
});

describe('the ticket page’s language, from the browser', () => {
  it.each([
    [['th-TH', 'en-US'], 'th'],
    [['zh-Hant-TW'], 'zh'],
    [['ID'], 'id'],
    [['fr-FR', 'vi'], 'vi'],
    [['fr-FR'], 'en'],
    [[], 'en'],
    [['constructor'], 'en'],
  ] as const)('%j reads as %s', (languages, locale) => {
    expect(browserLocale(languages)).toBe(locale);
  });
});

// shyden-labs/ShyTalk#352: a visitor who came from the site's own language menu chose the page's language; an emailed or
// notice link, from a mail app or another site or none, is moved to the browser's language.
describe('whether the visitor came from the site itself', () => {
  const SITE = 'https://site.example.test';

  it('is true for a page of the same site, whatever its path', () => {
    expect(arrivedFromSite(`${SITE}/th/support/ticket`, SITE)).toBe(true);
    expect(arrivedFromSite(`${SITE}/`, SITE)).toBe(true);
  });

  it.each([
    ['no referrer', ''],
    ['another site', 'https://mail.example.com/inbox'],
    ['the same host on another scheme', 'http://site.example.test/'],
    ['another port', 'https://site.example.test:8443/'],
    ['a subdomain', 'https://evil.site.example.test/'],
    ['what is not an address', 'not a url'],
  ])('is false for %s', (_, referrer) => {
    expect(arrivedFromSite(referrer, SITE)).toBe(false);
  });
});
