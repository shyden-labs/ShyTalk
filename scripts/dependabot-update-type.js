#!/usr/bin/env node
/**
 * dependabot-update-type.js — SHY-0569.
 *
 * Decides whether a Dependabot PR may be auto-merged. PR #2190's head commit
 * said "Bump firebase from 12.18.0 to 13.0.0" while its metadata block said
 * 12.19.0 / semver-minor, and the workflow trusted the block alone, so a major
 * update merged by itself. This reads the version pairs from Dependabot's own
 * sentences in the PR title and body ("Bump X from A to B", "Bumps [X](...)
 * from A to B", "Updates `X` from A to B") and allows auto-merge only when the
 * metadata AND every pair agree the update is a patch or minor one. Anything
 * it cannot read says no.
 *
 * CLI (dependabot-auto-merge.yml): reads TITLE, BODY, UPDATE_TYPE, ECOSYSTEM
 * from the environment, prints its reading, and writes merge=true|false to
 * $GITHUB_OUTPUT. It exits 0 either way: "no" is a decision, not an error.
 */
const fs = require('fs');

const ALLOWED_TYPES = new Set(['version-update:semver-patch', 'version-update:semver-minor']);
const ACTIONS = new Set(['github_actions', 'github-actions']);

// One of Dependabot's own sentences, naming a package and a version pair.
const SENTENCE =
  /^\s*(?:[\w()-]+:\s*)?(?:Bump|Bumps|Updates)\s+(?:\[([^\]]+)\]\([^)]*\)|`([^`]+)`|(\S+))\s+from\s+(\S+?)\s+to\s+(\S+?)\.?\s*$/i;
const VERSION = /^v?(\d+(?:\.\d+)*)(?:[-+][\w.-]*)?$/;

function parts(version) {
  const m = VERSION.exec(version);
  return m ? m[1].split('.').map(Number) : null;
}

function pairsIn(text) {
  const pairs = [];
  for (const line of (text ?? '').split('\n')) {
    const m = SENTENCE.exec(line);
    if (m) pairs.push({ name: m[1] ?? m[2] ?? m[3], from: m[4], to: m[5] });
  }
  return pairs;
}

function isMajor(from, to) {
  return from[0] !== to[0] || (from[0] === 0 && (from[1] ?? 0) !== (to[1] ?? 0));
}

/**
 * @param {{ title: string, body: string, updateType: string, ecosystem: string }} pr
 * @returns {{ merge: boolean, reason: string, pairs: string[] }}
 */
function judge({ title, body, updateType, ecosystem }) {
  const found = [...pairsIn(title), ...pairsIn(body)];
  const shown = [];
  for (const pair of found) {
    const from = parts(pair.from);
    const to = parts(pair.to);
    if (!from || !to) {
      return {
        merge: false,
        reason: `cannot read the versions in "${pair.name} from ${pair.from} to ${pair.to}"`,
        pairs: [],
      };
    }
    shown.push(`${pair.name} ${pair.from.replace(/^v/, '')} -> ${pair.to.replace(/^v/, '')}`);
    pair.major = isMajor(from, to);
  }
  if (ACTIONS.has(ecosystem) && found.length > 0) {
    return { merge: true, reason: 'GitHub Actions are SHA-pinned', pairs: shown };
  }
  if (!updateType) return { merge: false, reason: 'the metadata says nothing', pairs: shown };
  if (!ALLOWED_TYPES.has(updateType)) {
    return { merge: false, reason: `the metadata says ${updateType}`, pairs: shown };
  }
  if (found.length === 0) {
    return { merge: false, reason: 'no version pair in the title or body', pairs: [] };
  }
  const major = found.findIndex((pair) => pair.major);
  if (major !== -1) {
    return { merge: false, reason: `${shown[major]} is a major change`, pairs: shown };
  }
  return { merge: true, reason: 'every pair is a patch or minor change', pairs: shown };
}

function main() {
  const verdict = judge({
    title: process.env.TITLE ?? '',
    body: process.env.BODY ?? '',
    updateType: process.env.UPDATE_TYPE ?? '',
    ecosystem: process.env.ECOSYSTEM ?? '',
  });
  console.log(
    `metadata: ${process.env.UPDATE_TYPE || '(none)'} (${process.env.ECOSYSTEM || 'no ecosystem'})`,
  );
  for (const pair of verdict.pairs) console.log(`pair: ${pair}`);
  console.log(`auto-merge: ${verdict.merge ? 'yes' : 'no'} (${verdict.reason})`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `merge=${verdict.merge}\n`);
  }
}

if (require.main === module) main();

module.exports = { judge };
