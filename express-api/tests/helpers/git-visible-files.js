/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded binary `git` with literal argv (`ls-files`) to list the
 * files git tracks or would track; no user-controlled command and no PATH
 * manipulation. Matches the firebase-admin-namespace-surface convention. */
/**
 * SHY-0642 — the files git tracks or would track under a folder.
 *
 * The floored guards walk the disk, and a git-ignored file (a copied
 * `google-services.json`, `.claude/settings.local.json`, a migration
 * snapshot) exists on the Mac but never in CI, so a local run counted more
 * files than CI at the same commit. A guard keeps a walked file only when it
 * is in this set: tracked, or untracked and not ignored (a new file not yet
 * added still moves the count, as it will once committed).
 *
 * The ignore rules are git's own (every `.gitignore`, `.git/info/exclude`,
 * `core.excludesFile`), so git is asked rather than the rules re-implemented.
 * If git cannot answer, this throws: a guard never falls back to the disk.
 * `git` is spawned without a shell, with a literal argv.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * @param {string} dir a folder inside a git checkout
 * @param {string[]} [within] files or folders under `dir` to limit the list
 *   to, taken literally (no wildcards). A guard names its own roots, so git
 *   looks for untracked files there only: about half the time of the whole
 *   checkout (measured 2026-10-19).
 * @returns {Set<string>} paths relative to `dir`, in the platform's separator
 */
function gitVisibleFiles(dir, within = []) {
  // A missing cwd makes spawnSync report `git ENOENT`, which reads as git
  // not being installed; say what is missing instead.
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`git ls-files failed in ${dir}: no such folder`);
  }
  const args = [
    '--literal-pathspecs',
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ];
  if (within.length > 0) args.push('--', ...within.map((rel) => rel.split(path.sep).join('/')));
  const res = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) {
    const why = res.error ? res.error.message : res.stderr.trim() || `exit ${res.status}`;
    throw new Error(`git ls-files failed in ${dir}: ${why}`);
  }
  // `-z` ends every path with NUL and turns off git's quoting of unusual names.
  return new Set(
    res.stdout
      .split('\0')
      .filter(Boolean)
      .map((rel) => path.join(...rel.split('/'))),
  );
}

module.exports = { gitVisibleFiles };
