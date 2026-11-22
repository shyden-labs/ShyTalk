// The app's unit suite (plan 6.1 Task 1): real React Native renders only under
// jest-expo, Vitest cannot (.superpowers/sdd/11/runner-measure.md). The same
// rules as the Vitest unit suite: 1 s per test, no process or connection
// (tests/setup/unit-refusal.ts), and the app's source held to 100%
// coverage, so the two runs over disjoint files make one overall figure.
export default {
  preset: 'jest-expo',
  rootDir: import.meta.dirname,
  testMatch: ['<rootDir>/tests/unit/**/*.test.{ts,tsx}'],
  // The refusal setup is shared with the root suite (tests/setup/refusals.ts); Babel's helpers it needs are found here.
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  setupFiles: ['<rootDir>/tests/setup/unit-refusal.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/lift-refusals.ts'],
  testTimeout: 1000,
  coverageProvider: 'v8',
  collectCoverageFrom: ['<rootDir>/src/**/*.{ts,tsx}', '<rootDir>/app.config.ts'],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text-summary', 'lcov'],
  coverageThreshold: { global: { lines: 100, branches: 100, functions: 100, statements: 100 } },
};
