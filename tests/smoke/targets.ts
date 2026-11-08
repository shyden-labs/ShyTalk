/**
 * The browsers the site supports, each run in CI on every pull request
 * (Shyden's ruling 2026-11-05, shyden-labs/ShyTalk#109). Each is a Playwright
 * project of the same name; the phones are shyden-labs/ShyTalk#112.
 */
export const SMOKE_TARGETS = ['chromium', 'firefox', 'webkit'] as const;

/** Where the CI smoke's stand-in for Oracle listens (tests/smoke/mail-stand-in.ts). */
export const MAIL_STAND_IN_PORT = 8788;
