// The unit suite's setup files, named once for the unit config and the tests that pin it.

/** Refuses every process start and connection; first, so nothing a file loads runs before it. */
export const UNIT_REFUSAL = 'tests/setup/unit-refusal.ts';
/** Fails the run on a node warning (shyden-labs/repo-template#138). */
export const NODE_WARNINGS = 'tests/setup/node-warnings.ts';

export const UNIT_SETUP = [UNIT_REFUSAL, NODE_WARNINGS];
