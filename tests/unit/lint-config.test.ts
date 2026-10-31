import { describe, it, expect, vi } from 'vitest';
import js from '@eslint/js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The lint config (issue shyden-labs/repo-template#61): typescript-eslint's strict, type-checked rules
 * over every code file, with two options named and nothing else loosened.
 * typescript-eslint takes about half a second of CPU to load, over a unit
 * file's budget, so it is stood in here; CI's lint step runs the real one over
 * the whole tree.
 */

const STRICT = { name: 'typescript-eslint strict-type-checked (stand-in)' };
vi.mock('typescript-eslint', () => ({ default: { configs: { strictTypeChecked: [STRICT] } } }));

const { default: config } = await import('../../eslint.config.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const rules = config.flatMap((c) => Object.entries(c.rules ?? {}));
const strictAt = config.findIndex((c) => c.name === STRICT.name);

describe('eslint.config.js', () => {
  it('applies eslint and typescript-eslint presets, the strict one after the base', () => {
    expect([config.indexOf(js.configs.recommended) >= 0, strictAt > config.indexOf(js.configs.recommended)]).toEqual([true, true]);
  });

  it('reads types through the project service, rooted at the repository', () => {
    expect(config.map((c) => c.languageOptions?.parserOptions).filter((p) => p !== undefined)).toEqual([
      { projectService: true, tsconfigRootDir: ROOT },
    ]);
  });

  it('refuses a disable comment that disables nothing', () => {
    expect(config.map((c) => c.linterOptions?.reportUnusedDisableDirectives).filter((r) => r !== undefined)).toEqual(['error']);
  });

  it('allows numbers in templates and names every other refusal the strict preset makes', () => {
    expect(rules.filter(([name]) => name === '@typescript-eslint/restrict-template-expressions')).toEqual([
      [
        '@typescript-eslint/restrict-template-expressions',
        [
          'error',
          {
            allowAny: false,
            allowArray: false,
            allowBoolean: false,
            allowNever: false,
            allowNullish: false,
            allowNumber: true,
            allowRegExp: false,
          },
        ],
      ],
    ]);
  });

  it('lets a rest copy leave a key out, keeping the rule otherwise as it was', () => {
    expect(rules.filter(([name]) => name === '@typescript-eslint/no-unused-vars')).toEqual([
      ['@typescript-eslint/no-unused-vars', ['error', { ignoreRestSiblings: true }]],
    ]);
  });

  it('refuses every empty pattern as the base does: no exemption, and no looser rule', () => {
    expect(rules.filter(([name]) => name === 'no-empty-pattern')).toEqual([['no-empty-pattern', 'error']]);
  });

  it('sets its own rules after the strict preset, so they are the ones that apply', () => {
    expect(config.findIndex((c) => c.rules !== undefined && c !== js.configs.recommended)).toBeGreaterThan(strictAt);
  });

  it('leaves out only generated folders and the private, git-ignored working folder', () => {
    expect(config.flatMap((c) => (Object.keys(c).length === 1 ? (c.ignores ?? []) : []))).toEqual([
      'coverage/',
      'node_modules/',
      '.superpowers/',
    ]);
  });
});
