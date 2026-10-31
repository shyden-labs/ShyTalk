import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { licenceProblems, type Exception, type Lockfile } from './licences.ts';

/**
 * Every installed package carries a licence we may use.
 *
 * Every package must be permissive, however it was installed: Workers are
 * bundled, so a package installed as a development tool still ships if a
 * Worker imports it, and the lockfile's `dev` mark proves nothing.
 *
 * The one way past that is a named exception in licences.ts, each with its
 * reason (which tool uses it, and that nothing shipped imports it). An
 * exception allows weak copyleft (LGPL or MPL) only. GPL, AGPL, SSPL, an
 * unknown licence or a missing one is refused everywhere, each package named.
 *
 * Licences are SPDX expressions: one is allowed when one `OR` choice has
 * every `AND` part allowed. An expression with brackets is refused rather
 * than parsed; none is installed today, and one would be read by hand.
 */

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as Lockfile;

const TOOL: Exception[] = [{ name: /^tool(-.+)?$/, reason: 'a test tool; nothing shipped imports it' }];

function lockOf(packages: Record<string, { license?: unknown; dev?: boolean }>): Lockfile {
  return { packages: { '': { license: 'Apache-2.0' }, ...packages } };
}

describe('dependency licences', () => {
  it('every package in package-lock.json has an allowed licence', () => {
    expect(licenceProblems(lock)).toEqual([]);
  });

  it('allows a permissive licence', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: 'MIT' } }), [])).toEqual([]);
  });

  it('refuses weak copyleft without an exception, even when marked dev', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: 'MPL-2.0', dev: true } }), [])).toEqual([
      'node_modules/a: MPL-2.0 is not permissive and has no exception',
    ]);
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: 'LGPL-3.0-or-later' } }), [])).toEqual([
      'node_modules/a: LGPL-3.0-or-later is not permissive and has no exception',
    ]);
  });

  it('allows weak copyleft on a package with an exception', () => {
    expect(licenceProblems(lockOf({ 'node_modules/tool': { license: 'MPL-2.0' } }), TOOL)).toEqual([]);
    expect(licenceProblems(lockOf({ 'node_modules/tool-linux-x64': { license: 'LGPL-3.0-only' } }), TOOL)).toEqual([]);
  });

  it('matches an exception on the package name, scoped and nested too', () => {
    const scoped: Exception[] = [{ name: /^@scope\/tool$/, reason: 'a test tool' }];
    expect(licenceProblems(lockOf({ 'node_modules/@scope/tool': { license: 'MPL-2.0' } }), scoped)).toEqual([]);
    expect(licenceProblems(lockOf({ 'node_modules/x/node_modules/tool': { license: 'MPL-2.0' } }), TOOL)).toEqual([]);
    expect(licenceProblems(lockOf({ 'node_modules/tool/node_modules/a': { license: 'MPL-2.0' } }), TOOL)).toEqual([
      'node_modules/tool/node_modules/a: MPL-2.0 is not permissive and has no exception',
    ]);
  });

  it.each(['GPL-3.0-only', 'AGPL-3.0-or-later', 'SSPL-1.0', 'SEE LICENSE IN LICENSE'])('refuses %s even with an exception', (licence) => {
    expect(licenceProblems(lockOf({ 'node_modules/tool': { license: licence } }), TOOL)).toEqual([
      `node_modules/tool: ${licence} is not allowed, even with an exception`,
    ]);
  });

  it('refuses a missing licence', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': {} }), [])).toEqual(['node_modules/a: no licence recorded']);
  });

  it('refuses a licence that is not a string', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: { type: 'MIT' } } }), [])).toEqual([
      'node_modules/a: no licence recorded',
    ]);
  });

  it('allows an OR expression when one choice is allowed', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: 'MIT OR GPL-3.0-only' } }), [])).toEqual([]);
  });

  it('allows an AND expression only when every part is allowed', () => {
    expect(licenceProblems(lockOf({ 'node_modules/tool': { license: 'Apache-2.0 AND LGPL-3.0-or-later' } }), TOOL)).toEqual([]);
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: 'Apache-2.0 AND LGPL-3.0-or-later' } }), [])).toEqual([
      'node_modules/a: Apache-2.0 AND LGPL-3.0-or-later is not permissive and has no exception',
    ]);
  });

  it('refuses an expression with brackets', () => {
    expect(licenceProblems(lockOf({ 'node_modules/a': { license: '(MIT OR ISC)' } }), [])).toEqual([
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
        [],
      ),
    ).toEqual(['node_modules/a: GPL-2.0-only is not permissive and has no exception', 'node_modules/c: no licence recorded']);
  });
});
