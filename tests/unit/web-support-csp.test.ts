import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONTENT_SECURITY_POLICY, handle, supportPolicy, type WebEnv } from '../../workers/web/src/web.ts';

/**
 * The support pages embed ShyDesk's support piece (shyden-labs/ShyTalk#37 AC1-2;
 * contract from shyden-labs/shydesk, 2026-11-22): only those pages widen the
 * Content Security Policy, and only by what the piece needs from the
 * environment's own ShyDesk host and Cloudflare Turnstile.
 */

const LIVE_SHYDESK = 'https://shydesk.dpdns.org';
const NON_PROD_SHYDESK = 'https://shydesk.shydesk-non-prod.workers.dev';

type Vars = Record<string, string>;
const vars = (name: string): Vars =>
  (JSON.parse(readFileSync('workers/web/wrangler.json', 'utf8')) as { env: Record<string, { vars: Vars }> }).env[name]?.vars ?? {};

/** A production Worker with its database marked and pages that answer 200. */
function prod(shydesk: string | null): WebEnv {
  return {
    ENVIRONMENT_NAME: 'prod',
    ...(shydesk === null ? {} : { SHYDESK_ORIGIN: shydesk }),
    DB: { prepare: () => ({ first: <T>() => Promise.resolve({ name: 'prod' } as T) }) },
    ASSETS: { fetch: () => Promise.resolve(new Response('<html></html>', { headers: { 'content-type': 'text/html' } })) },
  };
}
const policyAt = async (path: string, shydesk: string | null = LIVE_SHYDESK) =>
  (await handle(new Request(`https://shytalk.app${path}`), prod(shydesk))).headers.get('content-security-policy');

describe('each environment names its ShyDesk', () => {
  it.each([
    ['dev', NON_PROD_SHYDESK],
    ['test', LIVE_SHYDESK],
    ['prod', LIVE_SHYDESK],
  ])('%s sends support requests to %s', (name, origin) => {
    expect(vars(name)['SHYDESK_ORIGIN']).toBe(origin);
  });
});

describe('the support policy', () => {
  it('adds exactly the piece’s needs from one ShyDesk host to the site policy', () => {
    expect(supportPolicy(LIVE_SHYDESK)).toBe(
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; " +
        "script-src 'self' https://shydesk.dpdns.org https://challenges.cloudflare.com; " +
        "connect-src 'self' https://shydesk.dpdns.org; " +
        'frame-src https://challenges.cloudflare.com; ' +
        "img-src 'self' blob:; media-src 'self' blob:; " +
        "style-src 'self' 'unsafe-inline'",
    );
  });

  it.each(['/support', '/support/', '/id/support', '/zh/support', '/support/ticket', '/th/support/ticket', '/appeal', '/vi/appeal'])(
    '%s carries the support policy for the environment’s ShyDesk',
    async (path) => {
      expect(await policyAt(path)).toBe(supportPolicy(LIVE_SHYDESK));
      expect(await policyAt(path, NON_PROD_SHYDESK)).toBe(supportPolicy(NON_PROD_SHYDESK));
    },
  );

  it.each(['/', '/supportive', '/api/support', '/sign-in', '/fr/support', '/id/support-x', '/appeals', '/fr/appeal', '/appeal/x'])(
    '%s keeps the site policy',
    async (path) => {
      expect(await policyAt(path)).toBe(CONTENT_SECURITY_POLICY);
    },
  );

  it('a Worker naming no ShyDesk keeps the site policy on the support pages too', async () => {
    expect(await policyAt('/support', null)).toBe(CONTENT_SECURITY_POLICY);
  });
});
