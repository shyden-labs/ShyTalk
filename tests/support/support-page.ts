import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shydeskOrigin, type WranglerShydesk } from '../../apps/web/src/support.ts';

/**
 * The ShyDesk the site under test was built to embed (`SITE_ENVIRONMENT`), as the build reads it
 * (shyden-labs/ShyTalk#37): called when a test runs, so a run naming no environment fails that test, naming why.
 */
export function builtShydeskOrigin(): string {
  const wrangler = readFileSync(fileURLToPath(new URL('../../workers/web/wrangler.json', import.meta.url)), 'utf8');
  return shydeskOrigin(process.env.SITE_ENVIRONMENT, JSON.parse(wrangler) as WranglerShydesk);
}

/** The token the smoke's ticket link carries, standing for the one ShyDesk mails. */
export const SMOKE_TICKET_TOKEN = 'smoke-token';

/** The token the smoke's appeal link carries, standing for the one a punishment notice links with (#310 AC4). */
export const SMOKE_APPEAL_TOKEN = 'smoke-appeal-token';
