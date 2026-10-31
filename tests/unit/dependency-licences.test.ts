import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { licenceProblems, type Lockfile } from './licences.ts';

/**
 * Every installed package carries a licence we may use.
 *
 * Shipped packages (anything not marked `dev` in package-lock.json) must be
 * permissive. Build and test tools may also be LGPL or MPL, since we never
 * ship them. GPL, AGPL, SSPL, an unknown licence or a missing one is refused,
 * and each refused package is named.
 *
 * Licences are SPDX expressions: one is allowed when one `OR` choice has
 * every `AND` part allowed. An expression with brackets is refused rather
 * than parsed; none is installed today, and one would be read by hand.
 */

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as Lockfile;

function lockOf(packages: Record<string, { license?: unknown; dev?: boolean }>): Lockfile {
  return { packages: { '': { license: 'Apache-2.0' }, ...packages } };
}

describe('dependency licences', () => {
  it('every package in package-lock.json has an allowed licence', () => {
    expect(licenceProblems(lock)).toEqual([]);
  });

  it('allows a permissive licence on a shipped package', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: 'MIT' } }))).toEqual([]);
  });

  it('refuses MPL on a shipped package but allows it on a build tool', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: 'MPL-2.0' } }))).toEqual([
      'node_modules/a: MPL-2.0 is not allowed in a shipped package',
    ]);
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: 'MPL-2.0', dev: true } }))).toEqual([]);
  });

  it('allows LGPL on a build tool only', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: 'LGPL-3.0-or-later', dev: true } }))).toEqual([]);
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: 'LGPL-3.0-or-later' } }))).toEqual([
      'node_modules/a: LGPL-3.0-or-later is not allowed in a shipped package',
    ]);
  });

  it.each(['GPL-3.0-only', 'AGPL-3.0-or-later', 'SSPL-1.0', 'SEE LICENSE IN LICENSE'])('refuses %s even on a build tool', (licence) => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: licence, dev: true } }))).toEqual([
      `node_modules/a: ${licence} is not allowed in a build tool`,
    ]);
  });

  it('refuses a missing licence', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { dev: true } }))).toEqual(['node_modules/a: no licence recorded']);
  });

  it('refuses a licence that is not a string', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: { type: 'MIT' } } }))).toEqual(['node_modules/a: no licence recorded']);
  });

  it('allows an OR expression when one choice is allowed', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: 'MIT OR GPL-3.0-only' } }))).toEqual([]);
  });

  it('allows an AND expression only when every part is allowed', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: 'Apache-2.0 AND LGPL-3.0-or-later', dev: true } }))).toEqual([]);
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: 'Apache-2.0 AND LGPL-3.0-or-later' } }))).toEqual([
      'node_modules/a: Apache-2.0 AND LGPL-3.0-or-later is not allowed in a shipped package',
    ]);
  });

  it('refuses an expression with brackets', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: '(MIT OR ISC)', dev: true } }))).toEqual([
      'node_modules/a: (MIT OR ISC) has brackets; read it by hand',
    ]);
  });

  it('names every refused package', () => {
    expect(
      licenceProblems(
        lockOf({
          'node_modules/a': { license: 'GPL-2.0-only' },
          'node_modules/b': { license: 'MIT' },
          'node_modules/c': {},
        }),
      ),
    ).toEqual(['node_modules/a: GPL-2.0-only is not allowed in a shipped package', 'node_modules/c: no licence recorded']);
  });
});
