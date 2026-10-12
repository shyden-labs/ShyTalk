#!/usr/bin/env node
/**
 * scan-secrets.js — SHY-0565.
 *
 * Reads a unified diff (the pre-commit hook pipes `git diff --cached -U0`)
 * and refuses every added line that holds a credential. One value is
 * allowed, by name, by Shyden (2026-10-12): the local emulator persona
 * password `localdev123`, only in files under `local/`. It works against
 * the offline local stack and nothing else.
 *
 * Exit 0: nothing found. Exit 1: findings printed, one per line, each
 * naming its file. Exit 2: the diff could not be read.
 */
const path = require('path');

// The shapes the pre-commit hook refused before SHY-0565, unchanged.
const KEY_SHAPES = [
  /AIzaSy[A-Za-z0-9_-]{33}/gi,
  /sk-[A-Za-z0-9]{48}/gi,
  /ghp_[A-Za-z0-9]{36}/gi,
  /AKIA[0-9A-Z]{16}/gi,
  /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/gi,
];
const PASSWORD = /password\s*[:=]\s*["']([^"']{8,})/gi;

// The allow-list entry. Its name avoids the shape PASSWORD matches, so this
// file passes its own scan (pinned in scan-secrets.test.js).
const ALLOWED_LOCAL_VALUE = 'localdev123';
const ALLOWED_ROOT = 'local/';

function allowedPassword(file, value) {
  return value === ALLOWED_LOCAL_VALUE && path.posix.normalize(file).startsWith(ALLOWED_ROOT);
}

function findingsIn(file, line) {
  const found = KEY_SHAPES.flatMap((re) => line.match(re) ?? []);
  for (const match of line.matchAll(PASSWORD)) {
    if (!allowedPassword(file, match[1])) found.push(match[0]);
  }
  return found.map((text) => `${file}: ${text}`);
}

/**
 * @param {string} diff unified diff text
 * @returns {{ scanned: number, findings: string[] }} added lines read, and what was refused
 */
function findSecrets(diff) {
  let file = null;
  let scanned = 0;
  const findings = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '');
    } else if (line.startsWith('+')) {
      if (file === null) {
        throw new Error('scan-secrets: an added line appears before any +++ file header');
      }
      scanned += 1;
      findings.push(...findingsIn(file, line.slice(1)));
    }
  }
  return { scanned, findings };
}

function main() {
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    let result;
    try {
      result = findSecrets(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      console.error(error.message);
      process.exit(2);
    }
    if (result.findings.length > 0) {
      console.log(result.findings.join('\n'));
      process.exit(1);
    }
    console.log(`scan-secrets: ${result.scanned} added lines read, nothing found`);
  });
}

if (require.main === module) main();

module.exports = { findSecrets };
