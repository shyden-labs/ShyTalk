import { describe, it, expect } from 'vitest';
import { contains, leaks, parseGroups, type Group } from './dependabot-groups.ts';

/**
 * Dependabot's group assignment, as dependabot-core does it rather than as
 * GitHub's docs describe it (issue shyden-labs/repo-template#39; Shyden 2026-10-20, "global fix
 * please"). Every group whose `contains?` is true is offered the dependency,
 * and a group with no patterns outscores any wildcard, so order decides
 * nothing: a catch-all must exclude each pattern group's patterns.
 */

const group = (over: Partial<Group> & { name: string }): Group => ({
  patterns: [],
  excludePatterns: [],
  updateTypes: [],
  ...over,
});

const CONFIG = [
  'version: 2',
  'updates:',
  '  - package-ecosystem: npm',
  '    directory: /',
  '    groups:',
  '      vitest:',
  '        patterns:',
  '          - vitest',
  '          - @vitest/*',
  '',
  '      patch-updates:',
  '        update-types:',
  '          - patch',
  '        exclude-patterns:',
  '          - vitest',
  '          - @vitest/*',
  '  - package-ecosystem: github-actions',
  '    groups:',
  '      patch-updates:',
  '        update-types:',
  '          - patch',
  '    schedule:',
  '      interval: weekly',
].join('\n');

describe('parseGroups', () => {
  it('reads each ecosystem and its groups', () => {
    expect(parseGroups(CONFIG)).toEqual([
      {
        ecosystem: 'npm',
        groups: [
          group({ name: 'vitest', patterns: ['vitest', '@vitest/*'] }),
          group({ name: 'patch-updates', updateTypes: ['patch'], excludePatterns: ['vitest', '@vitest/*'] }),
        ],
      },
      { ecosystem: 'github-actions', groups: [group({ name: 'patch-updates', updateTypes: ['patch'] })] },
    ]);
  });

  it.each([['dependency-type'], ['applies-to'], ['group-by']])('refuses the group rule %s, which it does not model', (key) => {
    const config = ['  - package-ecosystem: npm', '    groups:', '      dev:', `        ${key}:`].join('\n');
    expect(() => parseGroups(config)).toThrow(`group dev uses ${key}, which this guard does not model`);
  });

  it('refuses a line it cannot read inside the groups', () => {
    const config = ['  - package-ecosystem: npm', '    groups:', '      dev:', '         odd: indent'].join('\n');
    expect(() => parseGroups(config)).toThrow('cannot read line 4 of the groups: "         odd: indent"');
  });

  it('refuses a list item with no key above it', () => {
    const config = ['  - package-ecosystem: npm', '    groups:', '      dev:', '          - vitest'].join('\n');
    expect(() => parseGroups(config)).toThrow('cannot read line 4 of the groups: "          - vitest"');
  });

  it('refuses a group key with no group above it', () => {
    const config = ['  - package-ecosystem: npm', '    groups:', '        patterns:'].join('\n');
    expect(() => parseGroups(config)).toThrow('cannot read line 3 of the groups: "        patterns:"');
  });

  it('refuses groups that come before any ecosystem', () => {
    expect(() => parseGroups(['    groups:', '      dev:'].join('\n'))).toThrow('cannot read line 1 of the groups: "    groups:"');
  });
});

describe('contains', () => {
  it('holds every name in a group with no patterns', () => {
    expect(contains(group({ name: 'all' }), 'left-pad')).toBe(true);
  });

  it('holds a name a pattern matches, * standing for any run', () => {
    expect(contains(group({ name: 'g', patterns: ['@vitest/*'] }), '@vitest/coverage-v8')).toBe(true);
  });

  it('ignores case', () => {
    expect(contains(group({ name: 'g', patterns: ['Actions/Cache*'] }), 'actions/cache/restore')).toBe(true);
  });

  it('reads a dot as a dot', () => {
    expect(contains(group({ name: 'g', patterns: ['a.b'] }), 'axb')).toBe(false);
  });

  it('does not hold a name no pattern matches', () => {
    expect(contains(group({ name: 'g', patterns: ['vitest'] }), 'vitest-extra')).toBe(false);
  });

  it('does not hold an excluded name, even with no patterns', () => {
    expect(contains(group({ name: 'all', excludePatterns: ['vitest'] }), 'vitest')).toBe(false);
  });
});

describe('leaks', () => {
  it('passes when the catch-all excludes every pattern group pattern, judging both groups', () => {
    expect(
      parseGroups(CONFIG)
        .slice(0, 1)
        .map((npm) => ({ groups: npm.groups.length, leaks: leaks(npm) })),
    ).toEqual([{ groups: 2, leaks: [] }]);
  });

  it('names a pattern group whose packages the catch-all can also take', () => {
    const npm = {
      ecosystem: 'npm',
      groups: [group({ name: 'vitest', patterns: ['vitest', '@vitest/*'] }), group({ name: 'patch-updates', excludePatterns: ['vitest'] })],
    };
    expect(leaks(npm)).toEqual([
      'npm: @vitest/ (vitest group, @vitest/*) can also land in patch-updates',
      'npm: @vitest/x/y (vitest group, @vitest/*) can also land in patch-updates',
    ]);
  });

  it('names an overlap between two pattern groups', () => {
    const actions = {
      ecosystem: 'github-actions',
      groups: [group({ name: 'cache', patterns: ['actions/cache*'] }), group({ name: 'all-actions', patterns: ['actions/*'] })],
    };
    expect(leaks(actions)).toEqual([
      'github-actions: actions/cache (cache group, actions/cache*) can also land in all-actions',
      'github-actions: actions/cachex/y (cache group, actions/cache*) can also land in all-actions',
    ]);
  });

  it('tries a pattern with no * once, as the exact name', () => {
    const npm = { ecosystem: 'npm', groups: [group({ name: 'vitest', patterns: ['vitest'] }), group({ name: 'all' })] };
    expect(leaks(npm)).toEqual(['npm: vitest (vitest group, vitest) can also land in all']);
  });
});
