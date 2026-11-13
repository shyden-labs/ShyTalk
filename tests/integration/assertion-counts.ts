/**
 * Prints the assertions each integration test ran (shyden-labs/ShyTalk#180):
 * one `assertions:` line per test, from Vitest's own count, so a merge of
 * tests can show in CI's log that no assertion was lost.
 */
import { afterEach, expect } from 'vitest';

afterEach(({ task }) => {
  console.log(`assertions: ${task.file.name} > ${task.name}: ${String(expect.getState().assertionCalls)}`);
});
