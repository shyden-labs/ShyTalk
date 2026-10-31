/**
 * Licence check over package-lock.json (see dependency-licences.test.ts).
 *
 * The permissive list holds only what is installed or expected; a new licence
 * fails here and is added on purpose after reading it.
 */

export interface Lockfile {
  packages: Record<string, { license?: unknown; dev?: boolean }>;
}

const PERMISSIVE = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'BlueOak-1.0.0']);

const BUILD_TOOL_ONLY = new Set(['MPL-2.0', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later']);

function allowed(expression: string, buildTool: boolean): boolean {
  return expression
    .split(' OR ')
    .some((choice) => choice.split(' AND ').every((part) => PERMISSIVE.has(part) || (buildTool && BUILD_TOOL_ONLY.has(part))));
}

/** One line per refused package, naming it and why; empty when all pass. */
export function licenceProblems(lock: Lockfile): string[] {
  const problems: string[] = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '') continue; // the project itself
    const licence = entry.license;
    if (typeof licence !== 'string' || licence.trim() === '') {
      problems.push(`${path}: no licence recorded`);
    } else if (/[()]/.test(licence)) {
      problems.push(`${path}: ${licence} has brackets; read it by hand`);
    } else if (!allowed(licence, entry.dev === true)) {
      problems.push(`${path}: ${licence} is not allowed in a ${entry.dev === true ? 'build tool' : 'shipped package'}`);
    }
  }
  return problems;
}
