import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  js.configs.recommended,
  prettier,
  {
    plugins: { sonarjs },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': 'warn',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-throw-literal': 'error',
      'no-shadow': 'warn',
      // SonarCloud security hotspot rules (caught locally before CI)
      'sonarjs/pseudo-random': 'warn',
      'sonarjs/slow-regex': 'error',
      'sonarjs/no-os-command-from-path': 'warn',
      'sonarjs/no-hardcoded-passwords': 'error',
      'sonarjs/no-hardcoded-secrets': 'error',
      'sonarjs/no-clear-text-protocols': 'error',
    },
  },
  {
    // Relax rules for test files — test scaffolding often needs let +
    // reassign patterns, AND test setups commonly redeclare helpers
    // inside describe/test blocks for isolation (intentional shadow of
    // the file-scope import). no-shadow as a warning floods CI on a
    // pattern that's correct-by-convention in jest test layouts.
    // `no-undef` stays on (SHY-0631): with globals.jest set it costs nothing,
    // and a call to a helper out of scope fails lint instead of a CI run.
    files: ['tests/**/*.test.js', 'src/__tests__/**/*.test.js'],
    rules: {
      'prefer-const': 'off',
      'no-shadow': 'off',
    },
  },
  {
    ignores: ['node_modules/', 'coverage/', 'eslint.config.mjs'],
  },
];
