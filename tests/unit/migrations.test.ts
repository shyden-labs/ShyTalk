import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { migrationProblems } from './migrations.ts';

/**
 * D1 migrations (plan 4 Task 2, shyden-labs/ShyTalk#75): Wrangler applies
 * `migrations/` in file-name order, so each file is `NNNN_words.sql` and no two
 * share a number. The fixtures are the plants each rule was seen failing on;
 * the last test judges the real folder.
 */

describe('migration names: fixtures', () => {
  it('passes an empty folder', () => {
    expect(migrationProblems([])).toEqual([]);
  });

  // Git keeps no empty folder, and Wrangler stops on a missing one ("No
  // migrations present", cli.js getMigrationsPath, 4.156.0), so the folder
  // holds a .gitkeep until its first migration.
  it('passes the .gitkeep that keeps the folder, and no other dotfile', () => {
    expect(migrationProblems(['.gitkeep', '0001_a.sql'])).toEqual([]);
    expect(migrationProblems(['.DS_Store'])).toEqual(['.DS_Store is not named NNNN_words.sql']);
  });

  it('passes numbered files in order', () => {
    expect(migrationProblems(['0001_closed_testing.sql', '0002_auth_users.sql'])).toEqual([]);
  });

  it('refuses two files with one number, naming both', () => {
    expect(migrationProblems(['0003_a.sql', '0003_b.sql'])).toEqual(['0003_a.sql and 0003_b.sql share the number 0003']);
  });

  it.each(['3_auth.sql', '0003-auth.sql', '0003_Auth.sql', '0003_auth.SQL', '0003_.sql', '0003_auth.sql.bak', 'README.md'])(
    'refuses %s, which is not NNNN_words.sql',
    (name) => {
      expect(migrationProblems([name])).toEqual([`${name} is not named NNNN_words.sql`]);
    },
  );
});

describe('the real tree', () => {
  it('names every migration NNNN_words.sql, each number once', () => {
    expect(existsSync('migrations')).toBe(true);
    expect(migrationProblems(readdirSync('migrations'))).toEqual([]);
  });
});
