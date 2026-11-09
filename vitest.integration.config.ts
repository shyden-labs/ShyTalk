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
    globalSetup: ['tests/integration/global-setup.ts', 'tests/setup/id-token-keys.ts'],
    // Every file opens the same local D1 (the global setup's `d1Persist`), so
    // files run one at a time: in parallel, their workerd processes write the
    // one SQLite file at once and D1 answers SQLITE_BUSY (PR #120's first run,
    // shyden-labs/ShyTalk#79).
    fileParallelism: false,
    testTimeout: 10_000,
    hookTimeout: 60_000,
  },
} satisfies ViteUserConfig;
