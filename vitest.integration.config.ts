import type { ViteUserConfig } from 'vitest/config';
import { failOnWarnings } from './tests/setup/warnings.ts';

// The integration suite (shyden-labs/ShyTalk#59, the first): tests under
// tests/integration against Cloudflare's own local engines, run by
// `getPlatformProxy` from the real Wrangler config. The global setup applies
// the real migrations once (`wrangler d1 migrations apply --local`), as
// deploy-dev applies them to dev. CI only (the `integration` job): the laptop
// runs unit tests, types, lint and format.
export default {
  plugins: [failOnWarnings],
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    testTimeout: 10_000,
    hookTimeout: 60_000,
  },
} satisfies ViteUserConfig;
