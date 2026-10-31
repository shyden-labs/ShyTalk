/**
 * Lint every code file with typescript-eslint's strict, type-checked rules
 * (issue shyden-labs/repo-template#61): a finding or an unused disable comment fails `npm run lint`,
 * which runs with no warnings allowed.
 */
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // .superpowers/ is the git-ignored private working folder: never committed, so never linted.
  { ignores: ['coverage/', 'node_modules/', '.superpowers/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  // A number formats one way in a template (`line ${n}`). Every other option is named, because
  // options given here replace the strict preset's, and the rule's own defaults allow null too.
  {
    rules: {
      '@typescript-eslint/restrict-template-expressions': [
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
      // `{ key: _key, ...rest }` leaves a key out of a copy; the rule's other defaults stay.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
);
