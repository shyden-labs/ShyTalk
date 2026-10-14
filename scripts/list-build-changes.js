#!/usr/bin/env node
'use strict';

/**
 * list-build-changes.js — SHY-0361: the commits a dev deploy carries, for the
 * tester notes (scripts/tester-notes.js reads this format).
 *
 *   #baseline <sha>                    or `#unresolved`
 *   <sha>\t<areas>\t<subject>          one per first-parent commit, newest first
 *
 * <areas> is what scripts/deploy-scope.sh (SHY-0347) says that one commit
 * touches: the same classifier the deploy jobs use, never a second list of
 * paths. `-` means none.
 *
 * Unlike the scope job, nothing here fails safe: deploy-dev.yml runs this in
 * its own job, and a fault turns the app jobs red (Shyden, 2026-10-14).
 *
 * CLI (deploy-dev.yml): env BASELINE; prints a `changes` GITHUB_OUTPUT entry.
 */

const AREAS = ['backend', 'web', 'android', 'ios'];

/** The areas deploy-scope.sh set true; throws on output it would never write. */
function parseScope(text) {
  const values = Object.fromEntries(
    text
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  if (values.reason !== 'derived-from-diff') {
    throw new Error(`deploy-scope.sh did not classify a diff (reason=${values.reason})`);
  }
  for (const a of AREAS) {
    if (values[a] !== 'true' && values[a] !== 'false') {
      throw new Error(`deploy-scope.sh output has no true/false for ${a}`);
    }
  }
  return AREAS.filter((a) => values[a] === 'true');
}

const lines = (s) => s.split('\n').filter((l) => l !== '');

/** The change list for BASELINE..HEAD; `git(args)` returns stdout or throws. */
function listChanges({ baseline, git, classify }) {
  if (!baseline || baseline === 'unresolved') return '#unresolved\n';
  let out = `#baseline ${baseline}\n`;
  for (const sha of lines(git(['log', '--first-parent', '--format=%H', `${baseline}..HEAD`]))) {
    const paths = lines(git(['diff', '--name-only', `${sha}^1`, sha]));
    const areas = paths.length === 0 ? [] : classify(paths);
    const subject = git(['log', '-1', '--format=%s', sha]).trim();
    out += `${sha}\t${areas.join(',') || '-'}\t${subject}\n`;
  }
  return out;
}

function main() {
  const { execFileSync } = require('node:child_process');
  const crypto = require('node:crypto');
  const path = require('node:path');
  const { existsSync } = require('node:fs');
  // Absolute tools, never resolved through PATH (sonarjs/no-os-command-from-path).
  const absolute = (name, candidates) => {
    const found = candidates.find((p) => existsSync(p));
    if (!found) throw new Error(`${name} not found at ${candidates.join(' or ')}`);
    return found;
  };
  const GIT = absolute('git', ['/usr/bin/git', '/opt/homebrew/bin/git']);
  const BASH = absolute('bash', ['/bin/bash', '/usr/bin/bash']);
  const scopeScript = path.join(__dirname, 'deploy-scope.sh');
  const git = (args) => execFileSync(GIT, args, { encoding: 'utf8' });
  const classify = (paths) =>
    parseScope(execFileSync(BASH, [scopeScript], { input: paths.join('\n'), encoding: 'utf8' }));
  const list = listChanges({ baseline: process.env.BASELINE, git, classify });
  const delimiter = `CHANGES_${crypto.randomBytes(16).toString('hex')}`;
  process.stderr.write(list);
  process.stdout.write(`changes<<${delimiter}\n${list}${delimiter}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`::error::list-build-changes: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { listChanges, parseScope };
