import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { withoutCommentLines, withoutYamlComments, withoutYamlQuotes, yamlBlock } from './source-text.ts';

/**
 * The static checks (issue shyden-labs/repo-template#61): typecheck, lint and format-check run as
 * named steps of CI's required build-and-test job and before every push, with
 * no test suite in the hook. Every text is read with its comments stripped,
 * so a check left only in a comment does not count.
 */

const json = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const scripts = (json('package.json') as { scripts: Record<string, string> }).scripts;
const ci = withoutYamlQuotes(withoutYamlComments(readFileSync('.github/workflows/ci.yml', 'utf8')));

/** Each step of a job as its name and run line ('' where it has none). */
const steps = (job: string) =>
  job
    .split(/\n(?= {6}- )/)
    .slice(1)
    .map((step) => ({
      name: /^ {6}(?:- | {2})name: (.*)/m.exec(step)?.[1] ?? '',
      run: /^ {6}(?:- | {2})run: (.*)/m.exec(step)?.[1] ?? '',
    }));

describe('package.json', () => {
  it.each([
    ['typecheck', 'tsc --noEmit -p .'],
    ['lint', 'eslint --max-warnings 0 .'],
    ['format:check', 'prettier --check .'],
    ['format', 'prettier --write .'],
    ['prepare', 'git config core.hooksPath .githooks'],
  ])('runs %s as %s', (name, command) => {
    expect(scripts[name]).toBe(command);
  });
});

describe('ci.yml', () => {
  it('runs the audit, typecheck, lint and format check as named steps of build-and-test, after the install and before the unit suite', () => {
    expect(steps(yamlBlock(ci, 'build-and-test', '  '))).toEqual([
      { name: 'The default branch is develop', run: '|' },
      { name: '', run: '' },
      { name: '', run: '|' },
      { name: '', run: '' },
      { name: '', run: 'node scripts/npm-ci.ts' },
      { name: 'Audit', run: 'npm audit --audit-level=low' },
      { name: 'Typecheck', run: 'npm run typecheck' },
      { name: 'Lint', run: 'npm run lint' },
      { name: 'Format', run: 'npm run format:check' },
      { name: '', run: 'npm run test:unit' },
    ]);
  });
});

describe('.githooks/pre-push', () => {
  // Issue shyden-labs/repo-template#65: the checks run on each pushed commit, in scripts/pre-push.ts (tested in pre-push.test.ts), never on the working tree.
  it('hands the push, stdin included, to the script that checks each pushed commit, and runs no test suite', () => {
    const commands = withoutCommentLines(readFileSync('.githooks/pre-push', 'utf8'))
      .split('\n')
      .filter((line) => line.trim() !== '');
    expect(commands).toEqual(['set -euo pipefail', 'exec node scripts/pre-push.ts "$@"']);
  });

  it('is executable, so git runs it', () => {
    expect(statSync('.githooks/pre-push').mode & 0o111).toBe(0o111);
  });
});

describe('tsconfig.json', () => {
  it('checks every .ts and .js file under the strict settings, emitting nothing', () => {
    const { compilerOptions: o, include } = json('tsconfig.json') as { compilerOptions: Record<string, unknown>; include: string[] };
    expect({
      include,
      strict: o.strict,
      noUncheckedIndexedAccess: o.noUncheckedIndexedAccess,
      exactOptionalPropertyTypes: o.exactOptionalPropertyTypes,
      checkJs: o.checkJs,
      noEmit: o.noEmit,
      erasableSyntaxOnly: o.erasableSyntaxOnly,
      module: o.module,
    }).toEqual({
      include: ['**/*.ts', '**/*.js'],
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      checkJs: true,
      noEmit: true,
      erasableSyntaxOnly: true,
      module: 'nodenext',
    });
  });
});

describe('.prettierrc.json', () => {
  it('formats at the measured width, 140, with single quotes', () => {
    expect(json('.prettierrc.json')).toEqual({ printWidth: 140, singleQuote: true });
  });
});
