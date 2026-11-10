/**
 * The CI smoke of the site (plan 3 Task 1, shyden-labs/ShyTalk#51 AC4): the
 * built pages (`npm run build:web`) served by the real web Worker under
 * `wrangler dev` as DEV, so every request passes the real door. CI only: the
 * laptop runs unit tests, types, lint and format. Typed against the DOM
 * (tests/smoke/tsconfig.json), which Playwright's own types need.
 */
import { defineConfig, devices } from '@playwright/test';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DOOR_SECRET_HEADER } from '../../packages/environment/index.ts';
import { SMOKE_REPORT } from '../../scripts/smoke-totals.ts';
import { MAIL_STAND_IN_PORT, SMOKE_TARGETS } from './targets.ts';

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

/**
 * The sender signs every request, so it needs settings and a real key even for
 * the stand-in (tests/smoke/mail-stand-in.ts). A throwaway key each run, on one
 * line for the shell; the sender's parser ignores white space inside it.
 */
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const MAIL_VARS = [
  `MAIL_ENDPOINT:http://127.0.0.1:${String(MAIL_STAND_IN_PORT)}/submit`,
  'OCI_TENANCY:smoke',
  'OCI_USER:smoke',
  'OCI_FINGERPRINT:smoke',
  'OCI_COMPARTMENT:smoke',
  `OCI_PRIVATE_KEY:${privateKey.trim().replace(/\n/g, ' ')}`,
  // Email codes (shyden-labs/ShyTalk#133) need Better Auth's secret to key their hashes: a throwaway one each run.
  `BETTER_AUTH_SECRET:${randomBytes(32).toString('hex')}`,
  // The authenticator app's sign-in seals its secrets with TOTP_KEY (shyden-labs/ShyTalk#134): a throwaway one each run.
  `TOTP_KEY:${randomBytes(32).toString('hex')}`,
]
  .map((value) => `--var "${value}"`)
  .join(' ');

export default defineConfig({
  testDir: '.',
  forbidOnly: true,
  retries: 0,
  // scripts/smoke-totals.ts reads the JSON report from the repository root;
  // Playwright resolves a relative outputFile from this config's folder, so it is made absolute.
  reporter: [['list'], ['json', { outputFile: `${ROOT}${SMOKE_REPORT}` }]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    extraHTTPHeaders: { [DOOR_SECRET_HEADER]: secret },
  },
  // Locally no Cloudflare sets the connecting address, so every request would share SIGN_IN_LIMIT's one 'unknown' key
  // (10 a minute); each browser gets its own documentation-range address (RFC 5737) to stay inside it.
  projects: SMOKE_TARGETS.map((name, index) => ({
    name,
    // A project's headers replace the top-level ones, so the door secret is repeated here.
    use: {
      ...devices[DEVICE[name]],
      extraHTTPHeaders: { [DOOR_SECRET_HEADER]: secret, 'cf-connecting-ip': `198.51.100.${String(index + 1)}` },
    },
  })),
  webServer: [
    {
      command: `node tests/smoke/mail-stand-in.ts ${String(MAIL_STAND_IN_PORT)}`,
      url: `http://127.0.0.1:${String(MAIL_STAND_IN_PORT)}/health`,
      cwd: ROOT,
      reuseExistingServer: false,
    },
    {
      command: [
        `npx wrangler d1 migrations apply DB ${LOCAL_D1}`,
        `npx wrangler d1 execute DB ${LOCAL_D1} --command "${MARKER_SQL}"`,
        `npx wrangler dev --config workers/web/wrangler.json --env dev --persist-to .wrangler/smoke-state --ip 127.0.0.1 --port ${String(PORT)} --var DOOR_SECRET:${secret} ${MAIL_VARS}`,
      ].join(' && '),
      // Playwright counts a 403 as up: the door answers before the secret is sent.
      url: `http://127.0.0.1:${String(PORT)}/`,
      cwd: ROOT,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
  ],
});
