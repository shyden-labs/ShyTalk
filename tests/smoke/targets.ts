import { createHash } from 'node:crypto';

/**
 * The desktop browsers the site supports, each run in CI on every pull request
 * (Shyden's ruling 2026-11-05, shyden-labs/ShyTalk#109; Edge from shyden-labs/ShyTalk#239).
 * Each is a Playwright project of the same name from the shared package's
 * `desktopProjects`; the phones are shyden-labs/ShyTalk#112.
 */
export const SMOKE_TARGETS = ['chromium', 'firefox', 'webkit', 'msedge'] as const;

/** Where the CI smoke's stand-in for Oracle listens (tests/smoke/mail-stand-in.ts). */
export const MAIL_STAND_IN_PORT = 8788;

/** Where the CI smoke's stand-in for GitHub's API listens (tests/smoke/github-stand-in.ts; shyden-labs/ShyTalk#321). */
export const GITHUB_STAND_IN_PORT = 8790;

/**
 * The roadmap webhook's secret for one CI smoke run (shyden-labs/ShyTalk#321): the run's door secret hashed under its
 * own label, so the Worker and every Playwright process, each of which reads this file afresh, agree on it with
 * nothing more to pass.
 */
export function roadmapWebhookSecret(doorSecret: string): string {
  return createHash('sha256').update(`shytalk-smoke-roadmap-webhook:${doorSecret}`).digest('hex');
}

/**
 * The secret the live roadmap test signs its delivery with: the phone run's (DEV's own, as SMOKE_ROADMAP_WEBHOOK_SECRET),
 * else the CI run's, made from its door secret; failing by name when neither is set.
 */
export function smokeWebhookSecret(env: Record<string, string | undefined> = process.env): string {
  const given = env.SMOKE_ROADMAP_WEBHOOK_SECRET ?? '';
  if (given !== '') return given;
  const door = env.SMOKE_DOOR_SECRET ?? '';
  if (door !== '') return roadmapWebhookSecret(door);
  throw new Error('neither SMOKE_ROADMAP_WEBHOOK_SECRET nor SMOKE_DOOR_SECRET is set: the live roadmap test cannot sign a delivery');
}
