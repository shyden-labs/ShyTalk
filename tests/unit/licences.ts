/**
 * Licence check over package-lock.json (see dependency-licences.test.ts).
 *
 * The permissive list holds only what is installed; a new licence fails here
 * and is added on purpose after reading it.
 */

export interface Lockfile {
  packages: Record<string, { license?: unknown; dev?: boolean }>;
}

/** A package allowed weak copyleft, and why. */
export interface Exception {
  name: RegExp;
  reason: string;
}

// 0BSD (tslib) and CC0-1.0 (@speed-highlight/core, via wrangler's miniflare) are public-domain-equivalent: no conditions at all.
const PERMISSIVE = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'BlueOak-1.0.0', '0BSD', 'CC0-1.0']);

const WEAK_COPYLEFT = new Set(['MPL-2.0', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later']);

/**
 * Every package allowed weak copyleft. Each reason names the tool that brings
 * it in and says nothing shipped imports it; remove an entry once its package
 * is gone, and never add one for a package a Worker or the app imports.
 */
export const EXCEPTIONS: Exception[] = [
  {
    name: /^lightningcss(-.+)?$/,
    reason: 'MPL-2.0; CSS tooling inside vitest (via vite) and its per-platform builds; only tests run it',
  },
  {
    name: /^@img\/sharp-.+$/,
    reason:
      "LGPL-3.0 (libvips); sharp's per-platform builds inside wrangler's local runtime (miniflare); only wrangler on CI or the Mac runs it, and no Worker imports it",
  },
];

function allowed(expression: string, parts: Set<string>[]): boolean {
  return expression.split(' OR ').some((choice) => choice.split(' AND ').every((part) => parts.some((set) => set.has(part))));
}

/** The package name from a lockfile path: the part after the last `node_modules/`. */
function packageName(path: string): string {
  return path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

/** One line per refused package, naming it and why; empty when all pass. */
export function licenceProblems(lock: Lockfile, exceptions: Exception[] = EXCEPTIONS): string[] {
  const problems: string[] = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '') continue; // the project itself
    const licence = entry.license;
    const excepted = exceptions.some((exception) => exception.name.test(packageName(path)));
    if (typeof licence !== 'string' || licence.trim() === '') {
      problems.push(`${path}: no licence recorded`);
    } else if (/[()]/.test(licence)) {
      problems.push(`${path}: ${licence} has brackets; read it by hand`);
    } else if (allowed(licence, [PERMISSIVE])) {
      continue;
    } else if (!excepted) {
      problems.push(`${path}: ${licence} is not permissive and has no exception`);
    } else if (!allowed(licence, [PERMISSIVE, WEAK_COPYLEFT])) {
      problems.push(`${path}: ${licence} is not allowed, even with an exception`);
    }
  }
  return problems;
}
