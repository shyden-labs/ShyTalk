import { describe, it, expect } from 'vitest';
import unit from '../../vitest.unit.config.ts';
import { NODE_WARNINGS, UNIT_REFUSAL, UNIT_SETUP } from '../setup/files.ts';
import { failOnNodeWarning, failOnWarnings } from '../setup/warnings.ts';

/**
 * Warnings are build failures (global rule; issue shyden-labs/repo-template#138). A vite warning, such
 * as a dynamic import it cannot analyse, fails the file that caused it,
 * through a plugin that wraps the logger vitest hands vite. A node warning
 * (process.emitWarning) fails the run, through a listener each suite's setup
 * registers. Every suite's config carries both.
 */

type Logger = Record<'warn' | 'warnOnce', (message: string) => void>;

/**
 * Hands the plugin a logger the way vite does once its config is resolved.
 * It starts empty: the plugin supplies both methods, so no stand-in is left unrun.
 */
function resolved(): Logger {
  const config = { logger: {} as Logger };
  (failOnWarnings.configResolved as (resolvedConfig: { logger: Logger }) => void)(config);
  return config.logger;
}

describe('failOnWarnings', () => {
  it.each(['warn', 'warnOnce'] as const)("turns vite's logger.%s into a failure naming the warning", (level) => {
    expect(() => {
      resolved()[level]('invalid import "../../${config}"');
    }).toThrow('a warning is a build failure (global rule; #138): invalid import "../../${config}"');
  });
});

describe('failOnNodeWarning names where the warning came from (#143)', () => {
  const warning = (stack: string | undefined) => Object.assign(new Error('x'), { name: 'DeprecationWarning', stack });

  it("names the first frame outside node's own internals, so a red pull request names the package", () => {
    const stack = [
      'DeprecationWarning: x',
      '    at emitWarning (node:internal/process/warning:1:1)',
      '    at Object.<anonymous> (/repo/node_modules/old-pkg/index.js:3:9)',
      '    at Module._compile (node:internal/modules/cjs/loader:1:1)',
    ].join('\n');
    expect(() => failOnNodeWarning(warning(stack))).toThrow(
      /^a warning is a build failure \(global rule; #138\): DeprecationWarning: x \(at Object\.<anonymous> \(\/repo\/node_modules\/old-pkg\/index\.js:3:9\)\)$/,
    );
  });

  it('skips the lines of a message that runs over more than one line', () => {
    expect(() => failOnNodeWarning(warning('DeprecationWarning: x\nsecond line\n    at f (/repo/a.js:1:1)'))).toThrow(
      /: DeprecationWarning: x \(at f \(\/repo\/a\.js:1:1\)\)$/,
    );
  });

  it("skips node's own frames written with no function name", () => {
    expect(() =>
      failOnNodeWarning(
        warning('DeprecationWarning: x\n    at node:internal/main/run_main_module:1:1\n    at /repo/node_modules/old-pkg/cli.js:2:5'),
      ),
    ).toThrow(/: DeprecationWarning: x \(at \/repo\/node_modules\/old-pkg\/cli\.js:2:5\)$/);
  });

  it("names no frame when every frame is node's own", () => {
    expect(() => failOnNodeWarning(warning('DeprecationWarning: x\n    at emitWarning (node:internal/process/warning:1:1)'))).toThrow(
      /: DeprecationWarning: x$/,
    );
  });

  it('names no frame when the warning has no stack', () => {
    expect(() => failOnNodeWarning(warning(undefined))).toThrow(/: DeprecationWarning: x$/);
  });
});

describe('failOnNodeWarning', () => {
  it('fails naming the warning and its name', () => {
    expect(() => failOnNodeWarning(Object.assign(new Error('Buffer() is deprecated'), { name: 'DeprecationWarning' }))).toThrow(
      'a warning is a build failure (global rule; #138): DeprecationWarning: Buffer() is deprecated',
    );
  });

  it('is listening in this very run, so the setup really registered it', () => {
    expect(process.listeners('warning')).toContain(failOnNodeWarning);
  });
});

describe('the unit suite fails on warnings', () => {
  it('carries the vite plugin', () => {
    expect(unit.plugins).toContain(failOnWarnings);
  });

  it('registers the node warning listener', () => {
    expect(unit.test.setupFiles).toContain(NODE_WARNINGS);
  });

  it('keeps the unit refusal first, so nothing a file loads runs before it', () => {
    expect([UNIT_SETUP[0], UNIT_SETUP.includes(NODE_WARNINGS)]).toEqual([UNIT_REFUSAL, true]);
  });
});
