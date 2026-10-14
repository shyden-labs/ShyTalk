#!/usr/bin/env node
/**
 * Ensure every internal TestFlight beta group has auto-distribution enabled.
 *
 * After PR #372 restored TestFlight uploads, builds were arriving in App
 * Store Connect but not reaching internal testers — the group's
 * "Enable automatic distribution" toggle was either off, or builds were
 * stuck in "Missing Compliance" (fixed in fix/ios-encryption-compliance).
 *
 * Run as a CI step after `xcrun altool --upload-app` succeeds. Idempotent —
 * if a group already has hasAccessToAllBuilds=true, it logs and moves on.
 *
 * Required env:
 *   APP_STORE_CONNECT_KEY_ID — the API key ID (10-char string)
 *   APP_STORE_CONNECT_ISSUER_ID — the issuer ID (UUID)
 *   APP_STORE_CONNECT_KEY_PATH — path to the .p8 file (defaults to
 *     $RUNNER_TEMP/private_keys/AuthKey_<KEY_ID>.p8 — same path
 *     setup-ios-signing writes to as of Phase-0 #63; falls back to the
 *     legacy ~/private_keys/ path so this script also works during the
 *     deploy-workflow rollout window)
 *
 * Optional env:
 *   BUNDLE_ID — defaults to com.shyden.shytalk
 */

const { clientFromEnv } = require('./app-store-connect.js');

const BUNDLE_ID = process.env.BUNDLE_ID || 'com.shyden.shytalk';

(async () => {
  // SHY-0361: the client (key lookup, JWT, errors) is shared with
  // set-testflight-whats-new.js in app-store-connect.js.
  const asc = clientFromEnv();
  console.log(`Looking up app for bundle ID: ${BUNDLE_ID}`);
  const apps = await asc('GET', `/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
  if (!apps.data || apps.data.length === 0) {
    console.error(`::error::No app found in App Store Connect with bundle ID ${BUNDLE_ID}`);
    process.exit(1);
  }
  const app = apps.data[0];
  console.log(`Found app "${app.attributes.name}" (id=${app.id})`);

  // Limit=200 is well above the ~5-20 groups any sane app has.
  const groups = await asc('GET', `/v1/apps/${app.id}/betaGroups?limit=200`);
  const internalGroups = (groups.data || []).filter((g) => g.attributes.isInternalGroup);
  if (internalGroups.length === 0) {
    console.warn(
      '::warning::No internal beta groups found. Create one in App Store Connect → TestFlight → Internal Group.',
    );
    return;
  }
  console.log(`Found ${internalGroups.length} internal group(s):`);

  let fixedCount = 0;
  for (const group of internalGroups) {
    const { id } = group;
    const { name, hasAccessToAllBuilds } = group.attributes;
    if (hasAccessToAllBuilds) {
      console.log(`  ✓ "${name}" — auto-distribution already on`);
      continue;
    }
    console.log(`  ⚠ "${name}" — auto-distribution OFF, enabling…`);
    await asc('PATCH', `/v1/betaGroups/${id}`, {
      data: {
        type: 'betaGroups',
        id,
        attributes: { hasAccessToAllBuilds: true },
      },
    });
    console.log(`  ✓ "${name}" — auto-distribution enabled`);
    fixedCount++;
  }
  if (fixedCount > 0) {
    console.log(`Enabled auto-distribution on ${fixedCount} group(s).`);
  } else {
    console.log('All internal groups already have auto-distribution enabled.');
  }
})().catch((err) => {
  console.error(`::error::${err.message}`);
  process.exit(1);
});
