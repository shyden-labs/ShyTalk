import type { ViteUserConfig } from 'vitest/config';
import { UNIT_SETUP } from './tests/setup/files.ts';
import { failOnWarnings } from './tests/setup/warnings.ts';

// The unit suite: tests under tests/unit, 1 s per test and hook, no process or
// connection (tests/setup/unit-refusal.ts). `npm run test:coverage` runs the
// same suite with V8 coverage over the TypeScript under scripts/, held to one
// overall threshold (shyden-labs/repo-template#149). A type-only import: `defineConfig` only types the object.
export default {
  plugins: [failOnWarnings],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: UNIT_SETUP,
    testTimeout: 1_000,
    hookTimeout: 1_000,
    coverage: {
      provider: 'v8',
      include: ['scripts/**/*.ts'],
      reporter: ['text-summary', 'lcov'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
} satisfies ViteUserConfig;
