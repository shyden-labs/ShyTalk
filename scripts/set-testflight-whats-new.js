#!/usr/bin/env node
'use strict';

/**
 * set-testflight-whats-new.js — SHY-0361, the iOS half of "tester notes name
 * the ticket": puts the note scripts/tester-notes.js wrote into the build's
 * TestFlight "What to Test" text.
 *
 * App Store Connect lists an uploaded build only some minutes after altool
 * accepts it, so the script looks every 30 s and fails at 15 min, naming the
 * build it waited for (Shyden, 2026-10-14). A refusal from Apple fails at once:
 * a real notes fault turns the deploy job red (Shyden, 2026-10-14).
 *
 * Run after "Upload to TestFlight" in deploy-dev.yml. Env: the App Store
 * Connect credentials (see app-store-connect.js), TESTER_NOTES_FILE,
 * BUILD_NUMBER, MARKETING_VERSION, optional BUNDLE_ID.
 */

const WAIT_INTERVAL_MS = 30_000;
const WAIT_CEILING_MS = 15 * 60_000;
const LOCALE = 'en-US';

async function appIdFor(asc, bundleId) {
  const apps = await asc('GET', `/v1/apps?filter[bundleId]=${bundleId}`);
  const app = apps?.data?.[0];
  if (!app) throw new Error(`no app in App Store Connect has bundle id ${bundleId}`);
  return app.id;
}

/** The id of exactly this build, waiting for App Store Connect to list it. */
async function findBuild(asc, { appId, buildNumber, marketingVersion }, clock) {
  const path =
    `/v1/builds?filter[app]=${appId}&filter[version]=${buildNumber}` +
    `&filter[preReleaseVersion.version]=${marketingVersion}&limit=2`;
  const started = clock.now();
  for (;;) {
    const builds = (await asc('GET', path))?.data ?? [];
    if (builds.length > 1) {
      throw new Error(
        `${builds.length} builds match ${buildNumber} (${marketingVersion}); expected one`,
      );
    }
    if (builds.length === 1) return builds[0].id;
    if (clock.now() - started >= WAIT_CEILING_MS) {
      throw new Error(
        `build ${buildNumber} (${marketingVersion}) did not appear in App Store Connect within ` +
          `${WAIT_CEILING_MS / 60_000} min`,
      );
    }
    console.log(
      `build ${buildNumber} not listed yet; looking again in ${WAIT_INTERVAL_MS / 1000} s`,
    );
    await clock.wait(WAIT_INTERVAL_MS);
  }
}

/** Write `text` as the build's en-US "What to Test"; 'updated' or 'created'. */
async function setWhatsNew(asc, { buildId, text }) {
  if (!text || text.trim() === '') throw new Error('refusing to set an empty What to Test text');
  const existing = (await asc('GET', `/v1/builds/${buildId}/betaBuildLocalizations`))?.data ?? [];
  const mine = existing.find((l) => l.attributes?.locale === LOCALE);
  if (mine) {
    await asc('PATCH', `/v1/betaBuildLocalizations/${mine.id}`, {
      data: { type: 'betaBuildLocalizations', id: mine.id, attributes: { whatsNew: text } },
    });
    return 'updated';
  }
  await asc('POST', '/v1/betaBuildLocalizations', {
    data: {
      type: 'betaBuildLocalizations',
      attributes: { locale: LOCALE, whatsNew: text },
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    },
  });
  return 'created';
}

async function main(env = process.env) {
  const fs = require('node:fs');
  const { clientFromEnv } = require('./app-store-connect.js');
  for (const name of ['TESTER_NOTES_FILE', 'BUILD_NUMBER', 'MARKETING_VERSION']) {
    if (!env[name]) throw new Error(`${name} is required`);
  }
  const text = fs.readFileSync(env.TESTER_NOTES_FILE, 'utf8');
  const asc = clientFromEnv(env);
  const appId = await appIdFor(asc, env.BUNDLE_ID || 'com.shyden.shytalk');
  const clock = { now: () => Date.now(), wait: (ms) => new Promise((r) => setTimeout(r, ms)) };
  const buildId = await findBuild(
    asc,
    { appId, buildNumber: env.BUILD_NUMBER, marketingVersion: env.MARKETING_VERSION },
    clock,
  );
  const how = await setWhatsNew(asc, { buildId, text });
  console.log(`What to Test ${how} on build ${env.BUILD_NUMBER} (${env.MARKETING_VERSION})`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`::error::set-testflight-whats-new: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { WAIT_CEILING_MS, WAIT_INTERVAL_MS, appIdFor, findBuild, setWhatsNew };
