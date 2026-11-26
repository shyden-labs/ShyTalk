/**
 * The CI smoke of the site (plan 3 Task 1, shyden-labs/ShyTalk#51 AC4): the
 * built pages (`npm run build:web`) served by the real web Worker under
 * `wrangler dev` as DEV, so every request passes the real door. CI only: the
 * laptop runs unit tests, types, lint and format. Typed against the DOM
 * (tests/smoke/tsconfig.json), which Playwright's own types need.
 */
import { defineConfig } from '@playwright/test';
import { desktopProjects } from '@shyden-labs/playwright-devices/desktop';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DOOR_SECRET_HEADER, SITE_USER } from '../../packages/environment/index.ts';
import { GITHUB_STAND_IN_PORT, MAIL_STAND_IN_PORT, SMOKE_TARGETS, roadmapWebhookSecret, shydeskCallbackSecret } from './targets.ts';

const PORT = 8787;
/**
 * Served over https, as every real environment is: DEV's https SITE_ORIGIN makes
 * Better Auth's session cookie `Secure`, which Playwright's WebKit refuses over
 * plain http even on 127.0.0.1 (shyden-labs/ShyTalk#134). wrangler makes its
 * own self-signed certificate, so the browsers and the readiness check ignore
 * certificate errors.
 */
const SITE = `https://127.0.0.1:${String(PORT)}`;

/** wrangler runs from the repository root, where its config paths start. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** A fresh secret per run, from CI; without one the door refuses everything, so fail first, naming it. */
const secret = process.env.SMOKE_DOOR_SECRET ?? '';
if (secret === '') throw new Error('SMOKE_DOOR_SECRET is unset: the smoke needs a door secret to send and to configure');

/**
 * DEV asks for its site password with the browser's own box (shyden-labs/ShyTalk#262); each browser answers the box
 * with it, as a person would. A fresh one per run, from CI; fail first, naming it.
 */
const password = process.env.SMOKE_SITE_PASSWORD ?? '';
if (password === '') throw new Error('SMOKE_SITE_PASSWORD is unset: the smoke needs a site password to give and to configure');

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

/**
 * The roadmap (shyden-labs/ShyTalk#321) reads the board from GitHub's stand-in (tests/smoke/github-stand-in.ts) as
 * its App, so it needs a real key to sign with: a throwaway one each run, PKCS#1 as GitHub hands them out. Its webhook
 * secret is made from the door secret, so the tests that sign a delivery know it too.
 */
const roadmapKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
const ROADMAP_VARS = [
  `ROADMAP_GITHUB_API:http://127.0.0.1:${String(GITHUB_STAND_IN_PORT)}`,
  `ROADMAP_APP_KEY:${roadmapKey.trim().replace(/\n/g, ' ')}`,
  `ROADMAP_WEBHOOK_SECRET:${roadmapWebhookSecret(secret)}`,
  // ShyDesk's callback, so the sign-in journey can suspend its member (shyden-labs/ShyTalk#343 AC2).
  `SHYDESK_CALLBACK_SECRET:${shydeskCallbackSecret(secret)}`,
]
  .map((value) => `--var "${value}"`)
  .join(' ');

/**
 * DEV's pass key, a throwaway one each run, as DEV has one: with it, the box's answer earns the site pass cookie, which
 * WebKit's WebSocket upgrade carries where it gives no box answer (shyden-labs/ShyTalk#321). Sign-ups are open, as
 * DEV's switch is (shyden-labs/ShyTalk#314).
 */
const PASS_VARS = `--var DEV_PASS_SECRET:${randomBytes(32).toString('base64url')} --var SIGNUPS_OPEN:true`;

export default defineConfig({
  testDir: '.',
  forbidOnly: true,
  retries: 0,
  // CI's one-suite check (shyden-labs/ShyTalk#239) reads the JSON report and the shared package's assertion counts
  // from the repository root; Playwright resolves a relative outputFile from this config's folder, so each is absolute.
  reporter: [
    ['list'],
    ['json', { outputFile: `${ROOT}test-results/smoke-report.json` }],
    ['@shyden-labs/playwright-devices/assertion-counter', { outputFile: `${ROOT}test-results/smoke-assertions.json` }],
  ],
  use: {
    baseURL: SITE,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { [DOOR_SECRET_HEADER]: secret },
    httpCredentials: { username: SITE_USER, password },
  },
  // Locally no Cloudflare sets the connecting address, so every request would share SIGN_IN_LIMIT's one 'unknown' key
  // (10 a minute); each browser gets its own documentation-range address (RFC 5737) to stay inside it.
  // Each browser's project comes from the shared package (shyden-labs/ShyTalk#239): a real desktop browser, no
  // phone emulation.
  projects: desktopProjects(SMOKE_TARGETS).map((project, index) => ({
    ...project,
    // A project's headers replace the top-level ones, so the door secret is repeated here.
    use: {
      ...project.use,
      // Chromium and Edge refused wrangler's self-signed certificate at the TLS layer before ignoreHTTPSErrors let the
      // request through, so the local server logged ~290 `CertificateUnknown` lines a run (shyden-labs/ShyTalk#316: all
      // 292 measured were theirs). The site is still served over https.
      ...(project.use?.defaultBrowserType === 'chromium' ? { launchOptions: { args: ['--ignore-certificate-errors'] } } : {}),
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
      command: `node tests/smoke/github-stand-in.ts ${String(GITHUB_STAND_IN_PORT)}`,
      url: `http://127.0.0.1:${String(GITHUB_STAND_IN_PORT)}/health`,
      cwd: ROOT,
      reuseExistingServer: false,
    },
    {
      command: [
        `npx wrangler d1 migrations apply DB ${LOCAL_D1}`,
        `npx wrangler d1 execute DB ${LOCAL_D1} --command "${MARKER_SQL}"`,
        `npx wrangler dev --config workers/web/wrangler.json --env dev --persist-to .wrangler/smoke-state --ip 127.0.0.1 --port ${String(PORT)} --local-protocol https --var DOOR_SECRET:${secret} --var SITE_PASSWORD:${password} ${MAIL_VARS} ${ROADMAP_VARS} ${PASS_VARS}`,
      ].join(' && '),
      // Playwright counts a 403 as up: the door answers before the secret is sent (and a 401 for the password after it).
      url: `${SITE}/`,
      ignoreHTTPSErrors: true,
      cwd: ROOT,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
  ],
});
