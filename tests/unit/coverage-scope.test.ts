import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import config from '../../vitest.unit.config.ts';

/**
 * The coverage figure measures every source file (shyden-labs/ShyTalk#258): a fixed list of folders let
 * `apps/web/scripts` land untested in #257 with the gate at 100%. What it leaves out is named here with a reason.
 */

const { include = [], exclude = [] } = config.test.coverage as { include?: string[]; exclude?: string[] };
const measured = (file: string): boolean =>
  include.some((pattern) => matchesGlob(file, pattern)) && !exclude.some((pattern) => matchesGlob(file, pattern));

/** Folders that hold no source of this repository: installed packages, build output, reports and local notes. */
const NOT_SOURCE = new Set([
  'node_modules',
  '.git',
  'dist',
  '.astro',
  'coverage',
  '.superpowers',
  'test-results',
  'playwright-report',
  '.wrangler',
]);

function sourceFiles(dir = '.', prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return NOT_SOURCE.has(entry.name) ? [] : sourceFiles(`${dir}/${entry.name}`, `${path}/`);
    return /\.(?:[cm]?[jt]s)$/.test(entry.name) ? [path] : [];
  });
}

/** What the figure leaves out, each with its reason. */
const LEFT_OUT: [RegExp, string][] = [
  [/^tests\//, 'the tests themselves and their helpers (helpers: shyden-labs/ShyTalk#211)'],
  [/\.d\.ts$/, 'type declarations, which hold no code'],
  [/^(?:vitest\.[a-z]+\.config\.ts|eslint\.config\.js|apps\/web\/astro\.config\.mjs)$/, 'tool configuration, run by the tools'],
];

describe('the coverage figure', () => {
  it('measures every source file in the repository but those left out with a reason', () => {
    const unmeasured = sourceFiles().filter((file) => !measured(file));
    expect(unmeasured.filter((file) => !LEFT_OUT.some(([pattern]) => pattern.test(file)))).toEqual([]);
  });

  it.each(['a-new-folder/module.ts', 'workers/a-new-worker/lib/thing.ts', 'apps/a-new-app/src/page.ts', 'tools/x.mts'])(
    'would measure %s, a file in a folder that does not exist yet',
    (file) => {
      expect(measured(file)).toBe(true);
    },
  );

  it.each(['tests/unit/x.test.ts', 'tests/phones/run.ts', 'types/globals.d.ts', 'vitest.unit.config.ts'])(
    'leaves out %s, as named',
    (file) => {
      expect(measured(file)).toBe(false);
    },
  );
});
