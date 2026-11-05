/**
 * The CI smoke of the site (plan 3 Task 1, shyden-labs/ShyTalk#51 AC4): the
 * built pages (`npm run build:web`) served by the real web Worker under
 * `wrangler dev` as DEV, so every request passes the real door. CI only: the
 * laptop runs unit tests, types, lint and format. Typed against the DOM
 * (tests/smoke/tsconfig.json), which Playwright's own types need.
 */
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { DOOR_SECRET_HEADER } from '../../packages/environment/index.ts';
import { SMOKE_REPORT } from '../../scripts/smoke-totals.ts';
import { SMOKE_TARGETS } from './targets.ts';

const PORT = 8787;

/** Each target's desktop browser (shyden-labs/ShyTalk#109); the suite runs unchanged on all of them. */
const DEVICE = { chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' } as const;
/** wrangler runs from the repository root, where its config paths start. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** A fresh secret per run, from CI; without one the door refuses everything, so fail first, naming it. */
const secret = process.env.SMOKE_DOOR_SECRET ?? '';
if (secret === '') throw new Error('SMOKE_DOOR_SECRET is unset: the smoke needs a door secret to send and to configure');

/**
 * The site answers 503 until its `DB` marks this environment (plan 4 Task 2,
 * shyden-labs/ShyTalk#75), so the smoke readies its local database as
 * deploy-dev readies dev's: migrations, then the marker. One local state
 * folder for all three commands; the marker write is idempotent.
 */
const LOCAL_D1 = `--config workers/web/wrangler.json --env dev --local --persist-to .wrangler/smoke-state`;
const MARKER_SQL =
  "CREATE TABLE IF NOT EXISTS environment_marker (name TEXT NOT NULL); INSERT INTO environment_marker (name) SELECT 'dev' WHERE NOT EXISTS (SELECT 1 FROM environment_marker);";

export default defineConfig({
  testDir: '.',
  forbidOnly: true,
  retries: 0,
  // The JSON report is read by scripts/smoke-totals.ts, from the repository root.
  reporter: [['list'], ['json', { outputFile: SMOKE_REPORT }]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    extraHTTPHeaders: { [DOOR_SECRET_HEADER]: secret },
  },
  projects: SMOKE_TARGETS.map((name) => ({ name, use: { ...devices[DEVICE[name]] } })),
  webServer: {
    command: [
      `npx wrangler d1 migrations apply DB ${LOCAL_D1}`,
      `npx wrangler d1 execute DB ${LOCAL_D1} --command "${MARKER_SQL}"`,
      `npx wrangler dev --config workers/web/wrangler.json --env dev --persist-to .wrangler/smoke-state --ip 127.0.0.1 --port ${String(PORT)} --var DOOR_SECRET:${secret}`,
    ].join(' && '),
    // Playwright counts a 403 as up: the door answers before the secret is sent.
    url: `http://127.0.0.1:${String(PORT)}/`,
    cwd: ROOT,
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
