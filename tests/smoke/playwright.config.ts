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

const PORT = 8787;
/** wrangler runs from the repository root, where its config paths start. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** A fresh secret per run, from CI; without one the door refuses everything, so fail first, naming it. */
const secret = process.env.SMOKE_DOOR_SECRET ?? '';
if (secret === '') throw new Error('SMOKE_DOOR_SECRET is unset: the smoke needs a door secret to send and to configure');

export default defineConfig({
  testDir: '.',
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    extraHTTPHeaders: { [DOOR_SECRET_HEADER]: secret },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx wrangler dev --config workers/web/wrangler.json --env dev --ip 127.0.0.1 --port ${String(PORT)} --var DOOR_SECRET:${secret}`,
    // Playwright counts a 403 as up: the door answers before the secret is sent.
    url: `http://127.0.0.1:${String(PORT)}/`,
    cwd: ROOT,
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
