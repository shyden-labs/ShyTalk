// Warnings are build failures (global rule; issue shyden-labs/repo-template#138). Every suite's config
// carries `failOnWarnings`, and its setup registers `failOnNodeWarning`.
// No imports at run time: each test file that reads a config loads this too.
import type { Plugin } from 'vite';

function failure(message: string): Error {
  return new Error(`a warning is a build failure (global rule; #138): ${message}`);
}

/**
 * Wraps the logger vitest hands vite, so a vite warning (a dynamic import it
 * cannot analyse, say) fails the file whose transform raised it.
 */
export const failOnWarnings: Plugin = {
  name: 'fail-on-warnings',
  configResolved({ logger }) {
    logger.warn = (message) => {
      throw failure(message);
    };
    logger.warnOnce = (message) => {
      throw failure(message);
    };
  },
};

/** Where a warning came from: the first frame of its stack outside node's own internals, so a red pull request names the package (shyden-labs/repo-template#143). */
function source(warning: Error): string {
  const frame = (warning.stack ?? '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .find((line) => line.startsWith('at ') && !line.includes('(node:') && !line.startsWith('at node:'));
  return frame === undefined ? '' : ` (${frame})`;
}

/** The `warning` listener each suite's setup registers: a node warning fails the run, naming where it came from. */
export function failOnNodeWarning(warning: Error): never {
  throw failure(`${warning.name}: ${warning.message}${source(warning)}`);
}
