import { LOCALES, type Locale } from './i18n/t.ts';

/**
 * ShyTalk's support pages (shyden-labs/ShyTalk#37), which embed ShyDesk's support piece: the contact page in every
 * language, and one language-free ticket page whose address is set in ShyDesk's settings, so the emailed link
 * (that address + `#t=<token>`) opens the member's thread.
 */
export const SUPPORT_PATH = '/support';
export const TICKET_PATH = '/support/ticket';
/** The one language-free appeal page a ShyDesk punishment notice links to, with `#appeal=<token>` (shyden-labs/ShyTalk#310). */
export const APPEAL_PATH = '/appeal';

/** The part of workers/web/wrangler.json read here. */
export interface WranglerShydesk {
  env: Record<string, { vars?: { SHYDESK_ORIGIN?: string } }>;
}

/**
 * The ShyDesk the site is built to embed, read from the Worker's own `SHYDESK_ORIGIN` for `SITE_ENVIRONMENT`, so
 * the page's script and the Worker's support policy name the same host. A build naming no environment, or one whose
 * Worker names no ShyDesk, stops.
 */
export function shydeskOrigin(environment: string | undefined, wrangler: WranglerShydesk): string {
  if (environment === undefined || environment === '') {
    throw new Error('SITE_ENVIRONMENT is unset: name the environment the site is built for (dev, prod or test)');
  }
  const origin = Object.hasOwn(wrangler.env, environment) ? wrangler.env[environment]?.vars?.SHYDESK_ORIGIN : undefined;
  if (origin === undefined || origin === '') throw new Error(`workers/web/wrangler.json gives ${environment} no SHYDESK_ORIGIN`);
  return origin;
}

function isLocale(language: string): language is Locale {
  return (LOCALES as readonly string[]).includes(language);
}

/** The first of the browser's languages the site has, by its language subtag (`zh-Hant-TW` is `zh`); English when none is. */
export function browserLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const language = tag.toLowerCase().replace(/-.*/su, '');
    if (isLocale(language)) return language;
  }
  return 'en';
}
