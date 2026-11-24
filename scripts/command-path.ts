/**
 * A command's full path, found as the shell finds it (shyden-labs/ShyTalk#353): the first folder on PATH holding an
 * executable file of that name. The scripts run `gh`, `git` and `npm` through it, so the Mac's App router for gh still
 * answers before any other gh, CI's own folders still work, and no command is left to PATH at the call (SonarCloud
 * S4036). It imports nothing outside node, as npm-ci.ts runs before the install.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const runnable = (file: string): boolean => {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export function commandPath(name: string, path: string = process.env.PATH ?? ''): string {
  const folders = path.split(delimiter).filter((folder) => folder !== '');
  const found = folders.map((folder) => join(folder, name)).find(runnable);
  if (found === undefined) {
    throw new Error(`${name} is not on PATH (searched ${folders.length === 0 ? 'nothing' : folders.join(', ')})`);
  }
  return found;
}
